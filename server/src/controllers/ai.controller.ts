// =============================================================================
// AI controller — HTTP layer for /api/ai/* routes.
//
// SPEC § 2.4 AI Routes:
//   GET /api/ai/score/:employeeId    → getScoreHandler
//   GET /api/ai/recommend/:taskId    → recommendHandler
//   GET /api/ai/skill-gap/:employeeId → skillGapHandler
//
// Responsibility boundary (same as all controllers):
//   - Extract orgId from req.org.id  (JWT-derived, NEVER from req.body/params)
//   - Validate path params with Zod  (UUID format guard)
//   - Call the AI service
//   - Format response per SPEC § 2.4 Score Response shape
//   - Forward all errors to global errorHandler via next(err)
//
// No scoring logic lives here. The controller is a thin HTTP adapter.
// =============================================================================

import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { sendSuccess } from '../utils/response';
import {
    getScore,
    recommendEmployees,
    detectSkillGaps,
} from '../services/ai.service';

// ─── Shared validators ────────────────────────────────────────────────────────
// Path params are strings — Zod validates UUID format before any DB call,
// returning a clean 400 instead of a Prisma type error or silent null.

const UuidParam = z.object({
    id: z.string().uuid('Path parameter must be a valid UUID'),
});

// Helper: extract orgId from JWT — always call this, never read from params
function requireOrgId(req: AuthRequest): string {
    return req.user!.orgId; // guaranteed non-null by authMiddleware
}

// =============================================================================
// GET /api/ai/score/:employeeId
// =============================================================================

/**
 * Returns the live productivity score + full breakdown for one employee.
 *
 * SPEC § 2.4 Score Response:
 *   {
 *     employeeId, name, score, grade,
 *     breakdown: { completionRate, onTimeRate, avgComplexity,
 *                  totalTasksAssigned, totalCompleted, totalOnTime },
 *     trend: 'improving' | 'declining' | 'stable' | 'insufficient_data',
 *     computedAt
 *   }
 *
 * orgId scoping:
 *   getScore() uses orgId in every Prisma query — an employeeId from another
 *   org returns 404, not the other org's data.
 *
 * Note: this endpoint computes on-demand and does NOT persist a PerformanceLog
 * row. Persistence happens asynchronously via the job queue on task completion.
 * This design keeps read latency predictable and avoids write amplification on
 * every dashboard load.
 */
export async function getScoreHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId = requireOrgId(req);
        // Validate path param — prevents hitting the DB with a malformed UUID
        const { id: employeeId } = UuidParam.parse({ id: req.params.employeeId });

        const result = await getScore(orgId, employeeId);

        // SPEC § 2.4 Score Response shape — no fields stripped, breakdown is included
        sendSuccess(res, {
            employeeId: result.employeeId,
            name: result.name,
            score: result.score,
            grade: result.grade,
            breakdown: result.breakdown,
            trend: result.trend,
            computedAt: result.computedAt,
        });
    } catch (err) {
        next(err);
    }
}

// =============================================================================
// GET /api/ai/recommend/:taskId
// =============================================================================

/**
 * Returns the ranked top-3 employee recommendations for a given task.
 *
 * SPEC § 2.4 Recommend endpoint.
 * SPEC § 2.5 Smart Task Assignment Algorithm:
 *   rank = (skillOverlap × 30) + ((10 − activeCount) × 20) + (perfScore × 0.5)
 *
 * Response shape (per entry):
 *   {
 *     employee: { id, name, role, department, skills },
 *     skillOverlap,    — matched skill count (explainability)
 *     activeCount,     — current open task load
 *     perfScore,       — latest productivity score (50 if no history)
 *     rank             — composite score used for sorting
 *   }
 *
 * All entries include explicit factor values so the caller can render an
 * explainable breakdown ("Priya ranked #1 because she has 4/5 required skills
 * and only 2 active tasks").
 *
 * orgId scoping:
 *   recommendEmployees() scopes both the task lookup and the employee pool
 *   to orgId — no cross-tenant data is ever returned.
 */
export async function recommendHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId = requireOrgId(req);
        const { id: taskId } = UuidParam.parse({ id: req.params.taskId });

        const recommendations = await recommendEmployees({ orgId, taskId });

        // Shape each entry explicitly — do not spread the full internal object.
        // This prevents accidental leakage if the service shape evolves.
        sendSuccess(res, {
            taskId,
            recommendations: recommendations.map((entry, index) => ({
                rank: index + 1,                      // human-readable position (1-indexed)
                score: Math.round(entry.rank * 10) / 10,  // raw rank score for debugging
                employee: {
                    id: entry.employee.id,
                    name: entry.employee.name,
                    role: entry.employee.role,
                    department: entry.employee.department,
                    skills: entry.employee.skills,
                },
                reasoning: {
                    skillOverlap: entry.skillOverlap,   // how many required skills matched
                    activeCount: entry.activeCount,    // current open tasks (availability)
                    perfScore: entry.perfScore,       // latest productivity score
                },
            })),
        });
    } catch (err) {
        next(err);
    }
}

// =============================================================================
// GET /api/ai/skill-gap/:employeeId
// =============================================================================

/**
 * Returns the skill gap analysis for one employee.
 *
 * SPEC § 2.4 AI Routes: GET /api/ai/skill-gap/:employeeId
 * SPEC § 2.5 Skill Gap Detection Algorithm:
 *   gaps = requiredSkills(role) − employee.skills
 *   coverageRate = (requiredSkills.size − gaps.length) / requiredSkills.size
 *
 * Response shape:
 *   {
 *     employeeId, name,
 *     currentSkills,    — what the employee currently has
 *     requiredSkills,   — union of skills needed for tasks in their role
 *     gapSkills,        — skills they're missing
 *     coverageRate      — fraction of required skills they already have
 *   }
 *
 * orgId scoping: detectSkillGaps() scopes all queries to orgId.
 */
export async function skillGapHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId = requireOrgId(req);
        const { id: employeeId } = UuidParam.parse({ id: req.params.employeeId });

        const result = await detectSkillGaps({ orgId, employeeId });

        sendSuccess(res, result);
    } catch (err) {
        next(err);
    }
}
