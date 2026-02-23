// =============================================================================
// AI Scoring Service — deterministic weighted scoring engine.
//
// SPEC § 2.5 "AI Scoring Engine — Full Specification"
// This module is the complete implementation of all three algorithms defined
// in the SPEC. No ML libraries. No external API calls. Pure, in-process JS.
//
//   "Rather than an opaque ML model, the AI module is a deterministic weighted
//    scoring engine. This is intentional — it is explainable, auditable, fast,
//    and honest about what it is." — SPEC § 1.3
//
// ─── Functions exported ───────────────────────────────────────────────────────
//   computeProductivityScore(payload)   — score + breakdown for one employee
//   recommendEmployees(taskId, orgId)   — ranked top-3 candidates for a task
//   detectSkillGaps(employeeId, orgId)  — missing skills vs tasks for their role
//   getPerformanceTrend(employeeId)     — last-30d vs prev-30d score delta
//
// ─── Determinism guarantee ────────────────────────────────────────────────────
//   Given the same DB state, every function returns the same result.
//   No randomness. No timestamps in scoring arithmetic. No floating-point
//   hacks — the only rounding is the final Math.round at the score level.
//
// ─── Layer contract ───────────────────────────────────────────────────────────
//   This service owns computation, NOT scheduling.
//   Scheduling (setImmediate / BullMQ) lives in lib/jobQueue.ts.
//   The entry-point computeProductivityScore() is called by dispatchJob() in
//   task.service.ts after a task transitions to 'completed'.
//
// ─── Error contract ───────────────────────────────────────────────────────────
//   Functions may throw. dispatchJob() catches errors from the async entry-point.
//   Direct callers (AI controller) use try/catch.
// =============================================================================

import prisma from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import {
    computeProductivityScore as _pureScore,
    scoreToGrade,
    computeRank,
    computeSkillOverlap,
} from '../lib/scoring';
import {
    persistLog,
    getScoreHistory,
    getLatestScoreMap,
} from '../lib/performanceLog';
import { getRedis, cacheKey, AI_SCORE_NS, AI_SCORE_TTL,
         GEMINI_SCORE_NS, GEMINI_SKILL_NS, GEMINI_TREND_NS, GEMINI_RECOMMEND_NS, GEMINI_TTL,
} from '../lib/redis';
import { callGemini } from '../lib/gemini';

// =============================================================================
// § 0 — Gemini Cache Helpers (private)
//        Cache-aside pattern for the three Gemini endpoints.
//        TTL: GEMINI_TTL (600 s / 10 min) — separate from AI_SCORE_TTL (300 s).
//        Both helpers short-circuit silently when Redis is unavailable so that
//        a Redis outage never blocks an LLM call.
// =============================================================================

/** Return a cached Gemini response, or null on miss / Redis unavailable. */
async function geminiCacheGet<T>(key: string): Promise<T | null> {
    const redis = getRedis();
    if (!redis) return null;
    try {
        const cached = await redis.get(key);
        return cached ? (JSON.parse(cached) as T) : null;
    } catch (err) {
        console.warn('[ai.service] Gemini cache GET failed:', (err as Error).message);
        return null;
    }
}

/** Persist a Gemini response. Fire-and-forget — errors are logged, not thrown. */
async function geminiCacheSet(key: string, value: unknown): Promise<void> {
    const redis = getRedis();
    if (!redis) return;
    try {
        await redis.set(key, JSON.stringify(value), 'EX', GEMINI_TTL);
    } catch (err) {
        console.warn('[ai.service] Gemini cache SET failed:', (err as Error).message);
    }
}

// =============================================================================
// § 1 — Shared Types
// =============================================================================

/** SPEC § 2.4 Score Response shape. Returned by the AI controller. */
export interface ProductivityScoreResult {
    employeeId: string;
    name: string;
    score: number | null;       // null when no tasks assigned
    grade: string | null;       // null when score is null
    breakdown: ScoringBreakdown | null;
    trend: 'improving' | 'declining' | 'stable' | 'insufficient_data';
    trendAnalysis: TrendAnalysis;
    computedAt: Date;
}

/**
 * 30-day trend analysis result.
 *
 * Windows:
 *   recent   — last 7 days   (days 0–7)
 *   previous — prior 23 days (days 7–30)
 *
 * delta: percentage change of recent avg relative to previous avg.
 *   = ((recentAvg - prevAvg) / prevAvg) * 100, rounded to 1 decimal place.
 *   null when either window has no data (see trend: 'insufficient_data').
 *
 * trend:
 *   'up'   → delta >  1 %
 *   'down' → delta < -1 %
 *   'flat' → |delta| ≤ 1 %  OR  insufficient_data
 */
export interface TrendAnalysis {
    trend: 'up' | 'down' | 'flat';
    delta: number | null;   // percentage points, 1 d.p.; null = no data
    recentAvg: number | null;    // avg score over last 7 days
    previousAvg: number | null;  // avg score over days 7–30
}

/** SPEC § 2.3: breakdown JSONB shape. */
export interface ScoringBreakdown {
    completionRate: number;   // 0–1
    onTimeRate: number;   // 0–1
    avgComplexity: number;   // 1–5 raw average
    totalTasksAssigned: number;
    totalCompleted: number;
    totalOnTime: number;
}

/** SPEC § 2.5: one entry in the ranked recommendation list. */
export interface RecommendationEntry {
    employee:         { id: string; name: string; jobTitle: string | null; department: string | null; skills: string[] };
    skillOverlap:     number;   // raw count of matched skills
    skillOverlapRate: number;   // overlap / requiredCount, 0–1 (the factor fed into rank)
    activeCount:      number;   // open (non-COMPLETED) tasks currently assigned
    perfScore:        number;   // latest productivity score (50 default if no history)
    rank:             number;   // composite score 0–100 — higher = better fit
}

/** SPEC § 2.5: skill gap analysis result. */
export interface SkillGapResult {
    employeeId: string;
    name: string;
    currentSkills: string[];
    requiredSkills: string[];   // union of all skills required by tasks for this role
    gapSkills: string[];
    coverageRate: number;     // (requiredSkills.size − gaps.length) / requiredSkills.size
}

/** Payload passed from task.service via jobQueue when a task completes. */
export interface ScoreJobPayload {
    orgId: string;   // tenant scope — for audit log
    taskId: string;   // the completed task
    employeeId: string;   // the employee to score
}

