// =============================================================================
// lib/scoringQueue.ts — Scoring job adapter (thin shim over lib/jobQueue.ts).
//
// Responsibilities:
//   1. Register computeProductivityScore as the processor for the scoring queue.
//   2. Re-export enqueueScoringJob, initScoringQueue, closeScoringQueue so that
//      call sites (task.controller.ts, index.ts) do not need to change.
//
// The actual queue engine (Postgres SELECT … FOR UPDATE SKIP LOCKED poll loop,
// retry with exponential backoff, deduplication via UNIQUE job_key) lives in
// lib/jobQueue.ts.  This file only wires the domain processor into it.
//
// WHY A SEPARATE FILE?
//   Separating the queue engine (jobQueue.ts) from the domain processor
//   (scoringQueue.ts) keeps both independently testable and avoids a circular
//   dependency: ai.service.ts → prisma (fine), but jobQueue.ts must not import
//   ai.service.ts directly — that would couple the generic queue engine to a
//   single domain concern.
// =============================================================================

import { computeProductivityScore } from '../services/ai.service';
import {
    registerProcessor,
    enqueueScoringJob   as _enqueue,
    initScoringQueue    as _init,
    closeScoringQueue   as _close,
} from './jobQueue';

// Register the domain processor once at module-load time.
// jobQueue.ts's poll loop calls this function for every claimed scoring_jobs row.
registerProcessor(computeProductivityScore);

// Re-export the public API unchanged — all existing call sites continue to work.
export { _enqueue as enqueueScoringJob };
export { _init    as initScoringQueue  };
export { _close   as closeScoringQueue };

// Re-export the queue name constant for any code that references it.
export { SCORING_QUEUE as SCORING_QUEUE_NAME } from './jobQueue';
