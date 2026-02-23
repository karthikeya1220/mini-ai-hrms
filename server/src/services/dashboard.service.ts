// =============================================================================
// Dashboard service — reads aggregate statistics for GET /api/dashboard.
//
// SPEC § 2.4 Dashboard Route:
//   GET /api/dashboard — org-level summary + per-employee completion stats.
//
// Design decisions:
//   1. Five queries run in a single Promise.all() batch — one round-trip
//      to the DB connection pool instead of sequential awaits.
//   2. Per-employee completion stats use task.groupBy({ by: ['assignedTo', 'status'],
//      _count: { id: true } }). The DB aggregates before transmitting: at most
//      3 rows per employee (one per status) cross the wire, not one row per task.
//      Org-level tasksAssigned/tasksCompleted are derived from the same buckets —
//      no separate task.count() calls needed.
//   3. orgId scoping is applied on EVERY where clause — never omitted.
//   4. Unassigned tasks (assignedTo = null) are excluded from both org-level totals
//      and per-employee stats — the null bucket is skipped in every loop.
//
// Redis caching (§ Caching Layer):
//   - TTL: 60 seconds, per-org key (hrms:dashboard:<orgId>)
//   - getDashboardStats() → cache-aside: read Redis → fallback to DB → write Redis
//   - invalidateDashboardCache(orgId) → DEL the org's key; called by task.service
//     on every status update so the Kanban board never shows stale totals
//   - Redis is OPTIONAL: if REDIS_URL is not set, every code path falls back
//     to a live DB query with zero code changes at the call site
// =============================================================================

import prisma from '../lib/prisma';
import { getRedis, cacheKey, DASHBOARD_NS } from '../lib/redis';
import { getLatestScoreMap } from '../lib/performanceLog';

// ─── Types ────────────────────────────────────────────────────────────────────

/** One row in the per-employee breakdown array. */
export interface EmployeeCompletionStat {
    employeeId: string;
    name: string;
    jobTitle: string | null;   // free-text job title — NOT the RBAC role
    department: string | null;
    isActive: boolean;
    tasksAssigned: number;
    tasksCompleted: number;
    completionRate: number;
    productivityScore: number | null; // AI score from performance_logs
    verifiedTasks: number;          // count of blockchain_logs
}

/** A single entry in the recent on-chain activity log. */
export interface RecentBlockchainLog {
    taskId: string;
    taskTitle: string;
    employeeName: string;
    txHash: string;
    loggedAt: Date;
}

/** A single entry in the recent performance_logs feed. */
export interface RecentPerformanceLog {
    id: string;
    employeeId: string;
    employeeName: string;
    score: number | null;
    completionRate: number | null;
    onTimeRate: number | null;
    avgComplexity: number | null;
    createdAt: Date;
}

/** Identifies a single employee as the org's top or lowest performer. */
export interface PerformerSummary {
    employeeId: string;
    name: string;
    score: number;
}

/** Top-level shape returned by getDashboardStats(). */
export interface DashboardStats {
    totalEmployees: number;
    activeEmployees: number;
    tasksAssigned: number;
    tasksCompleted: number;
    completionRate: number;

    // ── AI performance aggregates ─────────────────────────────────────────────
    /** Mean of latest productivity scores across all scored employees. null if none scored yet. */
    avgOrgScore: number | null;
    /** Employee with the highest latest productivity score. null if none scored yet. */
    topPerformer: PerformerSummary | null;
    /** Employee with the lowest latest productivity score. null if none scored yet. */
    lowestPerformer: PerformerSummary | null;
    /** Most recent performance_log rows across the org (newest first, max 10). */
    recentPerformanceLogs: RecentPerformanceLog[];

    // Per-employee breakdown
    employeeStats: EmployeeCompletionStat[];

    // Latest on-chain verified completions
    recentLogs: RecentBlockchainLog[];

    generatedAt: Date;

    // Cache metadata — tells the client whether this response came from cache
    _meta?: {
        source: 'cache' | 'live';
        cachedAt?: string;   // ISO — present when source === 'cache'
    };
}

// ─── Cache constants ──────────────────────────────────────────────────────────

/**
 * How long dashboard results live in Redis (seconds).
 * 60 s is long enough to absorb Kanban polling bursts; short enough that
 * a missed invalidation heals automatically.
 */
const DASHBOARD_TTL_SECONDS = 60;

// ─── Internal: org cache key ──────────────────────────────────────────────────

function dashboardCacheKey(orgId: string): string {
    return cacheKey(DASHBOARD_NS, orgId);
}

// =============================================================================
// getDashboardStats(orgId)
// =============================================================================

/**
 * Fetch all dashboard statistics for a single org.
 *
 * Cache-aside strategy:
 *   1. Try Redis GET — hit → deserialise + return (source: 'cache')
 *   2. On miss → query DB, serialise to Redis with EX 60
 *   3. If Redis is unavailable → always query DB (source: 'live')
 *
 * Org scoping: orgId is applied to every Prisma where clause.
 * A non-existent orgId simply returns zeroes — no 404 thrown here because
 * the JWT guarantees the org exists at login time.
 */