// =============================================================================
// § 2 — Pure computation delegates
//        All formula logic lives in lib/scoring.ts (zero dependencies, testable).
//        These aliases ensure ai.service remains the single API surface for
//        callers — they import from ai.service, not from lib/scoring directly.
// =============================================================================

// =============================================================================
// § 3 — Database-backed computeProductivityScore()
//        Entry point called by task.service via dispatchJob().
// =============================================================================

/**
 * Triggered when task.status transitions to 'completed'.
 * Reads ALL active tasks assigned to this employee within the org, runs the
 * pure weighted scoring formula, persists the result to performance_logs,
 * then invalidates the Redis cache for key ai:score:<employeeId>.
 *
 * ⚠ Called via the Postgres job queue — must not be awaited at HTTP call sites.
 *   Errors propagate to jobQueue's retry handler.
 */
export async function computeProductivityScore(
    payload: ScoreJobPayload,
): Promise<void> {
    const { orgId, taskId, employeeId } = payload;

    // Fetch all active tasks for this employee in this org.
    // isActive: true — soft-deleted tasks are excluded from scoring.
    // orgId guard — prevents cross-tenant reads even in the background job.
    const tasks = await prisma.task.findMany({
        where: { orgId, assignedTo: employeeId, isActive: true },
        select: { status: true, complexityScore: true, dueDate: true, completedAt: true },
    });

    // Pure scorer — returns { score, completionRate, onTimeRate, avgComplexity }
    const result = _pureScore(tasks);

    // Persist — HISTORY POLICY: persistLog() always INSERTs, never overwrites.
    const logRecord = await persistLog({
        orgId,
        employeeId,
        score: tasks.length > 0 ? result.score : null,
        breakdown: tasks.length > 0
            ? {
                completionRate:     result.completionRate,
                onTimeRate:         result.onTimeRate,
                avgComplexity:      result.avgComplexity,
                totalTasksAssigned: tasks.length,
                totalCompleted:     tasks.filter(t => t.status === 'COMPLETED').length,
                totalOnTime:        0,
              }
            : null,
    });

    console.info(
        `[ai.service] Score persisted — ` +
        `org=${orgId} task=${taskId} employee=${employeeId} ` +
        `score=${logRecord.score ?? 'null'} log=${logRecord.id}`,
    );

    // ── Invalidate cache ──────────────────────────────────────────────────────
    // Key: ai:score:<employeeId>  (matches what getScore() writes)
    const redis = getRedis();
    if (redis) {
        const key = cacheKey(AI_SCORE_NS, employeeId);
        await redis.del(
            key,
            // Gemini keys — all keyed by employeeId except recommend (keyed by taskId)
            cacheKey(GEMINI_SCORE_NS,     employeeId),
            cacheKey(GEMINI_SKILL_NS,     employeeId),
            cacheKey(GEMINI_TREND_NS,     employeeId),
            cacheKey(GEMINI_RECOMMEND_NS, taskId),
        ).catch((err: unknown) => {
            console.warn('[ai.service] Cache invalidation failed:', (err as Error).message);
        });
        console.info(`[ai.service] Cache invalidated — key=${key} + Gemini keys for employee=${employeeId} task=${taskId}`);
    }
}

// =============================================================================
// § 4 — getScore()
//        Direct query used by GET /api/ai/score/:employeeId.
// =============================================================================

/**
 * Compute and return the current productivity score for one employee.
 * Read-only — does NOT persist a new log row.
 *
 * Cache strategy:
 *   Key:  ai:score:<employeeId>
 *   TTL:  300 s (AI_SCORE_TTL)
 *   Hit:  return cached JSON directly (computedAt re-hydrated as Date)
 *   Miss: compute from DB → store in Redis → return fresh result
 *
 * Invalidation: performed by computeProductivityScore() (job worker) whenever
 *   a new performance_log row is inserted for this employee.
 *
 * SPEC § 2.4 Score Response shape:
 *   { employeeId, name, score, grade, breakdown, trend, computedAt }
 */
export async function getScore(
    orgId: string,
    employeeId: string,
): Promise<ProductivityScoreResult> {
    const redis = getRedis();
    // Key format matches the invalidation key written by computeProductivityScore().
    const key = cacheKey(AI_SCORE_NS, employeeId);  // → hrms:ai:score:<employeeId>

    // ── 1. Cache read ──────────────────────────────────────────────────────────
    if (redis) {
        try {
            const cached = await redis.get(key);
            if (cached) {
                const data = JSON.parse(cached) as ProductivityScoreResult;
                // JSON.parse loses the Date prototype — restore it.
                data.computedAt = new Date(data.computedAt);
                return data;
            }
        } catch (err) {
            // Redis error is non-fatal — fall through to DB computation.
            console.warn('[ai.service] Redis GET failed:', (err as Error).message);
        }
    }

    // ── 2. DB computation (cache miss) ─────────────────────────────────────────

    // Ownership + existence check (org-scoped).
    const employee = await prisma.employee.findFirst({
        where: { id: employeeId, orgId },
        select: { id: true, name: true },
    });
    if (!employee) {
        throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found');
    }

    // Fetch all *active* tasks — soft-deleted tasks must not affect the score.
    const tasks = await prisma.task.findMany({
        where: { orgId, assignedTo: employeeId, isActive: true },
        select: { status: true, complexityScore: true, dueDate: true, completedAt: true },
    });

    // Pure scorer — { score, completionRate, onTimeRate, avgComplexity }
    const result        = _pureScore(tasks);
    const trendAnalysis = await computeTrendAnalysis(orgId, employeeId);

    // Build the full SPEC response shape.
    // grade derived from score using the existing scoreToGrade helper.
    const scoreResult: ProductivityScoreResult = {
        employeeId,
        name:          employee.name,
        score:         tasks.length > 0 ? result.score : null,
        grade:         tasks.length > 0 ? scoreToGrade(result.score) : null,
        breakdown:     tasks.length > 0
            ? {
                completionRate:     result.completionRate,
                onTimeRate:         result.onTimeRate,
                avgComplexity:      result.avgComplexity,
                totalTasksAssigned: tasks.length,
                totalCompleted:     tasks.filter(t => t.status === 'COMPLETED').length,
                totalOnTime:        0,
              }
            : null,
        trend:         toLegacyTrend(trendAnalysis),
        trendAnalysis,
        computedAt:    new Date(),
    };

    // ── 3. Cache write ─────────────────────────────────────────────────────────
    // TTL: AI_SCORE_TTL (300 s). Errors are logged but never propagated.
    if (redis) {
        try {
            await redis.set(key, JSON.stringify(scoreResult), 'EX', AI_SCORE_TTL);
        } catch (err) {
            console.warn('[ai.service] Redis SET failed:', (err as Error).message);
        }
    }

    return scoreResult;
}

