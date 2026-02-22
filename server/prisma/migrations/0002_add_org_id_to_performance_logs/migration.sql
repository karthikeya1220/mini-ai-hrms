-- =============================================================================
-- Migration: 0002_add_org_id_to_performance_logs
--
-- Purpose: add org_id (tenant scoping) to performance_logs as a
--          non-nullable FK to organizations(id).
--
-- Strategy (safe for existing data):
--   Phase 1 — Add column as NULLable  → existing rows are unaffected.
--   Phase 2 — Backfill via JOIN       → derive org_id from employee's org.
--   Phase 3 — Set NOT NULL + FK       → enforce constraint now all rows have a value.
--   Phase 4 — Add indexes             → cover new query patterns.
--
-- Idempotency: each ALTER is guarded where possible. Running this migration
-- twice on the same database will produce a PG error on the ADD COLUMN step
-- (column already exists) — this is intentional and correct behaviour for
-- a migration runner.
-- =============================================================================

-- ── Phase 1: add nullable column ─────────────────────────────────────────────
-- NULLable first so existing rows are not immediately rejected by the NOT NULL
-- constraint. We will enforce NOT NULL after the backfill in Phase 3.

ALTER TABLE performance_logs
  ADD COLUMN org_id UUID;


-- ── Phase 2: backfill from the employees relation ────────────────────────────
-- Every performance_log row references an employee via employee_id.
-- Each employee belongs to exactly one org (org_id on employees).
-- This UPDATE derives the org_id for every existing log row in one statement.
--
-- Safety: if a log row references a deleted employee (no FK cascade guard was
-- in place before this migration), the UPDATE leaves org_id = NULL for that
-- row, which will be caught by the Phase 3 NOT NULL constraint below.
-- Investigate and manually reconcile those rows before applying Phase 3 if any
-- such orphans exist.

UPDATE performance_logs pl
SET    org_id = e.org_id
FROM   employees e
WHERE  e.id = pl.employee_id;


-- ── Phase 3: enforce NOT NULL and add FK ─────────────────────────────────────
-- This will fail if any row still has org_id = NULL (orphaned log).
-- Verify with: SELECT COUNT(*) FROM performance_logs WHERE org_id IS NULL;

ALTER TABLE performance_logs
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE performance_logs
  ADD CONSTRAINT fk_perf_logs_org
  FOREIGN KEY (org_id)
  REFERENCES organizations(id)
  ON DELETE CASCADE;


-- ── Phase 4: indexes ──────────────────────────────────────────────────────────
-- idx_perf_org: tenant-scoped scans (e.g. future audit / org-level invalidation).
-- idx_perf_org_employee_date: primary query pattern for getScoreHistory() and
--   getLatestScoreMap()  WHERE org_id = ? AND employee_id = ? ORDER BY computed_at DESC.
--   The DESC direction on computed_at lets PG do a forward index scan instead of
--   a full reverse-order sort.

CREATE INDEX idx_perf_org
  ON performance_logs(org_id);

CREATE INDEX idx_perf_org_employee_date
  ON performance_logs(org_id, employee_id, computed_at DESC);