export async function getDashboardStats(orgId: string): Promise<DashboardStats> {
    const redis = getRedis();
    const key = dashboardCacheKey(orgId);

    // ── 1. Cache read ──────────────────────────────────────────────────────────
    if (redis) {
        try {
            const cached = await redis.get(key);
            if (cached) {
                const data = JSON.parse(cached) as DashboardStats;
                // Rehydrate dates
                data.generatedAt = new Date(data.generatedAt);
                if (data.recentLogs) {
                    data.recentLogs = data.recentLogs.map(l => ({ ...l, loggedAt: new Date(l.loggedAt) }));
                }
                if (data.recentPerformanceLogs) {
                    data.recentPerformanceLogs = data.recentPerformanceLogs.map(l => ({
                        ...l, createdAt: new Date(l.createdAt),
                    }));
                }
                data._meta = { source: 'cache', cachedAt: data.generatedAt.toISOString() };
                return data;
            }
        } catch (err) {
            console.warn('[dashboard] Redis GET failed — falling back to DB:', (err as Error).message);
        }
    }

    // ── 2. DB query ────────────────────────────────────────────────────────────
    const stats = await queryDashboardFromDB(orgId);

    // ── 3. Cache write ─────────────────────────────────────────────────────────
    if (redis) {
        try {
            await redis.set(key, JSON.stringify(stats), 'EX', DASHBOARD_TTL_SECONDS);
        } catch (err) {
            console.warn('[dashboard] Redis SET failed:', (err as Error).message);
        }
    }

    return stats;
}

// =============================================================================
// invalidateDashboardCache(orgId)
// =============================================================================

/**
 * Delete the cached dashboard snapshot for an org.
 */
export async function invalidateDashboardCache(orgId: string): Promise<void> {
    const redis = getRedis();
    if (!redis) return;

    const key = dashboardCacheKey(orgId);
    try {
        await redis.del(key);
    } catch (err) {
        console.warn('[dashboard] Cache invalidation failed:', (err as Error).message);
    }
}

// =============================================================================
// queryDashboardFromDB — pure DB read (no cache concerns)
// =============================================================================