// =============================================================================
// § 5 — computeTrendAnalysis()
//        30-day window split: last 7 days vs prior 23 days.
// =============================================================================

/**
 * Compare the last 7 days of performance log scores against the prior 23 days
 * (together spanning a 30-day window) to produce a directional trend.
 *
 * Windows (relative to now):
 *   recent   → [now-7d,  now)    — the "what's happening now" signal
 *   previous → [now-30d, now-7d) — the baseline to compare against
 *
 * delta % = ((recentAvg - prevAvg) / prevAvg) × 100, rounded to 1 d.p.
 *   Positive → scores are going up.
 *   Negative → scores are going down.
 *
 * trend thresholds:
 *   'up'   → delta >  1 %
 *   'down' → delta < -1 %
 *   'flat' → |delta| ≤ 1 %  or  either window has no data
 *
 * The legacy `trend` field on ProductivityScoreResult maps as:
 *   'up'   → 'improving'
 *   'down' → 'declining'
 *   'flat' → 'stable' | 'insufficient_data'
 */
async function computeTrendAnalysis(
    orgId: string,
    employeeId: string,
): Promise<TrendAnalysis> {
    const now  = new Date();
    const d7   = new Date(now.getTime() -  7 * 24 * 60 * 60 * 1000);
    const d30  = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Single DB call — fetch all non-null score rows for the 30-day window.
    // getScoreHistory returns rows ordered DESC by createdAt.
    const logs = await getScoreHistory(orgId, employeeId, d30);

    const recent   = logs.filter(l => l.computedAt >= d7);
    const previous = logs.filter(l => l.computedAt <  d7);   // already >= d30 by the query

    if (recent.length === 0 || previous.length === 0) {
        return { trend: 'flat', delta: null, recentAvg: null, previousAvg: null };
    }

    const avg = (rows: typeof logs) =>
        rows.reduce((s, l) => s + l.score, 0) / rows.length;

    const recentAvg   = avg(recent);
    const previousAvg = avg(previous);

    // Percentage delta relative to the previous window baseline.
    const rawDelta = ((recentAvg - previousAvg) / previousAvg) * 100;
    const delta    = Math.round(rawDelta * 10) / 10;   // 1 d.p.

    const trend: TrendAnalysis['trend'] =
        delta >  1 ? 'up'   :
        delta < -1 ? 'down' :
                     'flat';

    return {
        trend,
        delta,
        recentAvg:   Math.round(recentAvg   * 10) / 10,
        previousAvg: Math.round(previousAvg * 10) / 10,
    };
}

/** Map TrendAnalysis → legacy trend label on ProductivityScoreResult. */
function toLegacyTrend(
    ta: TrendAnalysis,
): ProductivityScoreResult['trend'] {
    if (ta.delta === null) return 'insufficient_data';
    if (ta.trend === 'up')   return 'improving';
    if (ta.trend === 'down') return 'declining';
    return 'stable';
}

// =============================================================================
// § 6 — recommendEmployees()
//        SPEC § 2.5 "Smart Task Assignment Algorithm"
// =============================================================================

export interface RecommendInput {
    orgId: string;
    taskId: string;
}

/**
 * Returns ranked top-3 employees best suited for a given task.
 *
 * Ranking formula (weights sum to 100, all sub-scores normalized 0–1):
 *
 *   rank = (skillOverlapRate × 50)
 *         + (inverseActiveRate × 30)
 *         + (perfRate × 20)
 *
 *   skillOverlapRate  = matchedSkills / max(requiredSkills, 1)
 *   inverseActiveRate = max(0, 10 − activeCount) / 10
 *   perfRate          = clamp(perfScore, 0, 100) / 100   (default 50 when absent)
 *
 * Output: rank ∈ [0, 100]. Higher = better fit.
 *
 * Department scoping:
 *   When the task already has an assignee, the employee pool is narrowed to
 *   that assignee's department. Otherwise all active employees in the org
 *   are considered — consistent with "find the best available person".
 */
export async function recommendEmployees(
    input: RecommendInput,
): Promise<RecommendationEntry[]> {
    const { orgId, taskId } = input;

    // ── Fetch task ─────────────────────────────────────────────────────────────
    const task = await prisma.task.findFirst({
        where: { id: taskId, orgId },
        select: { requiredSkills: true, assignedTo: true },
    });
    if (!task) {
        throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }

    // Infer target department from the currently assigned employee (if any)
    let targetDepartment: string | null = null;
    if (task.assignedTo) {
        const assignee = await prisma.employee.findFirst({
            where: { id: task.assignedTo, orgId },
            select: { department: true },
        });
        targetDepartment = assignee?.department ?? null;
    }

    // ── Fetch active employees ─────────────────────────────────────────────────
    // SPEC: filter to department when available; otherwise consider all active employees
    const employees = await prisma.employee.findMany({
        where: {
            orgId,
            isActive: true,
            ...(targetDepartment && { department: targetDepartment }),
        },
        select: { id: true, name: true, jobTitle: true, department: true, skills: true },
    });

    // ── Fetch latest performance score per employee ────────────────────────────
    // Delegates to getLatestScoreMap() in lib/performanceLog — batched single
    // query, decoded to Map<employeeId, number>. Absent employees default to 50.
    const employeeIds = employees.map(e => e.id);
    const scoreMap = await getLatestScoreMap(orgId, employeeIds);

    // ── Fetch active task counts per employee ──────────────────────────────────
    // "active" = not completed (assigned or in_progress)
    const activeCounts = await prisma.task.groupBy({
        by: ['assignedTo'],
        where: {
            orgId,
            assignedTo: { in: employeeIds },
            status: { not: 'COMPLETED' },
        },
        _count: { id: true },
    });
    const activeCountMap = new Map<string, number>(
        activeCounts
            .filter(r => r.assignedTo !== null)
            .map(r => [r.assignedTo as string, r._count.id]),
    );

    // ── Compute rank per employee and sort ────────────────────────────────────
    // New formula: (skillOverlapRate×50) + (inverseActiveRate×30) + (perfRate×20)
    // All three sub-scores are normalized to [0,1] before weighting → rank ∈ [0,100].
    const requiredCount = task.requiredSkills.length;

    const ranked: RecommendationEntry[] = employees.map(employee => {
        const skillOverlap     = computeSkillOverlap(employee.skills, task.requiredSkills);
        const skillOverlapRate = skillOverlap / Math.max(requiredCount, 1);
        const activeCount      = activeCountMap.get(employee.id) ?? 0;
        const perfScore        = scoreMap.get(employee.id) ?? 50;

        // computeRank now takes requiredCount so it can normalise internally —
        // the rate stored on the entry matches the factor used in the formula.
        const rank = computeRank(skillOverlap, requiredCount, activeCount, perfScore);

        return { employee, skillOverlap, skillOverlapRate, activeCount, perfScore, rank };
    });

    // SPEC: ".sort((a, b) => b.rank - a.rank).slice(0, 3)"
    return ranked
        .sort((a, b) => b.rank - a.rank)
        .slice(0, 3);
}

