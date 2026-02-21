// =============================================================================
// Dashboard controller — HTTP layer for GET /api/dashboard.
//
// SPEC § 2.4 Dashboard Route:
//   GET /api/dashboard — org-scoped aggregate stats + per-employee breakdown.
//
// Responsibility boundary (same contract as all other controllers):
//   - Extract orgId from req.org.id (JWT-derived, never req.body/params)
//   - Call the dashboard service
//   - Forward errors to global errorHandler via next(err)
//   - Never contain aggregation or DB logic
// =============================================================================

import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { sendSuccess } from '../utils/response';
import { getDashboardStats } from '../services/dashboard.service';

// ─── GET /api/dashboard ───────────────────────────────────────────────────────

/**
 * Returns org-level aggregate statistics and a per-employee completion
 * breakdown, all scoped to the orgId from the JWT.
 *
 * Response shape:
 *   {
 *     totalEmployees,   — all employees (active + inactive)
 *     activeEmployees,  — isActive = true
 *     tasksAssigned,    — all tasks in org (any status)
 *     tasksCompleted,   — tasks with status = 'completed'
 *     completionRate,   — orgLevel: tasksCompleted / tasksAssigned (0–1, 3 d.p.)
 *     employeeStats: [  — one entry per employee, sorted by completionRate desc
 *       {
 *         employeeId,
 *         name, role, department, isActive,
 *         tasksAssigned,
 *         tasksCompleted,
 *         completionRate,   — employee-level ratio (0–1, 3 d.p.)
 *       }
 *     ],
 *     generatedAt       — ISO timestamp of when this snapshot was computed
 *   }
 *
 * The response shape is fully self-describing — no client-side joins needed.
 */
export async function getDashboardHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId = req.org!.id; // guaranteed non-null by authMiddleware

        const stats = await getDashboardStats(orgId);

        sendSuccess(res, stats);
    } catch (err) {
        next(err);
    }
}
