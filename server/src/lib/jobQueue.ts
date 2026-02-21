// =============================================================================
// Job Queue — fire-and-forget background task dispatcher.
//
// DESIGN GOALS:
//   1. The HTTP response MUST never wait for background work.
//   2. Background failures MUST not crash the server or propagate to callers.
//   3. The scheduling mechanism (setImmediate) is isolated here — no other
//      file should call setImmediate or Promise.resolve().then() for fire-and-
//      forget work. Change the scheduler here once; affects everything.
//
// CURRENT SCHEDULER: setImmediate()
//   Defers to the next iteration of the Node.js event loop — after I/O events
//   but before setTimeout(fn, 0). This means the job starts as soon as the
//   current synchronous completion sequence (including res.send()) finishes.
//
// FUTURE SCHEDULER:
//   Swap setImmediate for a proper queue (BullMQ, pg-boss, etc.) by replacing
//   `dispatchJob` below. All call sites remain unchanged.
//
// LIMITATIONS (documented per global research rules):
//   - In-process only: jobs are lost on server restart / crash.
//   - No retry: if computeProductivityScore throws, the job is gone.
//   - No concurrency control: many completions in a short window will run N
//     computeProductivityScore calls simultaneously.
//   For production: replace with pg-boss (already have Postgres) or BullMQ.
// =============================================================================

export type JobFn = () => Promise<void>;

/**
 * Dispatch a fire-and-forget background job.
 *
 * - NEVER awaited by the caller.
 * - Errors inside `fn` are caught and logged — they cannot propagate.
 * - The job runs in the next event loop tick (setImmediate).
 *
 * @param name  Human-readable job name used in log lines for traceability.
 * @param fn    Async function to run in the background.
 */
export function dispatchJob(name: string, fn: JobFn): void {
    setImmediate(() => {
        fn().catch((err: unknown) => {
            // Structured log — replace with your logger when available.
            console.error(`[jobQueue] Job '${name}' failed:`, err);
        });
    });
}