// =============================================================================
// § 7 — detectSkillGaps()
//        SPEC § 2.5 "Skill Gap Detection Algorithm"
// =============================================================================

export interface SkillGapInput {
    orgId: string;
    employeeId: string;
}

/**
 * Identifies skills an employee lacks based on tasks assigned to their role.
 *
 * SPEC algorithm (verbatim):
 *   requiredSkills = union of all task.requiredSkills for tasks of employee's role
 *   gaps = requiredSkills − employee.skills
 *   coverageRate = (requiredSkills.size − gaps.length) / requiredSkills.size
 *
 * "Role" context: tasks don't have a role field directly. We fetch all tasks in
 * the org that share any requiredSkill with tasks previously assigned to this
 * employee — effectively "what does this employee's function require".
 * Simpler and correct interpretation: fetch all tasks for this org that have
 * been assigned to employees with the same role as this employee.
 */
export async function detectSkillGaps(
    input: SkillGapInput,
): Promise<SkillGapResult> {
    const { orgId, employeeId } = input;

    // ── Step 1: Fetch employee ────────────────────────────────────────────────
    // Org-scoped — a valid employeeId from another org returns 404.
    const employee = await prisma.employee.findFirst({
        where: { id: employeeId, orgId, isActive: true },
        select: { id: true, name: true, jobTitle: true, skills: true },
    });
    if (!employee) {
        throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found');
    }

    // ── Step 2: Collect requiredSkills from tasks in the same jobTitle ────────
    // Strategy: find all active employees sharing this jobTitle in the org, then
    // take the union of requiredSkills from ALL tasks ever assigned to them
    // (active and soft-deleted tasks both count — they describe the role's scope).
    // Fall back to this employee's own tasks when jobTitle is null.
    let allTasksForRole: { requiredSkills: string[] }[];

    if (employee.jobTitle) {
        const sameRoleIds = await prisma.employee
            .findMany({
                where: { orgId, jobTitle: employee.jobTitle, isActive: true },
                select: { id: true },
            })
            .then(rows => rows.map(r => r.id));

        allTasksForRole = await prisma.task.findMany({
            where: { orgId, assignedTo: { in: sameRoleIds } },
            select: { requiredSkills: true },
        });
    } else {
        // No jobTitle — scope to tasks personally assigned to this employee.
        allTasksForRole = await prisma.task.findMany({
            where: { orgId, assignedTo: employeeId },
            select: { requiredSkills: true },
        });
    }

    // ── Step 3: Compute gap set ───────────────────────────────────────────────
    // All comparisons are case-insensitive to tolerate mixed-case skill strings.
    const requiredSet  = new Set(
        allTasksForRole.flatMap(t => t.requiredSkills).map(s => s.toLowerCase()),
    );
    const employeeSet  = new Set(employee.skills.map(s => s.toLowerCase()));

    // gapSkills = requiredSkills − employee.skills
    const gapSkills    = [...requiredSet].filter(s => !employeeSet.has(s));

    // coverageRate = (|required| − |gaps|) / |required|
    // Edge: no required skills means 100 % coverage by definition.
    const coverageRate = requiredSet.size > 0
        ? (requiredSet.size - gapSkills.length) / requiredSet.size
        : 1;

    return {
        employeeId,
        name:          employee.name,
        currentSkills: employee.skills,
        requiredSkills: [...requiredSet],
        gapSkills,
        coverageRate:  Math.round(coverageRate * 1000) / 1000,  // 3 d.p.
    };
}

// =============================================================================
// § 8 — getGeminiSkillGap()
//        Gemini-powered skill gap detection.
//        Complements detectSkillGaps() with LLM reasoning — Gemini receives
//        the employee's current skills, job title, department, and the union of
//        peer task skills, then infers which skills are missing or emerging.
//
// Route: GET /api/ai/gemini/skill-gap/:employeeId
// =============================================================================

/** Gemini's raw response shape for the skill-gap prompt. */
interface GeminiSkillGapResponse {
    missingSkills:     string[];   // skills Gemini identifies as gaps
    emergingSkills:    string[];   // adjacent skills worth developing
    rationale:         string;     // 1–2 sentence explanation
    confidence:        'high' | 'medium' | 'low';
}

/** Public return shape for getGeminiSkillGap(). */
export interface GeminiSkillGapResult {
    employeeId:     string;
    name:           string;
    jobTitle:       string | null;
    department:     string | null;
    currentSkills:  string[];
    peerTaskSkills: string[];    // union of skills from peer task data sent to Gemini
    missingSkills:  string[];    // Gemini's identified gaps
    emergingSkills: string[];    // Gemini's "worth developing" suggestions
    rationale:      string;
    confidence:     'high' | 'medium' | 'low';
    source:         'gemini';    // disambiguates from deterministic detectSkillGaps()
}

/**
 * Gemini-powered skill gap detection for one employee.
 *
 * Steps:
 *   1. Fetch employee profile (skills, jobTitle, department).
 *   2. Collect peer task skills — union of requiredSkills from tasks assigned
 *      to active employees with the same jobTitle in the org.
 *      Falls back to the employee's own tasks when jobTitle is null.
 *   3. Build a structured prompt and call Gemini.
 *   4. Return Gemini's missingSkills[] alongside context fields.
 *
 * Graceful degradation:
 *   If GEMINI_API_KEY is absent or Gemini times out, a GeminiUnavailableError
 *   propagates to the controller which converts it to a 503 response.
 */
