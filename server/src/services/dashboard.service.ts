// =============================================================================
// Dashboard service — reads aggregate statistics for GET /api/dashboard.
//
// SPEC § 2.4 Dashboard Route:
//   GET /api/dashboard — org-level summary + per-employee completion stats.
//
// Design decisions:
//   1. ALL five queries run in a single Promise.all() batch — one round-trip
//      to the DB connection pool instead of five sequential awaits.
//   2. Per-employee completion rate is computed in JS, not SQL, to keep the
//      query simple and avoid a raw Prisma query. At org scale this is fine;
//      if employee count > 10k, move the ratio to a GROUP BY subquery.
//   3. orgId scoping is applied on EVERY where clause — never omitted.
//   4. Unassigned tasks (assignedTo = null) are included in tasksAssigned
//      because the SPEC does not constrain this count to assigned employees.
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

// ─── Types ────────────────────────────────────────────────────────────────────

/** One row in the per-employee breakdown array. */
export interface EmployeeCompletionStat {
    employeeId: string;
    name: string;
    role: string | null;
    department: string | null;
    isActive: boolean;
    tasksAssigned: number;   // total tasks ever assigned to this employee in this org
    tasksCompleted: number;   // subset with status = 'completed'
    completionRate: number;   // tasksCompleted / tasksAssigned, rounded to 3 d.p. (0 if no tasks)
}

/** Top-level shape returned by getDashboardStats(). */
export interface DashboardStats {
    // Org-level counters
    totalEmployees: number;
    activeEmployees: number;
    tasksAssigned: number;    // all tasks in the org (any status)
    tasksCompleted: number;    // tasks with status = 'completed'
    completionRate: number;    // org-level ratio, rounded to 3 d.p.

    // Per-employee breakdown — sorted descending by completionRate, then by name
    employeeStats: EmployeeCompletionStat[];

    // Snapshot timestamp — client can display "data as of …"
    generatedAt: Date;

    // Cache metadata — tells the client whether this response came from cache
    _meta: {
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
    const key   = dashboardCacheKey(orgId);

    // ── 1. Cache read ──────────────────────────────────────────────────────────
    if (redis) {
        try {
            const cached = await redis.get(key);
            if (cached) {
                const data = JSON.parse(cached) as DashboardStats;
                // Rehydrate generatedAt as a Date (JSON.parse gives a string)
                data.generatedAt = new Date(data.generatedAt);
                data._meta = { source: 'cache', cachedAt: data.generatedAt.toISOString() };
                return data;
            }
        } catch (err) {
            // Redis GET error (e.g. serialisation issue, timeout) — not fatal.
            console.warn('[dashboard] Redis GET failed — falling back to DB:', (err as Error).message);
        }
    }

    // ── 2. DB query ────────────────────────────────────────────────────────────
    const stats = await queryDashboardFromDB(orgId);

    // ── 3. Cache write ─────────────────────────────────────────────────────────
    if (redis) {
        try {
            // EX sets the TTL in seconds; NX is intentionally NOT used so we
            // always refresh the cache on a DB hit (no thundering-herd here at
            // org user count scale).
            await redis.set(key, JSON.stringify(stats), 'EX', DASHBOARD_TTL_SECONDS);
        } catch (err) {
            // Redis SET failure — silently swallowed; the caller gets live data.
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
 *
 * Called by task.service.updateTaskStatus() after every status transition so
 * the next GET /api/dashboard reflects the new state within at most one poll
 * cycle (rather than up to 60 s later).
 *
 * Silently no-ops when:
 *   - Redis is disabled (REDIS_URL not set)
 *   - The key does not exist (DEL on missing key is safe in Redis)
 *   - Redis throws (never blocks or crashes the task update flow)
 */
export async function invalidateDashboardCache(orgId: string): Promise<void> {
    const redis = getRedis();
    if (!redis) return;

    const key = dashboardCacheKey(orgId);
    try {
        const deleted = await redis.del(key);
        if (deleted) {
            console.log(`[dashboard] Cache invalidated for org ${orgId}`);
        }
    } catch (err) {
        // Log only — never rethrow. A failed invalidation is healed by the TTL.
        console.warn('[dashboard] Cache invalidation failed:', (err as Error).message);
    }
}

// =============================================================================
// queryDashboardFromDB — pure DB read (no cache concerns)
// =============================================================================

async function queryDashboardFromDB(orgId: string): Promise<DashboardStats> {
    //
    // ── Batch 1: Org-level aggregates ─────────────────────────────────────────
    // Five independent count queries run in parallel.
    //
    const [
        totalEmployees,
        activeEmployees,
        tasksAssigned,
        tasksCompleted,
        employeeRows,
    ] = await Promise.all([
        // 1. Total employees (active + inactive) in this org
        prisma.employee.count({
            where: { orgId },
        }),

        // 2. Active employees only
        prisma.employee.count({
            where: { orgId, isActive: true },
        }),

        // 3. All tasks in this org (any status, any assignee incl. null)
        prisma.task.count({
            where: { orgId },
        }),

        // 4. Completed tasks
        prisma.task.count({
            where: { orgId, status: 'completed' },
        }),

        // 5. Per-employee task breakdown via raw counts on the Task relation.
        //
        //    Prisma doesn't support conditional aggregation in findMany without
        //    raw SQL, so we fetch both the total task count AND the full task
        //    list per employee, then compute the completed count in JS below.
        //
        //    Alternative: use $queryRaw with GROUP BY — avoided here to keep
        //    the code Prisma-idiomatic and DB-agnostic for test environments.
        prisma.employee.findMany({
            where: { orgId },
            select: {
                id: true,
                name: true,
                role: true,
                department: true,
                isActive: true,
                // Pull ALL tasks assigned to this employee within this org.
                // The where clause on the relation join scopes to orgId.
                tasks: {
                    where: { orgId },
                    select: { status: true },
                },
            },
            orderBy: { name: 'asc' },
        }),
    ]);

    // ── Batch 2: Compute per-employee stats in JS ─────────────────────────────
    const employeeStats: EmployeeCompletionStat[] = employeeRows
        .map(emp => {
            const assigned = emp.tasks.length;
            const completed = emp.tasks.filter(t => t.status === 'completed').length;
            const rate = assigned > 0
                ? Math.round((completed / assigned) * 1000) / 1000
                : 0;

            return {
                employeeId: emp.id,
                name: emp.name,
                role: emp.role,
                department: emp.department,
                isActive: emp.isActive,
                tasksAssigned: assigned,
                tasksCompleted: completed,
                completionRate: rate,
            };
        })
        // Sort: highest completion rate first; break ties by name (already alpha)
        .sort((a, b) => b.completionRate - a.completionRate || a.name.localeCompare(b.name));

    // Org-level completion rate
    const orgCompletionRate = tasksAssigned > 0
        ? Math.round((tasksCompleted / tasksAssigned) * 1000) / 1000
        : 0;

    return {
        totalEmployees,
        activeEmployees,
        tasksAssigned,
        tasksCompleted,
        completionRate: orgCompletionRate,
        employeeStats,
        generatedAt: new Date(),
        _meta: { source: 'live' },
    };
}
