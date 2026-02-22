// =============================================================================
// lib/performanceLog.ts — Performance log persistence layer.
//
// Single responsibility: all reads and writes to the performance_logs table.
//
// WHY a separate module (not inlined in ai.service.ts):
//   - computeProductivityScore()  writes a log (background job path)
//   - getScore()                  reads the latest log for trend computation
//   - getPerformanceTrend()       reads 60 days of logs
//   - dashboard.service           reads per-employee latest scores
//   Any future audit/reporting endpoint will also need these queries.
//   Centralising here prevents duplicate Prisma queries and ensures all
//   callers use the same orgId scoping and rounding conventions.
//
// HISTORY POLICY (SPEC § 2.3 "Keep history — do not overwrite"):
//   Every call to persistLog() performs an INSERT, never an UPDATE.
//   The performance_logs table is append-only. Old scores are preserved.
//   The latest score is always the row with the highest computedAt.
//
// NULL HANDLING:
//   - score = null  → employee has tasks but none completed yet.
//   - breakdown = null → same condition; cannot compute factors.
//   Both are valid states and are stored as SQL NULL (not omitted).
//   Prisma requires Prisma.JsonNull for nullable Json columns —
//   passing JS null directly would throw a runtime type error.
//
// SPEC references:
//   SPEC § 2.3 performance_logs schema
//   SPEC § 2.5 "AI Scoring Engine" — persist result after compute
// =============================================================================

import { Prisma } from '@prisma/client';
import prisma from './prisma';
import type { ScoringBreakdown } from '../services/ai.service';

// ─── Types ────────────────────────────────────────────────────────────────────

/** What callers pass in to write a new log entry. */
export interface PerformanceLogInput {
    orgId: string;               // tenant scope — required for defence-in-depth isolation
    employeeId: string;
    score: number | null;         // null = no tasks assigned / no completed tasks
    breakdown: ScoringBreakdown | null;
    /** Optional: human-readable label for what triggered this computation.
     *  Stored in breakdown JSON under the key "_source" so it travels with
     *  the data without requiring a schema migration.
     *  Examples: 'task_completed', 'manual_recompute', 'api_request'
     */
    source?: string;
}

/** What callers receive after a successful write. */
export interface PerformanceLogRecord {
    id: string;
    orgId: string;
    employeeId: string;
    score: number | null;         // decoded from Prisma Decimal
    breakdown: ScoringBreakdown | null;
    source: string | null;         // extracted from breakdown._source
    computedAt: Date;
}

/** A lightweight row used for trend computation — only what's needed. */
export interface PerformanceLogScoreRow {
    score: number;    // guaranteed non-null (callers filter score != null)
    computedAt: Date;
}

// ─── Serialisation helpers ────────────────────────────────────────────────────

/**
 * Safely serialise ScoringBreakdown (+ optional source tag) to Prisma's
 * expected InputJsonValue type without casting through `unknown`.
 *
 * The spread trick is safe here because ScoringBreakdown consists entirely
 * of primitives (numbers). We add `_source` as a private metadata field.
 */
function serialiseBreakdown(
    breakdown: ScoringBreakdown,
    source?: string,
): Prisma.InputJsonValue {
    return {
        completionRate: breakdown.completionRate,
        onTimeRate: breakdown.onTimeRate,
        avgComplexity: breakdown.avgComplexity,
        totalTasksAssigned: breakdown.totalTasksAssigned,
        totalCompleted: breakdown.totalCompleted,
        totalOnTime: breakdown.totalOnTime,
        ...(source && { _source: source }),
    };
}

/**
 * Attempt to extract a ScoringBreakdown from the raw JSONB value returned
 * by Prisma. Returns null for malformed rows (e.g. legacy data).
 */
function deserialiseBreakdown(raw: Prisma.JsonValue | null): ScoringBreakdown | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    if (
        typeof r['completionRate'] !== 'number' ||
        typeof r['onTimeRate'] !== 'number' ||
        typeof r['avgComplexity'] !== 'number' ||
        typeof r['totalTasksAssigned'] !== 'number' ||
        typeof r['totalCompleted'] !== 'number' ||
        typeof r['totalOnTime'] !== 'number'
    ) return null;

    return {
        completionRate: r['completionRate'] as number,
        onTimeRate: r['onTimeRate'] as number,
        avgComplexity: r['avgComplexity'] as number,
        totalTasksAssigned: r['totalTasksAssigned'] as number,
        totalCompleted: r['totalCompleted'] as number,
        totalOnTime: r['totalOnTime'] as number,
    };
}

/** Extract _source tag from raw breakdown JSON (if present). */
function extractSource(raw: Prisma.JsonValue | null): string | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const src = (raw as Record<string, unknown>)['_source'];
    return typeof src === 'string' ? src : null;
}

/** Map a raw Prisma PerformanceLog row to the clean PerformanceLogRecord type. */
function toRecord(row: {
    id: string;
    orgId: string;
    employeeId: string;
    score: { toNumber(): number } | null; // Prisma Decimal
    breakdown: Prisma.JsonValue | null;
    computedAt: Date;
}): PerformanceLogRecord {
    return {
        id: row.id,
        orgId: row.orgId,
        employeeId: row.employeeId,
        score: row.score !== null ? row.score.toNumber() : null,
        breakdown: deserialiseBreakdown(row.breakdown),
        source: extractSource(row.breakdown),
        computedAt: row.computedAt,
    };
}

