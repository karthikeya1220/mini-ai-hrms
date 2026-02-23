-- Migration: 20260223000004_task_status_enum
--
-- Replaces the unconstrained VARCHAR(20) column tasks.status with a proper
-- Postgres enum type.  This enforces valid values at the DB layer — invalid
-- status strings are rejected before they reach the application.
--
-- FSM (forward-only, enforced in task.service.ts):
--   ASSIGNED → IN_PROGRESS → COMPLETED
--   COMPLETED is terminal.
--
-- Data conversion:
--   Existing rows use lowercase string values ('assigned', 'in_progress',
--   'completed') written by the old code.  The USING clause converts them
--   to the new SCREAMING_SNAKE_CASE enum values atomically — no data loss.
--   The mapping is exhaustive; any row with an unexpected value will cause
--   this migration to fail loudly (better than silent data corruption).
--
-- Down (manual rollback if needed):
--   ALTER TABLE "tasks" ALTER COLUMN "status" TYPE VARCHAR(20)
--     USING CASE status
--       WHEN 'ASSIGNED'    THEN 'assigned'
--       WHEN 'IN_PROGRESS' THEN 'in_progress'
--       WHEN 'COMPLETED'   THEN 'completed'
--     END;
--   DROP TYPE "TaskStatus";

-- 1. Create the Postgres enum type (idempotent).
DO $$ BEGIN
  CREATE TYPE "TaskStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Drop the index on tasks.status before altering the column type —
--    Postgres cannot rewrite an index while changing the underlying column type.
DROP INDEX IF EXISTS "idx_tasks_status";

-- 3. Drop the existing VARCHAR default BEFORE changing the column type.
--    Postgres cannot automatically cast the string literal 'assigned' to the
--    new enum type while the default is still attached — it must be dropped
--    first, then restored after the ALTER TYPE succeeds.
ALTER TABLE "tasks" ALTER COLUMN "status" DROP DEFAULT;

-- 4. Convert the column: cast existing lowercase strings to the new enum values.
--    The USING expression is evaluated row-by-row; if any value is outside the
--    known set the cast raises an error and the migration rolls back safely.
--    The ::text cast ensures the CASE branches match even if the column is
--    already typed as the enum (idempotent re-run safety).
ALTER TABLE "tasks"
  ALTER COLUMN "status" TYPE "TaskStatus"
  USING CASE "status"::text
    WHEN 'assigned'    THEN 'ASSIGNED'::"TaskStatus"
    WHEN 'in_progress' THEN 'IN_PROGRESS'::"TaskStatus"
    WHEN 'completed'   THEN 'COMPLETED'::"TaskStatus"
    WHEN 'ASSIGNED'    THEN 'ASSIGNED'::"TaskStatus"
    WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'::"TaskStatus"
    WHEN 'COMPLETED'   THEN 'COMPLETED'::"TaskStatus"
  END;

-- 5. Restore the default using the new enum literal.
ALTER TABLE "tasks"
  ALTER COLUMN "status" SET DEFAULT 'ASSIGNED'::"TaskStatus";

-- 6. Recreate the index — it now covers the enum type.
CREATE INDEX IF NOT EXISTS "idx_tasks_status" ON "tasks"("status");
