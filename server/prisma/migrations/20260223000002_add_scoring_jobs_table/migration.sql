-- Migration: 20260223000002_add_scoring_jobs_table
-- Adds the scoring_jobs table that backs the Postgres-native job queue.
-- Replaces the Redis/BullMQ queue (lib/scoringQueue.ts) and the in-process
-- setImmediate dispatcher (lib/jobQueue.ts).
--
-- Key design choices:
--   job_key UNIQUE  — INSERT … ON CONFLICT DO NOTHING deduplicates enqueues
--                     for the same task (key = 'score:task:<taskId>')
--   run_at          — supports delayed/retry scheduling (backoff: set run_at
--                     to now() + interval)
--   status          — 'pending' | 'processing' | 'failed'
--                     Successful jobs are deleted after processing.
--   idx_scoring_jobs_poll — covering index for the worker's SELECT … FOR UPDATE
--                           SKIP LOCKED query pattern

CREATE TABLE "scoring_jobs" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "job_key"      VARCHAR(255) NOT NULL,
    "queue"        VARCHAR(100) NOT NULL DEFAULT 'scoring',
    "payload"      JSONB        NOT NULL,
    "status"       VARCHAR(20)  NOT NULL DEFAULT 'pending',
    "attempts"     INTEGER      NOT NULL DEFAULT 0,
    "max_attempts" INTEGER      NOT NULL DEFAULT 3,
    "run_at"       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "failed_at"    TIMESTAMPTZ,
    "error_msg"    TEXT,
    "created_at"   TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "scoring_jobs_pkey"    PRIMARY KEY ("id"),
    CONSTRAINT "scoring_jobs_job_key" UNIQUE ("job_key")
);

-- Worker poll pattern: WHERE status = 'pending' AND run_at <= now()
CREATE INDEX "idx_scoring_jobs_poll"         ON "scoring_jobs" ("status", "run_at");
CREATE INDEX "idx_scoring_jobs_queue_status" ON "scoring_jobs" ("queue", "status");
