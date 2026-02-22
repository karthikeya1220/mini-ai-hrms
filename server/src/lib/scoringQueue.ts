// =============================================================================
// lib/scoringQueue.ts — BullMQ queue + worker for AI productivity scoring.
//
// WHY BullMQ instead of the previous setImmediate dispatcher
// ──────────────────────────────────────────────────────────
// The previous lib/jobQueue.ts used setImmediate():
//   ✗ In-process only — jobs lost on server crash/restart
//   ✗ No retry — one failure = permanent data loss
//   ✗ No concurrency control — N task completions → N simultaneous DB queries
//   ✗ No observability — no job ID, no history, no failure log
//
// BullMQ (backed by Redis) gives us:
//   ✓ Persistent jobs — survive process restarts (jobs live in Redis)
//   ✓ Automatic retry with exponential backoff (configurable)
//   ✓ Concurrency limit (2 worker threads by default)
//   ✓ Structured failure logging with stack traces and attempt counts
//   ✓ Job deduplication — duplicate completions for the same task are collapsed
//
// GRACEFUL DEGRADATION
// ─────────────────────
// If REDIS_URL is not set, BullMQ cannot run. In that case:
//   - initScoringQueue() is a no-op and logs a warning
//   - enqueueScoringJob() falls back to the legacy setImmediate path
//   - The HTTP response is still non-blocking either way
//
// IOREDIS / BULLMQ COMPATIBILITY NOTE
// ─────────────────────────────────────
// BullMQ v3+ bundles its own ioredis version internally.
// Passing an externally-instantiated ioredis Redis instance causes TypeScript
// type-mismatch errors because the two ioredis copies are structurally
// incompatible (same types, different module paths).
//
// Resolution: we pass a plain `{ url: REDIS_URL }` connection‑options object
// to BullMQ rather than a pre-created Redis client. BullMQ creates its own
// internal ioredis connections from that options object. This is the approach
// recommended in the BullMQ docs for simple single-node Redis setups.
//
// The existing lib/redis.ts singleton (used for the dashboard cache) is
// completely unaffected — BullMQ's connections are separate.
//
// RETRY POLICY (configurable via env vars)
// ─────────────────────────────────────────
// Attempts   : SCORING_JOB_ATTEMPTS (default: 3)
// Backoff    : exponential starting at SCORING_JOB_BACKOFF_MS (default: 5000 ms)
//              i.e. 5 s → 10 s → 20 s before the job is marked failed
// Failure log: error level with jobId, attempt count, and stack trace
//
// JOB DEDUPLICATION
// ─────────────────
// Job ID = `score:task:<taskId>` — if the same task completes twice before
// the first scoring job finishes, BullMQ ignores the second enqueue.
// =============================================================================

import { Queue, Worker, type Job, type ConnectionOptions } from 'bullmq';
import { computeProductivityScore, type ScoreJobPayload } from '../services/ai.service';

// ─── Queue name ───────────────────────────────────────────────────────────────

export const SCORING_QUEUE_NAME = 'scoring';

// ─── Retry configuration (from env with safe defaults) ───────────────────────

const JOB_ATTEMPTS   = parseInt(process.env.SCORING_JOB_ATTEMPTS   ?? '3',    10);
const JOB_BACKOFF_MS = parseInt(process.env.SCORING_JOB_BACKOFF_MS ?? '5000', 10);

// ─── Module-level singletons ──────────────────────────────────────────────────
// Typed as `unknown` so we can cast at use-sites instead of fighting the
// generic variance. The public API (enqueueScoringJob / closeScoringQueue)
// is fully typed; the generics only matter internally.

let _queue:  Queue  | null = null;
let _worker: Worker | null = null;

// ─── Internal: resolve BullMQ ConnectionOptions ───────────────────────────────
//
// We pass a raw options object, not an ioredis instance, to avoid the type
// mismatch between BullMQ's bundled ioredis and our project-level ioredis.
//
// BullMQ accepts { url } as a valid ConnectionOptions when the URL is a
// standard redis:// or rediss:// URL.

function makeBullConnectionOptions(): ConnectionOptions {
    const url = process.env.REDIS_URL!;
    return { url } as ConnectionOptions;
}

// =============================================================================
// initScoringQueue()
// =============================================================================

/**
 * Creates the BullMQ Queue and Worker singletons.
 *
 * Must be called ONCE from index.ts, after dotenv loads.
 * Safe to call if REDIS_URL is absent — logs a warning and returns.
 */
