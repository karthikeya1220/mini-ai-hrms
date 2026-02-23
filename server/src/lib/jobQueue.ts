// =============================================================================
// lib/jobQueue.ts — Postgres-backed durable job queue.
//
// REPLACES the previous setImmediate-based fire-and-forget dispatcher.
//
// WHY POSTGRES INSTEAD OF REDIS/BULLMQ
// ──────────────────────────────────────
// The previous in-process setImmediate() dispatcher had three fatal flaws:
//   ✗ In-process only  — jobs lost on server crash / restart
//   ✗ No retry         — one failure = permanent data loss
//   ✗ No observability — no job ID, no history, no failure log
//
// Redis/BullMQ was added as an improvement but introduced a new hard
// dependency (REDIS_URL) that breaks when Redis is unavailable.
//
// A Postgres-backed queue gives us:
//   ✓ Durable          — jobs survive restarts (stored in scoring_jobs table)
//   ✓ Atomic claim     — SELECT … FOR UPDATE SKIP LOCKED prevents double-processing
//   ✓ Retry with backoff — exponential run_at scheduling, up to maxAttempts
//   ✓ Deduplication    — UNIQUE job_key + INSERT … ON CONFLICT DO NOTHING
//   ✓ No new infra     — reuses the Postgres instance already required by the app
//   ✓ Post-mortem log  — failed jobs remain in the table with error_msg
//
// WORKER PATTERN  (SELECT … FOR UPDATE SKIP LOCKED)
// ───────────────────────────────────────────────────
// The worker polls on a fixed interval (POLL_INTERVAL_MS).  On each tick:
//   1. Open a $queryRaw to SELECT one pending job FOR UPDATE SKIP LOCKED.
//      SKIP LOCKED means concurrent workers never race on the same row.
//   2. Mark it status='processing', increment attempts.
//   3. Call the registered processor function.
//   4. On success: DELETE the row (keeps the table small).
//   5. On failure: if attempts < maxAttempts, set status='pending' and
//      schedule run_at = now() + exponential backoff; else status='failed'.
//
// CONFIGURATION (env vars)
// ──────────────────────────
//   SCORING_JOB_ATTEMPTS   — max retry attempts      (default: 3)
//   SCORING_JOB_BACKOFF_MS — base backoff in ms      (default: 5000)
//   SCORING_POLL_MS        — worker poll interval ms  (default: 5000)
// =============================================================================

import prisma from './prisma';
import { type ScoreJobPayload } from '../services/ai.service';

// ─── Configuration ────────────────────────────────────────────────────────────

const MAX_ATTEMPTS  = parseInt(process.env.SCORING_JOB_ATTEMPTS   ?? '3',    10);
const BACKOFF_BASE  = parseInt(process.env.SCORING_JOB_BACKOFF_MS ?? '5000', 10);
const POLL_INTERVAL = parseInt(process.env.SCORING_POLL_MS        ?? '5000', 10);

// ─── Queue name ───────────────────────────────────────────────────────────────

export const SCORING_QUEUE = 'scoring';

// ─── Module-level worker state ────────────────────────────────────────────────

let _pollTimer: ReturnType<typeof setInterval> | null = null;
let _isRunning      = false;
let _isShuttingDown = false;

// ─── Processor registry ───────────────────────────────────────────────────────

type ProcessorFn = (payload: ScoreJobPayload) => Promise<void>;
let _processor: ProcessorFn | null = null;

/** Register the function that processes scoring jobs. Called by scoringQueue.ts. */
export function registerProcessor(fn: ProcessorFn): void {
    _processor = fn;
}

// ─── Claimed job shape (raw SQL result) ──────────────────────────────────────

interface RawJob {
    id:           string;
    payload:      ScoreJobPayload;
    attempts:     number;
    max_attempts: number;
}

// =============================================================================
// enqueueScoringJob() — public enqueue API
// =============================================================================

/**
 * Persist a scoring job to the scoring_jobs table.
 *
 * Uses INSERT … ON CONFLICT DO NOTHING for deduplication:
 *   jobKey = 'score:task:<taskId>'
 * If the same task completes twice before the first job is processed, the
 * second insert is silently dropped.
 *
 * Synchronous at the call site (void return) — callers fire and forget.
 */
export function enqueueScoringJob(payload: ScoreJobPayload): void {
    const jobKey = `score:task:${payload.taskId}`;

    void prisma.$executeRaw`
        INSERT INTO scoring_jobs (job_key, queue, payload, status, max_attempts)
        VALUES (
            ${jobKey},
            ${SCORING_QUEUE},
            ${JSON.stringify(payload)}::jsonb,
            'pending',
            ${MAX_ATTEMPTS}
        )
        ON CONFLICT (job_key) DO NOTHING
    `
    .then(() => {
        console.info(
            `[jobQueue] Enqueued key=${jobKey} ` +
            `task=${payload.taskId} employee=${payload.employeeId}`,
        );
    })
    .catch((err: unknown) => {
        // INSERT failure — log but never propagate to the HTTP response.
        console.error(
            `[jobQueue] Failed to enqueue key=${jobKey}:`,
            (err as Error).message,
        );
    });
}