export async function getGeminiSkillGap(
    orgId:      string,
    employeeId: string,
): Promise<GeminiSkillGapResult> {
    // ── 0. Cache read ─────────────────────────────────────────────────────────
    const skillKey = cacheKey(GEMINI_SKILL_NS, employeeId);
    const cached   = await geminiCacheGet<GeminiSkillGapResult>(skillKey);
    if (cached) {
        console.info(`[ai.service] Gemini skill-gap cache HIT — key=${skillKey}`);
        return cached;
    }

    // ── 1. Fetch employee ─────────────────────────────────────────────────────
    const employee = await prisma.employee.findFirst({
        where: { id: employeeId, orgId, isActive: true },
        select: { id: true, name: true, jobTitle: true, department: true, skills: true },
    });
    if (!employee) {
        throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found');
    }

    // ── 2. Collect peer task skills ───────────────────────────────────────────
    // "Peer tasks" = tasks assigned to active employees with the same jobTitle.
    // When jobTitle is null, fall back to this employee's own tasks.
    let peerTaskRows: { requiredSkills: string[] }[];

    if (employee.jobTitle) {
        const peerIds = await prisma.employee
            .findMany({
                where: { orgId, jobTitle: employee.jobTitle, isActive: true },
                select: { id: true },
            })
            .then(rows => rows.map(r => r.id));

        peerTaskRows = await prisma.task.findMany({
            where: { orgId, assignedTo: { in: peerIds } },
            select: { requiredSkills: true },
        });
    } else {
        peerTaskRows = await prisma.task.findMany({
            where: { orgId, assignedTo: employeeId },
            select: { requiredSkills: true },
        });
    }

    // Deduplicated, case-normalised skill union from peer tasks.
    const peerTaskSkills: string[] = [
        ...new Set(
            peerTaskRows.flatMap(t => t.requiredSkills).map(s => s.toLowerCase()),
        ),
    ];

    // ── 3. Build Gemini prompt ────────────────────────────────────────────────
    const employeeSkillList = employee.skills.length > 0
        ? employee.skills.join(', ')
        : '(none recorded)';

    const peerSkillList = peerTaskSkills.length > 0
        ? peerTaskSkills.join(', ')
        : '(no peer task data)';

    const prompt = `
You are an expert HR skills analyst. Analyse the following employee data and identify skill gaps.
Return ONLY a valid JSON object — no markdown, no text outside the JSON.

EMPLOYEE PROFILE
  Name:       ${employee.name}
  Job title:  ${employee.jobTitle ?? '(not set)'}
  Department: ${employee.department ?? '(not set)'}
  Current skills: [${employeeSkillList}]

PEER TASK SKILLS
These are skills required by tasks assigned to employees with the same job title in the same organisation.
They represent what the role demands in practice:
  [${peerSkillList}]

INSTRUCTIONS
1. missingSkills  — list skills present in PEER TASK SKILLS but absent from Current skills.
   Normalise to lowercase. Include only skills directly relevant to the role.
   Return an empty array [] if there are no gaps.

2. emergingSkills — list up to 3 adjacent or complementary skills NOT in peer task data
   that would benefit someone in this role (${employee.jobTitle ?? 'this role'}) in the
   current technology landscape. Return [] if job title is unknown.

3. rationale — 1–2 sentences explaining the key gaps and their potential impact on
   the employee's effectiveness in their role.

4. confidence — 'high' when peer task data has ≥ 5 distinct skills,
                'medium' when 1–4 distinct skills,
                'low' when no peer task data available.

REQUIRED JSON SCHEMA (return exactly this shape, no extra fields):
{
  "missingSkills":  ["<skill>", ...],
  "emergingSkills": ["<skill>", ...],
  "rationale":      "<string>",
  "confidence":     "<'high' | 'medium' | 'low'>"
}
`.trim();

    // ── 4. Call Gemini ────────────────────────────────────────────────────────
    // GeminiUnavailableError propagates — controller maps it to 503.
    const geminiResult = await callGemini<GeminiSkillGapResponse>(prompt);

    // Normalise Gemini's arrays (it may return mixed-case)
    const missingSkills  = (geminiResult.missingSkills  ?? []).map(s => s.toLowerCase());
    const emergingSkills = (geminiResult.emergingSkills ?? []).map(s => s.toLowerCase());

    const result: GeminiSkillGapResult = {
        employeeId:     employee.id,
        name:           employee.name,
        jobTitle:       employee.jobTitle,
        department:     employee.department,
        currentSkills:  employee.skills,
        peerTaskSkills,
        missingSkills,
        emergingSkills,
        rationale:      geminiResult.rationale   ?? '',
        confidence:     geminiResult.confidence  ?? 'low',
        source:         'gemini',
    };

    // ── 5. Cache the result ───────────────────────────────────────────────────
    void geminiCacheSet(skillKey, result);
    console.info(`[ai.service] Gemini skill-gap cache SET — key=${skillKey} ttl=${GEMINI_TTL}s`);

    return result;
}

// =============================================================================
// § 9 — recommendEmployeeGemini()
//        Gemini-powered task-to-employee recommendation.
//
//        Complements recommendEmployees() (deterministic formula) with LLM
//        reasoning. Gemini receives the full task requirements, all active
//        employee profiles, their current workload, and their latest
//        productivity scores, then picks the single best employee and explains
//        why.
//
// Route: GET /api/ai/gemini/recommend/:taskId
// =============================================================================

/** One employee row as seen by Gemini in the recommendation prompt. */
interface GeminiCandidateRow {
    id:           string;
    name:         string;
    jobTitle:     string | null;
    department:   string | null;
    skills:       string[];
    activeTasks:  number;    // open (non-COMPLETED) tasks
    perfScore:    number;    // latest productivity score; 50 when no history
}

/** Gemini's raw JSON response for the recommendation prompt. */
interface GeminiRecommendResponse {
    bestEmployeeId: string;
    name:           string;
    reasoning: {
        skillMatch:    string;   // why skills fit
        workloadFit:   string;   // why workload is suitable
        performanceFit: string;  // why productivity score supports this
        overall:       string;   // 1–2 sentence summary
    };
    confidence: 'high' | 'medium' | 'low';
    alternativeIds: string[];   // up to 2 runner-up employee IDs
}

/** Public return type for recommendEmployeeGemini(). */
export interface GeminiRecommendResult {
    taskId:         string;
    taskTitle:      string;
    bestEmployeeId: string;
    bestEmployeeName: string;
    reasoning: {
        skillMatch:     string;
        workloadFit:    string;
        performanceFit: string;
        overall:        string;
    };
    confidence:      'high' | 'medium' | 'low';
    alternativeIds:  string[];
    source:          'gemini';
}

