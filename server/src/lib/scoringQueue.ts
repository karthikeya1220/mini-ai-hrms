// =============================================================================
// lib/scoringQueue.ts — Scoring worker + queue adapter.
//
// Responsibilities:
//   1. Define processScoringJob — the domain worker that:
//        a. Fetches all active tasks for the employee (org-scoped).
//        b. Calls the pure computeProductivityScore() from lib/scoring.ts.
//        c. Inserts a new row into performance_logs via persistLog().
//   2. Register the worker with the Postgres-backed job engine (lib/jobQueue.ts).
//   3. Re-export enqueueScoringJob / initScoringQueue / closeScoringQueue so
//      all existing call sites (task.service.ts, index.ts) are unchanged.
//
// IDEMPOTENCY
// ─────────────
// Each job is keyed on 'score:task:<taskId>' (set in enqueueScoringJob).
// The INSERT … ON CONFLICT DO NOTHING in jobQueue.ts guarantees that a
// second COMPLETED transition on the same task produces no duplicate job row.
// The worker itself is therefore only ever invoked once per task completion.
//
// LAYER BOUNDARIES
// ──────────────────
//   lib/scoring.ts      — pure formula, zero DB (tested in isolation)
//   lib/performanceLog.ts — append-only persistence (INSERT only, never UPDATE)
//   lib/jobQueue.ts     — generic queue engine (SELECT … FOR UPDATE SKIP LOCKED)
//   lib/scoringQueue.ts — wires the three layers together; owns the worker fn
// =============================================================================

import prisma from './prisma';
import { computeProductivityScore } from './scoring';
import { persistLog } from './performanceLog';
import {
    registerProcessor,
    enqueueScoringJob   as _enqueue,
    initScoringQueue    as _init,
    closeScoringQueue   as _close,
} from './jobQueue';
import type { ScoreJobPayload } from '../services/ai.service';

// ─── Task fetch select ────────────────────────────────────────────────────────

/** Minimal columns needed by computeProductivityScore. */
const TASK_SELECT = {
    status:         true,
    complexityScore: true,
    dueDate:        true,
    completedAt:    true,
} as const;

// =============================================================================
// Worker — processScoringJob
// =============================================================================

/**
 * Called by the job engine for every claimed scoring_jobs row.
 *
 * Steps:
 *   1. Fetch all active, org-scoped tasks assigned to this employee.
 *   2. Run the pure weighted scorer (40% completion / 35% on-time / 25% complexity).
 *   3. Append a new row to performance_logs (HISTORY POLICY: never overwrite).
 *
 * Throws on any DB error — the job engine catches, logs, and schedules a retry
 * with exponential backoff (see lib/jobQueue.ts).
 */
async function processScoringJob(payload: ScoreJobPayload): Promise<void> {
    const { orgId, taskId, employeeId } = payload;

    // ── Step 1: Fetch tasks ──────────────────────────────────────────────────
    // orgId guard: prevents cross-tenant reads even in background context.
    // isActive: true: soft-deleted tasks are excluded from scoring.
    const tasks = await prisma.task.findMany({
        where: {
            orgId,
            assignedTo: employeeId,
            isActive:   true,
        },
        select: TASK_SELECT,
    });

    // ── Step 2: Score ────────────────────────────────────────────────────────
    // computeProductivityScore is pure — no DB, no side-effects.
    // Returns { score, completionRate, onTimeRate, avgComplexity }.
    const result = computeProductivityScore(tasks);

    // ── Step 3: Persist ──────────────────────────────────────────────────────
    // persistLog() always INSERTs — it never overwrites existing entries.
    // The breakdown is reconstructed from flat columns on read; we pass
    // a ScoringBreakdown-shaped object so the existing persistLog signature
    // is satisfied without changes.
    const log = await persistLog({
        orgId,
        employeeId,
        score: result.score > 0 || tasks.length > 0 ? result.score : null,
        breakdown: tasks.length > 0
            ? {
                completionRate:     result.completionRate,
                onTimeRate:         result.onTimeRate,
                avgComplexity:      result.avgComplexity,
                // Exact counts not stored as flat columns; defaults satisfy
                // the ScoringBreakdown shape used by legacy call sites.
                totalTasksAssigned: tasks.length,
                totalCompleted:     tasks.filter(t => t.status === 'COMPLETED').length,
                totalOnTime:        0,   // not recomputed here; stored factors are sufficient
              }
            : null,
    });

    console.info(
        `[scoringQueue] ✓ Scored — ` +
        `org=${orgId} task=${taskId} employee=${employeeId} ` +
        `score=${log.score ?? 'null'} log=${log.id}`,
    );
}

// ─── Register with the job engine ────────────────────────────────────────────

// Called once at module-load time. The poll loop in jobQueue.ts invokes
// processScoringJob for every claimed row in the scoring_jobs table.
registerProcessor(processScoringJob);

// ─── Re-export public API (all call sites remain unchanged) ──────────────────

export { _enqueue as enqueueScoringJob };
export { _init    as initScoringQueue  };
export { _close   as closeScoringQueue };
export { SCORING_QUEUE as SCORING_QUEUE_NAME } from './jobQueue';