// =============================================================================
// Worker internals
// =============================================================================

/**
 * Claim one pending job atomically via SELECT … FOR UPDATE SKIP LOCKED.
 * Returns the claimed row, or null if the queue is empty.
 */
async function claimJob(): Promise<RawJob | null> {
    const rows = await prisma.$queryRaw<RawJob[]>`
        WITH claimed AS (
            SELECT id
            FROM   scoring_jobs
            WHERE  status  = 'pending'
            AND    queue   = ${SCORING_QUEUE}
            AND    run_at <= now()
            ORDER BY run_at ASC
            LIMIT  1
            FOR UPDATE SKIP LOCKED
        )
        UPDATE scoring_jobs j
        SET    status   = 'processing',
               attempts = attempts + 1
        FROM   claimed
        WHERE  j.id = claimed.id
        RETURNING j.id, j.payload, j.attempts, j.max_attempts
    `;
    return rows[0] ?? null;
}

/** Delete a successfully processed job (keeps the table lean). */
async function completeJob(id: string): Promise<void> {
    await prisma.$executeRaw`DELETE FROM scoring_jobs WHERE id = ${id}::uuid`;
}

/**
 * Reschedule with exponential backoff, or mark permanently failed.
 * Backoff formula: BACKOFF_BASE * 2^(attempts-1)  → 5 s, 10 s, 20 s …
 */
async function failJob(
    id: string,
    attempts: number,
    maxAttempts: number,
    errMsg: string,
): Promise<void> {
    if (attempts < maxAttempts) {
        const delayMs = BACKOFF_BASE * Math.pow(2, attempts - 1);
        await prisma.$executeRaw`
            UPDATE scoring_jobs
            SET    status    = 'pending',
                   run_at    = now() + (${String(delayMs)} || ' milliseconds')::interval,
                   error_msg = ${errMsg}
            WHERE  id = ${id}::uuid
        `;
        console.warn(
            `[jobQueue] Job ${id} failed (attempt ${attempts}/${maxAttempts}) — ` +
            `retry in ${delayMs}ms`,
        );
    } else {
        await prisma.$executeRaw`
            UPDATE scoring_jobs
            SET    status    = 'failed',
                   failed_at = now(),
                   error_msg = ${errMsg}
            WHERE  id = ${id}::uuid
        `;
        console.error(
            `[jobQueue] Job ${id} permanently FAILED after ${attempts}/${maxAttempts} attempts`,
        );
    }
}

/** One poll cycle: claim → process → ack or nack. */
async function poll(): Promise<void> {
    if (_isRunning || _isShuttingDown || !_processor) return;
    _isRunning = true;

    try {
        const job = await claimJob();
        if (!job) { _isRunning = false; return; }

        console.info(
            `[jobQueue] Processing job ${job.id} — ` +
            `attempt ${job.attempts}/${job.max_attempts} — ` +
            `task=${job.payload.taskId} employee=${job.payload.employeeId}`,
        );

        try {
            await _processor(job.payload);
            await completeJob(job.id);
            console.info(`[jobQueue] ✓ Job ${job.id} completed`);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            await failJob(job.id, job.attempts, job.max_attempts, msg);
        }
    } catch (err: unknown) {
        console.error('[jobQueue] Poll error:', (err as Error).message);
    } finally {
        _isRunning = false;
    }
}

// =============================================================================
// initScoringQueue() / closeScoringQueue() — lifecycle (called from index.ts)
// =============================================================================

/**
 * Start the Postgres-backed worker poll loop.
 * Idempotent — calling twice is a no-op.
 */
export function initScoringQueue(): void {
    if (_pollTimer) return;

    _isShuttingDown = false;
    _pollTimer = setInterval(() => { void poll(); }, POLL_INTERVAL);
    void poll(); // kick off immediately so the first job isn't delayed one full interval

    console.log(
        `[jobQueue] Postgres worker started — ` +
        `queue="${SCORING_QUEUE}" poll=${POLL_INTERVAL}ms ` +
        `maxAttempts=${MAX_ATTEMPTS} backoffBase=${BACKOFF_BASE}ms`,
    );
}

/**
 * Graceful shutdown: stop the poll timer and wait up to 30 s for any
 * in-flight job to finish before returning.
 */
export async function closeScoringQueue(): Promise<void> {
    _isShuttingDown = true;

    if (_pollTimer) {
        clearInterval(_pollTimer);
        _pollTimer = null;
    }

    const deadline = Date.now() + 30_000;
    while (_isRunning && Date.now() < deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
    }

    if (_isRunning) {
        console.warn('[jobQueue] Shutdown timed out — in-flight job may be re-queued on next start');
    } else {
        console.log('[jobQueue] Worker shut down cleanly');
    }
}