/**
 * Gemini-powered single-employee recommendation for a given task.
 *
 * Steps:
 *   1. Fetch task (requiredSkills, priority, complexityScore, title).
 *   2. Fetch all active employees in the org with their skills.
 *   3. Batch-fetch active task counts (groupBy) and latest perf scores.
 *   4. Build a structured prompt with all candidate rows.
 *   5. Call Gemini — returns bestEmployeeId + structured reasoning.
 *   6. Validate bestEmployeeId is a real candidate (prevent hallucination).
 *
 * Graceful degradation:
 *   GeminiUnavailableError propagates — controller maps it to 503.
 */
export async function recommendEmployeeGemini(
    orgId:  string,
    taskId: string,
): Promise<GeminiRecommendResult> {
    // ── 0. Cache read ─────────────────────────────────────────────────────────
    const recKey       = cacheKey(GEMINI_RECOMMEND_NS, taskId);
    const cachedRec    = await geminiCacheGet<GeminiRecommendResult>(recKey);
    if (cachedRec) {
        console.info(`[ai.service] Gemini recommend cache HIT — key=${recKey}`);
        return cachedRec;
    }

    // ── 1. Fetch task ─────────────────────────────────────────────────────────
    const task = await prisma.task.findFirst({
        where: { id: taskId, orgId, isActive: true },
        select: {
            id:             true,
            title:          true,
            description:    true,
            priority:       true,
            complexityScore: true,
            requiredSkills: true,
            assignedTo:     true,
        },
    });
    if (!task) {
        throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }

    // ── 2. Fetch all active employees ─────────────────────────────────────────
    const employees = await prisma.employee.findMany({
        where: { orgId, isActive: true },
        select: { id: true, name: true, jobTitle: true, department: true, skills: true },
    });
    if (employees.length === 0) {
        throw new AppError(422, 'NO_CANDIDATES', 'No active employees found in this organisation');
    }

    const employeeIds = employees.map(e => e.id);

    // ── 3a. Active task counts per employee (non-COMPLETED) ───────────────────
    const activeCounts = await prisma.task.groupBy({
        by: ['assignedTo'],
        where: { orgId, assignedTo: { in: employeeIds }, status: { not: 'COMPLETED' }, isActive: true },
        _count: { id: true },
    });
    const activeCountMap = new Map<string, number>(
        activeCounts
            .filter(r => r.assignedTo !== null)
            .map(r => [r.assignedTo as string, r._count.id]),
    );

    // ── 3b. Latest productivity score per employee ────────────────────────────
    const scoreMap = await getLatestScoreMap(orgId, employeeIds);

    // ── 4. Assemble candidate rows ────────────────────────────────────────────
    const candidates: GeminiCandidateRow[] = employees.map(e => ({
        id:          e.id,
        name:        e.name,
        jobTitle:    e.jobTitle,
        department:  e.department,
        skills:      e.skills,
        activeTasks: activeCountMap.get(e.id) ?? 0,
        perfScore:   scoreMap.get(e.id) ?? 50,
    }));

    // ── 5. Build Gemini prompt ────────────────────────────────────────────────
    const requiredSkillsStr = task.requiredSkills.length > 0
        ? task.requiredSkills.join(', ')
        : '(none specified)';

    // Format candidates as a compact numbered list — keeps token count low
    const candidateLines = candidates.map((c, i) => {
        const skills      = c.skills.length > 0 ? c.skills.join(', ') : '(none)';
        const jobTitle    = c.jobTitle    ?? '(not set)';
        const department  = c.department  ?? '(not set)';
        return (
            `  ${i + 1}. ID=${c.id}\n` +
            `     Name=${c.name} | JobTitle=${jobTitle} | Dept=${department}\n` +
            `     Skills=[${skills}]\n` +
            `     ActiveTasks=${c.activeTasks} | ProductivityScore=${c.perfScore}`
        );
    }).join('\n');

    const prompt = `
You are an expert HR task-assignment AI. Select the single best employee for the task below.
Return ONLY a valid JSON object — no markdown, no text outside the JSON.

TASK
  ID:              ${task.id}
  Title:           ${task.title}
  Description:     ${task.description ?? '(none)'}
  Priority:        ${task.priority}
  ComplexityScore: ${task.complexityScore}/5
  RequiredSkills:  [${requiredSkillsStr}]

EMPLOYEE CANDIDATES  (${candidates.length} active employees)
${candidateLines}

SELECTION CRITERIA  (consider all three — do not optimise for skill overlap alone)
  1. Skill match     — how many of RequiredSkills does the employee have?
                       Full match preferred; partial match acceptable over zero.
  2. Workload fit    — prefer employees with fewer ActiveTasks.
                       Employees with ActiveTasks ≥ 8 should only be chosen
                       if no lower-workload candidate has acceptable skills.
  3. Performance fit — prefer employees with higher ProductivityScore (0–100).
                       A score of 50 means no history — treat as neutral.

INSTRUCTIONS
  bestEmployeeId  — must be one of the IDs listed above, copied verbatim.
  name            — the matching employee's name, copied verbatim.
  reasoning       — four fields:
      skillMatch:     1 sentence on why this employee's skills fit.
      workloadFit:    1 sentence on their current workload.
      performanceFit: 1 sentence on their productivity score.
      overall:        1–2 sentence summary of why they are the best choice.
  confidence      — 'high' when a clear best candidate exists,
                    'medium' when two candidates are close,
                    'low' when all candidates have significant weaknesses.
  alternativeIds  — IDs of up to 2 runner-up employees (can be empty []).
                    Must be valid IDs from the list above, NOT bestEmployeeId.

REQUIRED JSON SCHEMA (return exactly this shape, no extra fields):
{
  "bestEmployeeId": "<UUID>",
  "name":           "<string>",
  "reasoning": {
    "skillMatch":     "<string>",
    "workloadFit":    "<string>",
    "performanceFit": "<string>",
    "overall":        "<string>"
  },
  "confidence":     "<'high' | 'medium' | 'low'>",
  "alternativeIds": ["<UUID>", ...]
}
`.trim();

    // ── 6. Call Gemini ────────────────────────────────────────────────────────
    const geminiResult = await callGemini<GeminiRecommendResponse>(prompt);

    // ── 7. Validate bestEmployeeId against the real candidate set ─────────────
    // Prevents hallucinated IDs reaching the caller.
    const candidateIdSet = new Set(employeeIds);
    if (!candidateIdSet.has(geminiResult.bestEmployeeId)) {
        // Fall back to the top deterministic candidate rather than 500-ing.
        const fallback = candidates
            .sort((a, b) => {
                const aOverlap = computeSkillOverlap(a.skills, task.requiredSkills);
                const bOverlap = computeSkillOverlap(b.skills, task.requiredSkills);
                return bOverlap - aOverlap || a.activeTasks - b.activeTasks;
            })[0]!;
        geminiResult.bestEmployeeId = fallback.id;
        geminiResult.name           = fallback.name;
        geminiResult.confidence     = 'low';
        geminiResult.reasoning      = {
            skillMatch:     'Gemini returned an invalid ID; fell back to highest skill-overlap candidate.',
            workloadFit:    `Active tasks: ${fallback.activeTasks}`,
            performanceFit: `Productivity score: ${fallback.perfScore}`,
            overall:        'Fallback selection — Gemini response could not be validated.',
        };
    }

    // Sanitise alternativeIds — drop any that aren't real candidates or equal bestEmployeeId
    const safeAlternatives = (geminiResult.alternativeIds ?? [])
        .filter(id => candidateIdSet.has(id) && id !== geminiResult.bestEmployeeId)
        .slice(0, 2);

    const recResult: GeminiRecommendResult = {
        taskId:           task.id,
        taskTitle:        task.title,
        bestEmployeeId:   geminiResult.bestEmployeeId,
        bestEmployeeName: geminiResult.name,
        reasoning:        geminiResult.reasoning,
        confidence:       geminiResult.confidence ?? 'low',
        alternativeIds:   safeAlternatives,
        source:           'gemini',
    };

    // ── 8. Cache the result ───────────────────────────────────────────────────
    void geminiCacheSet(recKey, recResult);
    console.info(`[ai.service] Gemini recommend cache SET — key=${recKey} ttl=${GEMINI_TTL}s`);

    return recResult;
}

