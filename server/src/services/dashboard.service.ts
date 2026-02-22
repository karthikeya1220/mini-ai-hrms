// =============================================================================
// Dashboard service — reads aggregate statistics for GET /api/dashboard.
//
// SPEC § 2.4 Dashboard Route:
//   GET /api/dashboard — org-level summary + per-employee completion stats.
//
// Design decisions:
//   1. Four queries run in a single Promise.all() batch — one round-trip
//      to the DB connection pool instead of sequential awaits.
//   2. Per-employee completion stats use task.groupBy({ by: ['assignedTo', 'status'],
//      _count: { id: true } }). The DB aggregates before transmitting: at most
//      3 rows per employee (one per status) cross the wire, not one row per task.
//      Org-level tasksAssigned/tasksCompleted are derived from the same buckets —
//      no separate task.count() calls needed.
//   3. orgId scoping is applied on EVERY where clause — never omitted.
//   4. Unassigned tasks (assignedTo = null) contribute to org-level totals but
//      are excluded from per-employee stats (null bucket key is skipped).
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
    role: string | null;
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

/** Top-level shape returned by getDashboardStats(). */
export interface DashboardStats {
    totalEmployees: number;
    activeEmployees: number;
    tasksAssigned: number;
    tasksCompleted: number;
    completionRate: number;

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
    ] = await Promise.all([

        // 1. Total employees
        prisma.employee.count({ where: { orgId } }),

        // 2. Active employees
        prisma.employee.count({ where: { orgId, isActive: true } }),

        // 3. Employee metadata
        prisma.employee.findMany({
            where: { orgId },
            select: { id: true, name: true, role: true, department: true, isActive: true },
            orderBy: { name: 'asc' },
        }),

        // 4. Per-(employee, status) task counts
        prisma.task.groupBy({
            by: ['assignedTo', 'status'],
            where: { orgId },
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
    ]);

    // ── Derive org-level totals ────────────────────────────────────────────────
    let tasksAssigned = 0;
    let tasksCompleted = 0;
    for (const bucket of taskBuckets) {
        tasksAssigned += bucket._count.id;
        if (bucket.status === 'completed') tasksCompleted += bucket._count.id;
    }

    // ── Build per-employee task lookup ─────────────────────────────────────────
    const empCountMap = new Map<string, { assigned: number; completed: number }>();
    for (const bucket of taskBuckets) {
        const empId = bucket.assignedTo;
        if (!empId) continue;
        const entry = empCountMap.get(empId) ?? { assigned: 0, completed: 0 };
        entry.assigned += bucket._count.id;
        if (bucket.status === 'completed') entry.completed += bucket._count.id;
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

    // ── Fetch scores ───────────────────────────────────────────────────────────
    const employeeIds = employeeRows.map(e => e.id);
    const scoreMap = await getLatestScoreMap(orgId, employeeIds);

    // ── Assemble stats ─────────────────────────────────────────────────────────
    const employeeStats: EmployeeCompletionStat[] = employeeRows.map(emp => {
        const counts = empCountMap.get(emp.id) ?? { assigned: 0, completed: 0 };
        const rate = counts.assigned > 0 ? (counts.completed / counts.assigned) : 0;

        return {
            employeeId: emp.id,
            name: emp.name,
            role: emp.role,
            department: emp.department,
            isActive: emp.isActive,
            tasksAssigned: counts.assigned,
            tasksCompleted: counts.completed,
            completionRate: Math.round(rate * 1000) / 1000,
            productivityScore: scoreMap.get(emp.id) ?? null,
            verifiedTasks: verifiedCountMap.get(emp.id) ?? 0,
        };
    }).sort((a, b) => b.completionRate - a.completionRate || a.name.localeCompare(b.name));

    const recentLogs: RecentBlockchainLog[] = blockchainLogs.slice(0, 10).map(log => ({
        taskId: log.task.id,
        taskTitle: log.task.title,
        employeeName: log.task.employee?.name ?? 'Unknown',
        txHash: log.txHash,
        loggedAt: log.loggedAt,
    }));

    return {
        totalEmployees,
        activeEmployees,
        tasksAssigned,
        tasksCompleted,
        completionRate: tasksAssigned > 0 ? Math.round((tasksCompleted / tasksAssigned) * 1000) / 1000 : 0,
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
