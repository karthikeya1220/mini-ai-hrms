-- Migration: 20260223000005_add_task_soft_delete
--
-- Adds is_active (soft-delete flag) to the tasks table.
-- DELETE /tasks/:id now sets is_active = false instead of destroying the row,
-- preserving all blockchain_logs / performance_logs that reference it.
--
-- All existing tasks are backfilled to is_active = true (the default)
-- so no data is lost and every read query that filters is_active = true
-- continues to return the same rows as before.
--
-- Down (manual rollback if needed):
--   ALTER TABLE "tasks" DROP COLUMN "is_active";
--   DROP INDEX IF EXISTS "idx_tasks_org_active";

-- 1. Add the column with a server-side default so no NULL rows are created
--    during the migration itself.
ALTER TABLE "tasks"
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

-- 2. Explicit backfill — all existing rows are active.
--    Redundant given the DEFAULT above, but present for clarity and safety
--    in case any row was inserted without the default during a concurrent tx.
UPDATE "tasks" SET "is_active" = true WHERE "is_active" IS NULL;

-- 3. Composite index: (org_id, is_active) supports the common read pattern
--    WHERE org_id = ? AND is_active = true used by every list/get query.
CREATE INDEX "idx_tasks_org_active" ON "tasks"("org_id", "is_active");