async function queryDashboardFromDB(orgId: string): Promise<DashboardStats> {
    const [
        totalEmployees,
        activeEmployees,
        employeeRows,
        taskBuckets,
        blockchainLogs,
        rawPerfLogs,
    ] = await Promise.all([

        // 1. Total employees
        prisma.employee.count({ where: { orgId } }),

        // 2. Active employees
        prisma.employee.count({ where: { orgId, isActive: true } }),

        // 3. Employee metadata
        prisma.employee.findMany({
            where: { orgId },
            select: { id: true, name: true, jobTitle: true, department: true, isActive: true },
            orderBy: { name: 'asc' },
        }),

        // 4. Per-(employee, status) task counts — DB does the aggregation.
        //    assignedTo filter: { not: null } excludes unassigned tasks at the
        //    query level so no null-bucket rows cross the wire at all.
        //    Result shape: Array<{ assignedTo: string; status: TaskStatus; _count: { id: number } }>
        //    At most 3 rows per employee (ASSIGNED / IN_PROGRESS / COMPLETED).
        prisma.task.groupBy({
            by: ['assignedTo', 'status'],
            where: { orgId, assignedTo: { not: null } },
            _count: { id: true },
        }),

        // 5. Blockchain logs
        prisma.blockchainLog.findMany({
            where: { orgId },
            select: {
                txHash: true,
                loggedAt: true,
                task: {
                    select: {
                        id: true,
                        title: true,
                        assignedTo: true,
                        employee: { select: { name: true } },
                    },
                },
            },
            orderBy: { loggedAt: 'desc' },
        }),

        // 6. Recent performance_logs — newest 10 across the org, with employee name.
        //    score filter: { not: null } skips "no tasks yet" null rows — only
        //    meaningful scored entries appear in the feed.
        prisma.performanceLog.findMany({
            where: { orgId, score: { not: null } },
            select: {
                id: true,
                employeeId: true,
                score: true,
                completionRate: true,
                onTimeRate: true,
                avgComplexity: true,
                createdAt: true,
                employee: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 10,
        }),
    ]);

    // ── Derive org-level totals from groupBy buckets ──────────────────────────
    let tasksAssigned = 0;
    let tasksCompleted = 0;
    for (const bucket of taskBuckets) {
        tasksAssigned += bucket._count.id;
        if (bucket.status === 'COMPLETED') tasksCompleted += bucket._count.id;
    }

    // ── Build per-employee task lookup from the same buckets ───────────────────
    const empCountMap = new Map<string, { assigned: number; completed: number }>();
    for (const bucket of taskBuckets) {
        const empId = bucket.assignedTo as string;
        const entry = empCountMap.get(empId) ?? { assigned: 0, completed: 0 };
        entry.assigned += bucket._count.id;
        if (bucket.status === 'COMPLETED') entry.completed += bucket._count.id;
        empCountMap.set(empId, entry);
    }

    // ── Build verified-count Map ───────────────────────────────────────────────
    const verifiedCountMap = new Map<string, number>();
    for (const log of blockchainLogs) {
        const empId = log.task.assignedTo;
        if (empId) {
            verifiedCountMap.set(empId, (verifiedCountMap.get(empId) ?? 0) + 1);
        }
    }

    // ── Fetch latest score per employee ────────────────────────────────────────
    const employeeIds = employeeRows.map(e => e.id);
    const scoreMap = await getLatestScoreMap(orgId, employeeIds);

    // ── AI performance aggregates ─────────────────────────────────────────────
    // Work from scoreMap — only employees who have been scored are included.
    // This avoids the "50 default" from recommendation logic polluting averages.
    const scoredEntries = [...scoreMap.entries()]; // [employeeId, score]

    let avgOrgScore: number | null = null;
    let topPerformer: PerformerSummary | null = null;
    let lowestPerformer: PerformerSummary | null = null;

    if (scoredEntries.length > 0) {
        // Build a quick name lookup from the employee rows we already have
        const nameById = new Map(employeeRows.map(e => [e.id, e.name]));

        // avgOrgScore — mean of all latest scores, 1 d.p.
        const scoreSum = scoredEntries.reduce((s, [, v]) => s + v, 0);
        avgOrgScore = Math.round((scoreSum / scoredEntries.length) * 10) / 10;

        // Sort descending by score to find top and lowest in one pass
        const sorted = [...scoredEntries].sort((a, b) => b[1] - a[1]);

        const [topId, topScore] = sorted[0]!;
        topPerformer = {
            employeeId: topId,
            name: nameById.get(topId) ?? topId,
            score: Math.round(topScore * 10) / 10,
        };

        const [lowId, lowScore] = sorted[sorted.length - 1]!;
        lowestPerformer = {
            employeeId: lowId,
            name: nameById.get(lowId) ?? lowId,
            score: Math.round(lowScore * 10) / 10,
        };
    }

    // ── Recent performance_logs feed ──────────────────────────────────────────
    const recentPerformanceLogs: RecentPerformanceLog[] = rawPerfLogs.map(l => ({
        id:             l.id,
        employeeId:     l.employeeId,
        employeeName:   l.employee.name,
        score:          l.score,
        completionRate: l.completionRate,
        onTimeRate:     l.onTimeRate,
        avgComplexity:  l.avgComplexity,
        createdAt:      l.createdAt,
    }));

    // ── Assemble employee stats ────────────────────────────────────────────────
    const employeeStats: EmployeeCompletionStat[] = employeeRows.map(emp => {
        const counts = empCountMap.get(emp.id) ?? { assigned: 0, completed: 0 };
        const rate = counts.assigned > 0 ? (counts.completed / counts.assigned) : 0;

        return {
            employeeId:        emp.id,
            name:              emp.name,
            jobTitle:          emp.jobTitle,
            department:        emp.department,
            isActive:          emp.isActive,
            tasksAssigned:     counts.assigned,
            tasksCompleted:    counts.completed,
            completionRate:    Math.round(rate * 1000) / 1000,
            productivityScore: scoreMap.get(emp.id) ?? null,
            verifiedTasks:     verifiedCountMap.get(emp.id) ?? 0,
        };
    }).sort((a, b) => b.completionRate - a.completionRate || a.name.localeCompare(b.name));

    const recentLogs: RecentBlockchainLog[] = blockchainLogs.slice(0, 10).map(log => ({
        taskId:       log.task.id,
        taskTitle:    log.task.title,
        employeeName: log.task.employee?.name ?? 'Unknown',
        txHash:       log.txHash,
        loggedAt:     log.loggedAt,
    }));

    return {
        totalEmployees,
        activeEmployees,
        tasksAssigned,
        tasksCompleted,
        completionRate: tasksAssigned > 0
            ? Math.round((tasksCompleted / tasksAssigned) * 1000) / 1000
            : 0,
        avgOrgScore,
        topPerformer,
        lowestPerformer,
        recentPerformanceLogs,
        employeeStats,
        recentLogs,
        generatedAt: new Date(),
    };
}
// =============================================================================
// getDashboardEmployees(orgId)
// =============================================================================

/**
 * Returns just the employee-level breakdown array from the dashboard snapshot.
 * Used by GET /api/dashboard/employees.
 */
export async function getDashboardEmployees(orgId: string): Promise<EmployeeCompletionStat[]> {
    const stats = await getDashboardStats(orgId);
    return stats.employeeStats;
}
