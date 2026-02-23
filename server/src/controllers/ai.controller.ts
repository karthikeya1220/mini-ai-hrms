// =============================================================================
// AI controller — HTTP layer for /api/ai/* routes.
//
// SPEC § 2.4 AI Routes:
//   GET /api/ai/score/:employeeId    → getScoreHandler
//   GET /api/ai/recommend/:taskId    → recommendHandler
//   GET /api/ai/skill-gap/:employeeId → skillGapHandler
//
// Responsibility boundary (same as all controllers):
//   - Extract orgId from req.user.orgId (JWT-derived, NEVER from req.body/params)
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
    getGeminiSkillGap,
    recommendEmployeeGemini,
    getGeminiTrend,
} from '../services/ai.service';
import { GeminiUnavailableError } from '../lib/gemini';

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
            employeeId:    result.employeeId,
            name:          result.name,
            score:         result.score,
            grade:         result.grade,
            breakdown:     result.breakdown,
            trend:         result.trend,
            trendAnalysis: result.trendAnalysis,
            computedAt:    result.computedAt,
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
                    jobTitle: entry.employee.jobTitle,
                    department: entry.employee.department,
                    skills: entry.employee.skills,
                },
                reasoning: {
                    skillOverlap:     entry.skillOverlap,      // matched skill count (raw)
                    skillOverlapRate: Math.round(entry.skillOverlapRate * 1000) / 1000,  // 0–1, 3 d.p.
                    activeCount:      entry.activeCount,        // current open tasks
                    perfScore:        entry.perfScore,          // latest productivity score
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

        sendSuccess(res, {
            employeeId:     result.employeeId,
            name:           result.name,
            currentSkills:  result.currentSkills,
            requiredSkills: result.requiredSkills,
            gapSkills:      result.gapSkills,
            coverageRate:   result.coverageRate,
            // Derived convenience fields
            gapCount:       result.gapSkills.length,
            hasGaps:        result.gapSkills.length > 0,
        });
    } catch (err) {
        next(err);
    }
}

// =============================================================================
// GET /api/ai/gemini/skill-gap/:employeeId
// =============================================================================

/**
 * Gemini-powered skill gap detection for one employee.
 *
 * Complements GET /skill-gap/:employeeId (deterministic set-difference) with
 * LLM reasoning. Gemini receives:
 *   - employee.skills
 *   - jobTitle + department (role context)
 *   - peer task skills (union of requiredSkills from tasks in the same jobTitle)
 *
 * Gemini returns:
 *   - missingSkills[]  — gaps it identifies from the peer task data
 *   - emergingSkills[] — adjacent skills worth developing
 *   - rationale        — 1–2 sentence plain-English explanation
 *   - confidence       — 'high' | 'medium' | 'low'
 *
 * Graceful degradation:
 *   503 SERVICE_UNAVAILABLE when GEMINI_API_KEY is unset or Gemini times out.
 *   The deterministic /skill-gap endpoint remains available as a fallback.
 *
 * RBAC: ADMIN OR the employee themselves (same as /skill-gap).
 */
export async function geminiSkillGapHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId = requireOrgId(req);
        const { id: employeeId } = UuidParam.parse({ id: req.params.employeeId });

        const result = await getGeminiSkillGap(orgId, employeeId);

        sendSuccess(res, {
            employeeId:     result.employeeId,
            name:           result.name,
            jobTitle:       result.jobTitle,
            department:     result.department,
            currentSkills:  result.currentSkills,
            peerTaskSkills: result.peerTaskSkills,
            missingSkills:  result.missingSkills,
            emergingSkills: result.emergingSkills,
            gapCount:       result.missingSkills.length,
            hasGaps:        result.missingSkills.length > 0,
            rationale:      result.rationale,
            confidence:     result.confidence,
            source:         result.source,
        });
    } catch (err) {
        // Map Gemini being unavailable to a 503 — keeps the HTTP contract clean.
        if (err instanceof GeminiUnavailableError) {
            res.status(503).json({
                success: false,
                code:    'GEMINI_UNAVAILABLE',
                message: 'Gemini AI is not configured on this server. Set GEMINI_API_KEY to enable this endpoint.',
            });
            return;
        }
        next(err);
    }
}