// =============================================================================
// § 10 — getGeminiTrend()
//         Gemini-powered 30-day performance trend prediction.
//
//         Complements computeTrendAnalysis() (arithmetic delta) with LLM
//         reasoning. Gemini receives the raw performance_log time-series for
//         the last 30 days plus the completion history derived from tasks, then
//         returns a directional prediction (up/down/flat), a confidence
//         percentage, and a plain-English explanation.
//
// Route: GET /api/ai/gemini/trend/:employeeId
// =============================================================================

/** One row in the perf-log series sent to Gemini. */
interface TrendLogRow {
    date:          string;   // ISO date, YYYY-MM-DD
    score:         number;
    completionRate: number | null;
    onTimeRate:    number | null;
    avgComplexity: number | null;
}

/** Gemini's raw JSON response for the trend prompt. */
interface GeminiTrendResponse {
    trend:      'up' | 'down' | 'flat';
    confidence: number;          // 0–100 integer
    explanation: string;         // plain-English paragraph
    keySignals:  string[];       // up to 3 bullet-point signals Gemini used
    forecast:    string;         // 1-sentence prediction for the next 7 days
}

/** Public return type for getGeminiTrend(). */
export interface GeminiTrendResult {
    employeeId:    string;
    name:          string;
    trend:         'up' | 'down' | 'flat';
    confidence:    number;        // 0–100
    explanation:   string;
    keySignals:    string[];
    forecast:      string;
    windowDays:    number;        // how many days of data were sent (≤ 30)
    logCount:      number;        // number of performance_log rows in the window
    source:        'gemini';
}

/**
 * Gemini-powered 30-day performance trend analysis for one employee.
 *
 * Steps:
 *   1. Fetch employee profile (name, jobTitle).
 *   2. Fetch all performance_log rows in the last 30 days (score not null).
 *   3. Fetch task completion history: total assigned, completed, on-time counts
 *      over the same 30-day window.
 *   4. Build a structured prompt — time-series table + completion statistics.
 *   5. Call Gemini — returns trend, confidence %, explanation, keySignals, forecast.
 *
 * Graceful degradation:
 *   GeminiUnavailableError propagates — controller maps it to 503.
 *   When there are fewer than 2 log rows, a minimal prompt is still sent so
 *   Gemini can reason from the completion history alone.
 */
