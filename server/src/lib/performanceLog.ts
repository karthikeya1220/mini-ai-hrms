// =============================================================================
// lib/performanceLog.ts — Performance log persistence layer.
//
// Single responsibility: all reads and writes to the performance_logs table.
//
// Schema (migration: 20260223000006_perf_log_flat_columns):
//   - score, completionRate, onTimeRate, avgComplexity: flat Float? columns
//   - breakdown JSONB removed — factors are typed columns, queryable directly
//   - computedAt renamed to createdAt
//
// HISTORY POLICY (SPEC § 2.3 "Keep history — do not overwrite"):
//   Every call to persistLog() performs an INSERT, never an UPDATE.
//   The performance_logs table is append-only. Old scores are preserved.
//   The latest score is always the row with the highest createdAt.
//
// NULL HANDLING:
//   - score = null  → employee has tasks but none completed yet.
//   - factor columns = null → same condition; factors cannot be computed.
//   Both are valid states and stored as SQL NULL.
// =============================================================================

import prisma from './prisma';
import type { ScoringBreakdown } from '../services/ai.service';

// ─── Types ────────────────────────────────────────────────────────────────────

/** What callers pass in to write a new log entry. */
export interface PerformanceLogInput {
    orgId: string;
    employeeId: string;
    score: number | null;
    breakdown: ScoringBreakdown | null;
    source?: string;   // retained for call-site compatibility; no longer persisted
}

/** What callers receive after a successful write. */
export interface PerformanceLogRecord {
    id: string;
    orgId: string;
    employeeId: string;
    score: number | null;
    breakdown: ScoringBreakdown | null;   // reconstructed from flat columns
    source: string | null;               // always null (no longer stored)
    computedAt: Date;                    // alias of createdAt for call-site compatibility
}

/** A lightweight row used for trend computation — only what's needed. */
export interface PerformanceLogScoreRow {
    score: number;    // guaranteed non-null (callers filter score != null)
    computedAt: Date;
}

// ─── Internal select shape ────────────────────────────────────────────────────

const LOG_SELECT = {
    id: true,
    orgId: true,
    employeeId: true,
    score: true,
    completionRate: true,
    onTimeRate: true,
    avgComplexity: true,
    createdAt: true,
} as const;

type LogRow = {
    id: string;
    orgId: string;
    employeeId: string;
    score: number | null;
    completionRate: number | null;
    onTimeRate: number | null;
    avgComplexity: number | null;
    createdAt: Date;
};

/** Map a raw Prisma row to the clean PerformanceLogRecord type. */
function toRecord(row: LogRow): PerformanceLogRecord {
    // Reconstruct ScoringBreakdown from flat columns if all factors are present.
    const breakdown: ScoringBreakdown | null =
        row.completionRate !== null &&
        row.onTimeRate !== null &&
        row.avgComplexity !== null
            ? {
                completionRate:     row.completionRate,
                onTimeRate:         row.onTimeRate,
                avgComplexity:      row.avgComplexity,
                // totalTasks* not stored as flat columns — default to 0 for
                // call-site compatibility; callers that need exact counts use
                // computeScoreFromTasks() directly.
                totalTasksAssigned: 0,
                totalCompleted:     0,
                totalOnTime:        0,
              }
            : null;

    return {
        id:          row.id,
        orgId:       row.orgId,
        employeeId:  row.employeeId,
        score:       row.score,
        breakdown,
        source:      null,
        computedAt:  row.createdAt,   // alias for call-site compatibility
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
    const { orgId, employeeId, score, breakdown } = input;

    const row = await prisma.performanceLog.create({
        data: {
            orgId,
            employeeId,
            score:          score ?? null,
            completionRate: breakdown?.completionRate ?? null,
            onTimeRate:     breakdown?.onTimeRate     ?? null,
            avgComplexity:  breakdown?.avgComplexity  ?? null,
        },
        select: LOG_SELECT,
    });

    return toRecord(row as LogRow);
}

// =============================================================================
// Read operations
// =============================================================================

/**
 * Fetch the single most recent log entry for an employee.
 * Returns null if no log exists (employee has never been scored).
 *
 * Used by: recommendEmployees() to prime the perfScore factor.
 */
export async function getLatestLog(
    orgId: string,
    employeeId: string,
): Promise<PerformanceLogRecord | null> {
    const row = await prisma.performanceLog.findFirst({
        where: { orgId, employeeId },
        orderBy: { createdAt: 'desc' },
        select: LOG_SELECT,
    });
    return row ? toRecord(row as LogRow) : null;
}

/**
 * Fetch all non-null score rows for an employee within a date range.
 * Returns lightweight rows — only score + computedAt (alias of createdAt)
 * for trend arithmetic.
 *
 * Used by: computeTrend() to compare last-30d vs prev-30d windows.
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
            createdAt: { gte: since },
            score: { not: null },
        },
        select: { score: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
    });
    // score is guaranteed non-null by the where filter but Prisma types it as nullable
    return rows
        .filter(r => r.score !== null)
        .map(r => ({ score: r.score!, computedAt: r.createdAt }));
}

/**
 * Fetch the full log history for one employee (all entries, newest first).
 */
export async function getLogHistory(
    orgId: string,
    employeeId: string,
    limit = 50,
): Promise<PerformanceLogRecord[]> {
    const rows = await prisma.performanceLog.findMany({
        where: { orgId, employeeId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: LOG_SELECT,
    });
    return rows.map(r => toRecord(r as LogRow));
}

/**
 * Fetch the latest score for each employee in a set.
 * Returns a Map<employeeId, latestScore> — used by recommendEmployees()
 * to avoid N+1 queries when ranking a pool of employees.
 *
 * Employees with no log entries are absent from the Map; callers use ?? 50.
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
        select: { employeeId: true, score: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
    });

    // Build Map<employeeId, latestScore> — first occurrence per employeeId
    // is the most recent (DESC order guarantees this).
    const map = new Map<string, number>();
    for (const row of rows) {
        if (!map.has(row.employeeId)) {
            map.set(row.employeeId, row.score!);
        }
    }
    return map;
}