// =============================================================================
// GET /api/ai/gemini/trend/:employeeId
// =============================================================================

/**
 * Gemini-powered 30-day performance trend prediction for one employee.
 *
 * Gemini receives:
 *   - Last 30 days of performance_log entries (score, completionRate,
 *     onTimeRate, avgComplexity per entry)
 *   - Task completion counts over the same window
 *   - Pre-computed arithmetic trend as a cross-check signal
 *
 * Returns:
 *   - trend: 'up' | 'down' | 'flat'
 *   - confidence: 0–100 integer
 *   - explanation: 2–4 sentence plain-English rationale
 *   - keySignals: up to 3 data-point bullets Gemini used
 *   - forecast: 1-sentence next-7-day prediction
 *
 * Graceful degradation:
 *   503 GEMINI_UNAVAILABLE when GEMINI_API_KEY is unset.
 *   Use GET /ai/score/:employeeId for the deterministic trend fallback.
 *
 * RBAC: ADMIN OR the employee themselves.
 */
export async function geminiTrendHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId      = requireOrgId(req);
        const { id: employeeId } = UuidParam.parse({ id: req.params.employeeId });

        const result = await getGeminiTrend(orgId, employeeId);

        sendSuccess(res, {
            employeeId:  result.employeeId,
            name:        result.name,
            trend:       result.trend,
            confidence:  result.confidence,
            explanation: result.explanation,
            keySignals:  result.keySignals,
            forecast:    result.forecast,
            windowDays:  result.windowDays,
            logCount:    result.logCount,
            source:      result.source,
        });
    } catch (err) {
        if (err instanceof GeminiUnavailableError) {
            res.status(503).json({
                success: false,
                code:    'GEMINI_UNAVAILABLE',
                message: 'Gemini AI is not configured on this server. Set GEMINI_API_KEY to enable this endpoint.',
            });
            return;
        }
        next(err);
    }
}
// =============================================================================
// GET /api/ai/gemini/recommend/:taskId
// =============================================================================

/**
 * Gemini-powered single-employee recommendation for a given task.
 *
 * Complements GET /recommend/:taskId (deterministic top-3) with LLM reasoning.
 * Gemini receives:
 *   - Task requirements (title, description, priority, complexityScore, requiredSkills)
 *   - All active employee profiles (skills, jobTitle, department)
 *   - Per-employee active task count (current workload)
 *   - Per-employee latest productivity score
 *
 * Returns the single best employee ID with structured reasoning covering
 * skill match, workload fit, and performance fit.
 *
 * Graceful degradation:
 *   503 GEMINI_UNAVAILABLE when GEMINI_API_KEY is unset or Gemini times out.
 *   The deterministic /recommend endpoint remains available as a fallback.
 *
 * RBAC: ADMIN only — exposes all active employee data.
 */
export async function geminiRecommendHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId  = requireOrgId(req);
        const { id: taskId } = UuidParam.parse({ id: req.params.taskId });

        const result = await recommendEmployeeGemini(orgId, taskId);

        sendSuccess(res, {
            taskId:           result.taskId,
            taskTitle:        result.taskTitle,
            bestEmployeeId:   result.bestEmployeeId,
            bestEmployeeName: result.bestEmployeeName,
            reasoning:        result.reasoning,
            confidence:       result.confidence,
            alternativeIds:   result.alternativeIds,
            source:           result.source,
        });
    } catch (err) {
        if (err instanceof GeminiUnavailableError) {
            res.status(503).json({
                success: false,
                code:    'GEMINI_UNAVAILABLE',
                message: 'Gemini AI is not configured on this server. Set GEMINI_API_KEY to enable this endpoint.',
            });
            return;
        }
        next(err);
    }
}