// =============================================================================
// Write operations
// =============================================================================

/**
 * Insert a new performance log entry.
 *
 * HISTORY POLICY: this is always an INSERT — never an UPDATE.
 * Call this once per score computation event; never call it for read-only
 * GET /api/ai/score queries.
 *
 * @returns The newly created record, decoded to PerformanceLogRecord.
 */
export async function persistLog(input: PerformanceLogInput): Promise<PerformanceLogRecord> {
    const { orgId, employeeId, score, breakdown, source } = input;

    const row = await prisma.performanceLog.create({
        data: {
            orgId,
            employeeId,
            // Prisma Decimal column: pass null when score is null
            score: score !== null ? new Prisma.Decimal(score) : null,
            // Prisma Json? column: Prisma.JsonNull = SQL NULL
            // Passing JS null directly causes a runtime type error
            breakdown: breakdown !== null
                ? serialiseBreakdown(breakdown, source)
                : Prisma.JsonNull,
        },
        select: {
            id: true,
            orgId: true,
            employeeId: true,
            score: true,
            breakdown: true,
            computedAt: true,
        },
    });

    return toRecord(row);
}

// =============================================================================
// Read operations
// =============================================================================

/**
 * Fetch the single most recent log entry for an employee.
 * Returns null if no log exists (employee has never been scored).
 *
 * Used by: recommendEmployees() to prime the perfScore factor.
 *
 * @param orgId      Tenant scope — required; prevents cross-org reads.
 * @param employeeId The employee whose latest log to fetch.
 */
export async function getLatestLog(
    orgId: string,
    employeeId: string,
): Promise<PerformanceLogRecord | null> {
    const row = await prisma.performanceLog.findFirst({
        where: { orgId, employeeId },
        orderBy: { computedAt: 'desc' },
        select: {
            id: true,
            orgId: true,
            employeeId: true,
            score: true,
            breakdown: true,
            computedAt: true,
        },
    });
    return row ? toRecord(row) : null;
}

/**
 * Fetch all non-null score rows for an employee within a date range.
 * Returns lightweight rows — only score + computedAt for trend arithmetic.
 *
 * Used by: computeTrend() to compare last-30d vs prev-30d windows.
 *
 * @param orgId      Tenant scope — defence-in-depth; the employee ownership
 *                   check in the caller already guarantees the employee belongs
 *                   to this org, but adding it here protects future callers.
 * @param employeeId Employee whose history to fetch.
 * @param since      Lower bound (inclusive) on computed_at.
 */
export async function getScoreHistory(
    orgId: string,
    employeeId: string,
    since: Date,
): Promise<PerformanceLogScoreRow[]> {
    const rows = await prisma.performanceLog.findMany({
        where: {
            orgId,
            employeeId,
            computedAt: { gte: since },
            score: { not: null },
        },
        select: { score: true, computedAt: true },
        orderBy: { computedAt: 'desc' },
    });
    // score is guaranteed non-null by the where filter but Prisma types it as nullable
    return rows
        .filter(r => r.score !== null)
        .map(r => ({ score: r.score!.toNumber(), computedAt: r.computedAt }));
}

/**
 * Fetch the full log history for one employee (all entries, newest first).
 * Used by GET /api/ai/history/:employeeId (future endpoint) or audit views.
 *
 * @param orgId      Tenant scope — must be provided; this function is the
 *                   primary cross-cut risk surface (CRITICAL-1) so orgId is
 *                   mandatory even for future callers.
 * @param employeeId The employee whose history to return.
 * @param limit      Default 50. Pass a larger value for export use cases.
 */
export async function getLogHistory(
    orgId: string,
    employeeId: string,
    limit = 50,
): Promise<PerformanceLogRecord[]> {
    const rows = await prisma.performanceLog.findMany({
        where: { orgId, employeeId },
        orderBy: { computedAt: 'desc' },
        take: limit,
        select: {
            id: true,
            orgId: true,
            employeeId: true,
            score: true,
            breakdown: true,
            computedAt: true,
        },
    });
    return rows.map(toRecord);
}

/**
 * Fetch the latest score for each employee in a set.
 * Returns a Map<employeeId, latestScore> — used by recommendEmployees()
 * to avoid N+1 queries when ranking a pool of employees.
 *
 * Employees with no log entries are absent from the Map; callers use ?? 50.
 *
 * @param orgId       Tenant scope — all employeeIds MUST belong to this org
 *                    (enforced upstream). Added here for defence-in-depth so
 *                    any future direct caller is also protected.
 * @param employeeIds Pool of employee IDs to look up (already org-scoped).
 */
export async function getLatestScoreMap(
    orgId: string,
    employeeIds: string[],
): Promise<Map<string, number>> {
    if (employeeIds.length === 0) return new Map();

    const rows = await prisma.performanceLog.findMany({
        where: {
            orgId,
            employeeId: { in: employeeIds },
            score: { not: null },
        },
        select: { employeeId: true, score: true, computedAt: true },
        orderBy: { computedAt: 'desc' },
    });

    // Build Map<employeeId, latestScore> — first occurrence per employeeId
    // is the most recent (DESC order guarantees this).
    const map = new Map<string, number>();
    for (const row of rows) {
        if (!map.has(row.employeeId)) {
            map.set(row.employeeId, row.score!.toNumber());
        }
    }
    return map;
}
