-- Migration: 20260223000006_perf_log_flat_columns
--
-- Restructures performance_logs to use typed flat columns instead of a JSONB
-- breakdown blob.  Changes in this migration:
--
--   1. score: DECIMAL(5,2) → DOUBLE PRECISION
--      Float gives full sub-point precision without the 2-decimal truncation
--      that DECIMAL(5,2) imposed (a score of 84.567 was stored as 84.57).
--
--   2. Add flat factor columns:
--        completion_rate  DOUBLE PRECISION
--        on_time_rate     DOUBLE PRECISION
--        avg_complexity   DOUBLE PRECISION
--      Backfilled from breakdown JSONB where possible; NULL for rows with no
--      valid breakdown data (no data loss — nulls are valid for "no tasks").
--
--   3. Drop breakdown JSONB column — factors are now first-class typed columns
--      that can be indexed, aggregated, and queried without JSON extraction.
--
--   4. Rename computed_at → created_at for naming consistency with all other
--      tables in this schema (which use created_at for the insertion timestamp).
--
--   5. Drop old indexes that referenced computed_at or the removed breakdown,
--      and create the two new requested indexes:
--        (employee_id, created_at DESC)  — latest score per employee + trend
--        (org_id)                        — tenant-level audit scans
--
-- Down (manual rollback if needed):
--   ALTER TABLE "performance_logs"
--     ADD COLUMN "breakdown" JSONB,
--     ADD COLUMN "computed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
--     ALTER COLUMN "score" TYPE DECIMAL(5,2);
--   UPDATE "performance_logs" SET
--     "computed_at" = "created_at",
--     "breakdown" = jsonb_build_object(
--       'completionRate', "completion_rate",
--       'onTimeRate',     "on_time_rate",
--       'avgComplexity',  "avg_complexity"
--     );
--   ALTER TABLE "performance_logs"
--     DROP COLUMN "completion_rate",
--     DROP COLUMN "on_time_rate",
--     DROP COLUMN "avg_complexity",
--     DROP COLUMN "created_at";

-- ── 1. Drop old indexes before altering columns ───────────────────────────────
DROP INDEX IF EXISTS "idx_perf_employee";
DROP INDEX IF EXISTS "idx_perf_org";
DROP INDEX IF EXISTS "idx_perf_org_employee_date";
DROP INDEX IF EXISTS "performance_logs_employee_id_computed_at_idx";

-- ── 2. Change score from DECIMAL(5,2) to DOUBLE PRECISION ────────────────────
ALTER TABLE "performance_logs"
  ALTER COLUMN "score" TYPE DOUBLE PRECISION
  USING "score"::DOUBLE PRECISION;

-- ── 3. Add flat factor columns (nullable — existing rows have no values yet) ──
ALTER TABLE "performance_logs"
  ADD COLUMN "completion_rate" DOUBLE PRECISION,
  ADD COLUMN "on_time_rate"    DOUBLE PRECISION,
  ADD COLUMN "avg_complexity"  DOUBLE PRECISION;

-- ── 4. Backfill factor columns from JSONB breakdown where data exists ─────────
--    Rows with a NULL or malformed breakdown are left as NULL — that is the
--    correct representation of "not enough data to compute these factors".
UPDATE "performance_logs"
SET
  "completion_rate" = ("breakdown" ->> 'completionRate')::DOUBLE PRECISION,
  "on_time_rate"    = ("breakdown" ->> 'onTimeRate')::DOUBLE PRECISION,
  "avg_complexity"  = ("breakdown" ->> 'avgComplexity')::DOUBLE PRECISION
WHERE "breakdown" IS NOT NULL
  AND ("breakdown" ->> 'completionRate') IS NOT NULL
  AND ("breakdown" ->> 'onTimeRate')     IS NOT NULL
  AND ("breakdown" ->> 'avgComplexity')  IS NOT NULL;

-- ── 5. Drop the breakdown JSONB column ───────────────────────────────────────
ALTER TABLE "performance_logs"
  DROP COLUMN IF EXISTS "breakdown";

-- ── 6. Rename computed_at → created_at ───────────────────────────────────────
ALTER TABLE "performance_logs"
  RENAME COLUMN "computed_at" TO "created_at";

-- ── 7. Create the two requested indexes ──────────────────────────────────────
-- Primary access pattern: latest log per employee (ORDER BY created_at DESC)
CREATE INDEX "idx_perf_employee_date" ON "performance_logs"("employee_id", "created_at" DESC);
-- Tenant audit scans and cache-invalidation sweeps
CREATE INDEX "idx_perf_org" ON "performance_logs"("org_id");