export async function getGeminiTrend(
    orgId:      string,
    employeeId: string,
): Promise<GeminiTrendResult> {
    // ── 0. Cache read ─────────────────────────────────────────────────────────
    const trendKey    = cacheKey(GEMINI_TREND_NS, employeeId);
    const cachedTrend = await geminiCacheGet<GeminiTrendResult>(trendKey);
    if (cachedTrend) {
        console.info(`[ai.service] Gemini trend cache HIT — key=${trendKey}`);
        return cachedTrend;
    }

    // ── 1. Fetch employee ─────────────────────────────────────────────────────
    const employee = await prisma.employee.findFirst({
        where: { id: employeeId, orgId, isActive: true },
        select: { id: true, name: true, jobTitle: true },
    });
    if (!employee) {
        throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found');
    }

    const now  = new Date();
    const d30  = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // ── 2. Fetch 30-day performance_log series ────────────────────────────────
    // Reuse getScoreHistory (returns lightweight rows with score + computedAt).
    // We need the factor columns too, so query directly here for the richer set.
    const rawLogs = await prisma.performanceLog.findMany({
        where: {
            orgId,
            employeeId,
            createdAt: { gte: d30 },
            score: { not: null },
        },
        select: {
            score:          true,
            completionRate: true,
            onTimeRate:     true,
            avgComplexity:  true,
            createdAt:      true,
        },
        orderBy: { createdAt: 'asc' },   // chronological for Gemini
    });

    // Shape into the prompt-friendly row type
    const logSeries: TrendLogRow[] = rawLogs.map(r => ({
        date:          r.createdAt.toISOString().slice(0, 10),
        score:         r.score!,
        completionRate: r.completionRate,
        onTimeRate:    r.onTimeRate,
        avgComplexity: r.avgComplexity,
    }));

    // ── 3. Fetch completion history from tasks ────────────────────────────────
    // Tasks completed in the 30-day window — gives Gemini volume signal
    // independent of the scoring frequency.
    const [tasksInWindow, completedInWindow] = await Promise.all([
        prisma.task.count({
            where: { orgId, assignedTo: employeeId, isActive: true, createdAt: { gte: d30 } },
        }),
        prisma.task.count({
            where: {
                orgId, assignedTo: employeeId, isActive: true,
                status: 'COMPLETED', completedAt: { gte: d30 },
            },
        }),
    ]);

    // ── 4. Build prompt ───────────────────────────────────────────────────────

    // Format the log series as a compact markdown table
    const tableHeader = '  Date       | Score | CompRate | OnTimeRate | AvgCmplx';
    const tableSep    = '  -----------|-------|----------|------------|----------';
    const tableRows   = logSeries.length > 0
        ? logSeries.map(r =>
            `  ${r.date} | ${r.score.toFixed(1).padStart(5)} ` +
            `| ${r.completionRate !== null ? (r.completionRate * 100).toFixed(1).padStart(7) + '%' : '    n/a'} ` +
            `| ${r.onTimeRate    !== null ? (r.onTimeRate    * 100).toFixed(1).padStart(9) + '%' : '       n/a'} ` +
            `| ${r.avgComplexity !== null ? r.avgComplexity.toFixed(2).padStart(8)         : '     n/a'}`
          ).join('\n')
        : '  (no scored log entries in this window)';

    // Arithmetic anchor: deterministic delta from computeTrendAnalysis
    // — gives Gemini a pre-computed signal to cross-check against
    const deterministicTrend = await computeTrendAnalysis(orgId, employeeId);
    const deterministicStr = deterministicTrend.delta !== null
        ? `${deterministicTrend.trend.toUpperCase()} (delta ${deterministicTrend.delta > 0 ? '+' : ''}${deterministicTrend.delta.toFixed(1)}%  recent7d avg=${deterministicTrend.recentAvg}  prev23d avg=${deterministicTrend.previousAvg})`
        : `INSUFFICIENT_DATA (fewer than 2 windows have log entries)`;

    const prompt = `
You are an expert HR performance analyst. Predict the performance trend for the employee below.
Return ONLY a valid JSON object — no markdown, no text outside the JSON.

EMPLOYEE
  ID:        ${employee.id}
  Name:      ${employee.name}
  Job title: ${employee.jobTitle ?? '(not set)'}

30-DAY PERFORMANCE LOG  (${logSeries.length} scored entries, oldest → newest)
${tableHeader}
${tableSep}
${tableRows}

TASK COMPLETION  (last 30 days)
  Tasks created in window : ${tasksInWindow}
  Tasks completed         : ${completedInWindow}
  Completion rate         : ${tasksInWindow > 0 ? ((completedInWindow / tasksInWindow) * 100).toFixed(1) + '%' : 'n/a (no tasks)'}

DETERMINISTIC TREND SIGNAL  (arithmetic delta, use as cross-check only)
  ${deterministicStr}

INSTRUCTIONS
1. trend       — 'up' if performance is clearly improving over the 30-day window,
                 'down' if clearly declining, 'flat' if stable or insufficient data.
                 Base your answer on the score trajectory in the log table, not solely
                 on the deterministic signal.

2. confidence  — integer 0–100.
                 ≥ 75: strong, consistent signal with ≥ 5 log entries.
                 40–74: moderate signal or some inconsistency.
                 < 40: fewer than 3 log entries or highly volatile scores.

3. explanation — 2–4 sentences explaining the trend. Reference specific scores,
                 dates, or rates from the data above. Do not invent data.

4. keySignals  — up to 3 short bullet strings (each ≤ 15 words) citing the most
                 important data points that drove your trend determination.

5. forecast    — 1 sentence predicting likely performance over the next 7 days
                 if current conditions continue.

REQUIRED JSON SCHEMA (return exactly this shape, no extra fields):
{
  "trend":       "<'up' | 'down' | 'flat'>",
  "confidence":  <integer 0–100>,
  "explanation": "<string>",
  "keySignals":  ["<string>", ...],
  "forecast":    "<string>"
}
`.trim();

    // ── 5. Call Gemini ────────────────────────────────────────────────────────
    const geminiResult = await callGemini<GeminiTrendResponse>(prompt);

    // ── 6. Sanitise / clamp Gemini output ────────────────────────────────────
    const validTrends = new Set<string>(['up', 'down', 'flat']);
    const trend: GeminiTrendResult['trend'] =
        validTrends.has(geminiResult.trend) ? geminiResult.trend : 'flat';

    const confidence = Math.min(100, Math.max(0, Math.round(geminiResult.confidence ?? 0)));

    const trendResult: GeminiTrendResult = {
        employeeId:  employee.id,
        name:        employee.name,
        trend,
        confidence,
        explanation: geminiResult.explanation  ?? '',
        keySignals:  (geminiResult.keySignals  ?? []).slice(0, 3),
        forecast:    geminiResult.forecast     ?? '',
        windowDays:  30,
        logCount:    logSeries.length,
        source:      'gemini',
    };

    // ── 6. Cache the result ───────────────────────────────────────────────────
    void geminiCacheSet(trendKey, trendResult);
    console.info(`[ai.service] Gemini trend cache SET — key=${trendKey} ttl=${GEMINI_TTL}s`);

    return trendResult;
}

// =============================================================================
// § 11 — invalidateEmployeeGeminiCache()
//         Called by employee.service on updateEmployee() / deactivateEmployee()
//         so that stale Gemini analyses are evicted when employee data changes.
//
//         GEMINI_RECOMMEND_NS is keyed by taskId, not employeeId — it cannot be
//         invalidated by employee identity alone.  It is cleared naturally when
//         computeProductivityScore() fires after the next task completion.
// =============================================================================

/**
 * Evict all per-employee Gemini cache entries for one employee.
 *
 * @param employeeId - The employee whose Gemini cache entries should be purged.
 */
export async function invalidateEmployeeGeminiCache(
    employeeId: string,
): Promise<void> {
    const redis = getRedis();
    if (!redis) return;

    const keys = [
        cacheKey(GEMINI_SCORE_NS, employeeId),   // future-proof (score endpoint)
        cacheKey(GEMINI_SKILL_NS, employeeId),   // skill-gap analysis
        cacheKey(GEMINI_TREND_NS, employeeId),   // trend analysis
    ];

    await redis.del(...keys).catch((err: unknown) => {
        console.warn(
            '[ai.service] Gemini employee cache invalidation failed:',
            (err as Error).message,
        );
    });

    console.info(
        `[ai.service] Gemini employee cache invalidated — employeeId=${employeeId}`,
    );
}
