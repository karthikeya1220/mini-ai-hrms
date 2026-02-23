-- Migration: 20260223000003_job_title_drop_not_null
--
-- The previous rename migration (20260223000001) preserved the original NOT NULL
-- constraint from the employees.role column.  employees.job_title is intended to
-- be optional (schema: String? / nullable) so the constraint must be dropped.
--
-- Without this fix, INSERT with jobTitle = NULL throws:
--   PrismaClientKnownRequestError P2011: Null constraint violation on job_title

ALTER TABLE "employees" ALTER COLUMN "job_title" DROP NOT NULL;
ALTER TABLE "employees" ALTER COLUMN "job_title" DROP DEFAULT;