export function initScoringQueue(): void {
    if (_queue) return;   // already initialised
    if (!process.env.REDIS_URL) {
        console.warn(
            '[scoringQueue] REDIS_URL not set — BullMQ disabled. ' +
            'Scoring jobs will fall back to the in-process setImmediate scheduler. ' +
            'Jobs will be lost if the server restarts.',
        );
        return;
    }

    const connection = makeBullConnectionOptions();

    // ── Queue (producer side) ─────────────────────────────────────────────────
    _queue = new Queue(SCORING_QUEUE_NAME, {
        connection,
        defaultJobOptions: {
            attempts: JOB_ATTEMPTS,
            backoff:  { type: 'exponential', delay: JOB_BACKOFF_MS },
            // Remove completed/failed jobs to prevent unbounded Redis memory growth.
            removeOnComplete: { age: 86_400, count: 500 },    // keep 24 h / 500 jobs
            removeOnFail:     { age: 7 * 86_400 },            // keep 7 days for post-mortems
        },
    });

    _queue.on('error', (err: Error) => {
        console.error('[scoringQueue] Queue error:', err.message);
    });

    // ── Worker (consumer side) ────────────────────────────────────────────────
    _worker = new Worker(SCORING_QUEUE_NAME, processJob, {
        connection,
        concurrency: 2,   // 2 scoring jobs in parallel (both are I/O-heavy Prisma calls)
    });

    // ── Worker event hooks ────────────────────────────────────────────────────

    _worker.on('completed', (job: Job) => {
        const data = job.data as ScoreJobPayload;
        console.info(
            `[scoringQueue] ✓ Job ${job.id} completed — ` +
            `org=${data.orgId} task=${data.taskId} employee=${data.employeeId}`,
        );
    });

    _worker.on('failed', (job: Job | undefined, err: Error) => {
        // ── Structured failure log ─────────────────────────────────────────────
        // Logged at ERROR level with all context needed to replay manually.
        // Inspect failed jobs: redis-cli ZRANGE bull:scoring:failed 0 -1
        const data = job?.data as ScoreJobPayload | undefined;
        console.error(
            `[scoringQueue] ✗ Job ${job?.id ?? '?'} FAILED — ` +
            `attempt ${(job?.attemptsMade ?? 0) + 1}/${JOB_ATTEMPTS} — ` +
            `org=${data?.orgId ?? '?'} task=${data?.taskId ?? '?'} ` +
            `employee=${data?.employeeId ?? '?'}\n` +
            `  Error: ${err.message}\n` +
            `  Stack: ${err.stack ?? '(no stack)'}`,
        );
    });

    _worker.on('error', (err: Error) => {
        // Worker-level connection error — BullMQ will auto-reconnect.
        console.error('[scoringQueue] Worker connection error:', err.message);
    });

    _worker.on('stalled', (jobId: string) => {
        // Job was active when worker crashed — BullMQ re-queues automatically.
        console.warn(`[scoringQueue] Job ${jobId} stalled — will be re-queued`);
    });

    console.log(
        `[scoringQueue] Initialised — queue="${SCORING_QUEUE_NAME}" ` +
        `attempts=${JOB_ATTEMPTS} backoff=${JOB_BACKOFF_MS}ms concurrency=2`,
    );
}

// =============================================================================
// processJob — BullMQ processor (executed by the Worker per job)
// =============================================================================

/**
 * The single responsibility of this function is to adapt BullMQ's Job
 * envelope to ai.service.computeProductivityScore().
 *
 * If it throws, BullMQ marks the job as failed and schedules the next retry
 * (up to JOB_ATTEMPTS) with exponential backoff. After all retries exhaust
 * the job moves to the failed set and a 'failed' event fires.
 */
async function processJob(job: Job): Promise<void> {
    const payload = job.data as ScoreJobPayload;
    const { orgId, taskId, employeeId } = payload;

    console.info(
        `[scoringQueue] Processing job ${job.id} — ` +
        `attempt ${job.attemptsMade + 1}/${JOB_ATTEMPTS} — ` +
        `org=${orgId} task=${taskId} employee=${employeeId}`,
    );

    await computeProductivityScore(payload);
}

// =============================================================================
// enqueueScoringJob() — public enqueue API
// =============================================================================

/**
 * Enqueues one scoring job for a completed task.
 *
 * ─ BullMQ available (REDIS_URL set + initScoringQueue() called):
 *     Adds the job to the Redis-backed queue. .add() is a void Promise —
 *     the caller never awaits it; the HTTP response is unblocked immediately.
 *     If .add() itself fails (e.g. Redis hiccup), falls back to setImmediate.
 *
 * ─ BullMQ NOT available (REDIS_URL absent):
 *     Falls back to setImmediate — same behaviour as the previous dispatchJob().
 *     Logged at warn level so operators can identify the degraded state.
 *
 * This function is 100% synchronous at the call site.
 */
export function enqueueScoringJob(payload: ScoreJobPayload): void {
    if (_queue) {
        void _queue
            .add(
                'computeProductivityScore',
                payload,
                {
                    // Deduplication key — prevents double-scoring the same task.
                    jobId: `score:task:${payload.taskId}`,
                },
            )
            .then((job: Job) => {
                console.info(
                    `[scoringQueue] Job ${job.id} enqueued — ` +
                    `task=${payload.taskId} employee=${payload.employeeId}`,
                );
            })
            .catch((err: unknown) => {
                console.warn(
                    '[scoringQueue] Queue.add() failed — using in-process fallback:',
                    (err as Error).message,
                );
                fallbackDispatch(payload);
            });
    } else {
        fallbackDispatch(payload);
    }
}

// ─── setImmediate fallback (no Redis / BullMQ not initialised) ─────────────────

function fallbackDispatch(payload: ScoreJobPayload): void {
    console.warn(
        '[scoringQueue] In-process fallback active — ' +
        `task=${payload.taskId} will be lost if the server restarts.`,
    );
    setImmediate(() => {
        computeProductivityScore(payload).catch((err: unknown) => {
            console.error(
                `[scoringQueue] Fallback job failed for task=${payload.taskId}:`,
                (err as Error).message,
            );
        });
    });
}

// =============================================================================
// closeScoringQueue() — graceful shutdown
// =============================================================================

/**
 * Stop the Worker (waits for the in-flight job to finish, then disconnects)
 * and close the Queue connection.
 *
 * Called from index.ts shutdown() together with prisma.$disconnect()
 * and disconnectRedis().
 */
export async function closeScoringQueue(): Promise<void> {
    if (_worker) {
        await _worker.close();
        _worker = null;
        console.log('[scoringQueue] Worker closed');
    }
    if (_queue) {
        await _queue.close();
        _queue = null;
        console.log('[scoringQueue] Queue closed');
    }
}
