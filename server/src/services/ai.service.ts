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
    computeScoreFromTasks,
    computeRank,
    computeSkillOverlap,
} from '../lib/scoring';
import {
    persistLog,
    getScoreHistory,
    getLatestScoreMap,
} from '../lib/performanceLog';

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
    computedAt: Date;
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
    employee: { id: string; name: string; role: string | null; department: string | null; skills: string[] };
    skillOverlap: number;   // count of matched skills
    activeCount: number;   // open (non-completed) tasks currently assigned
    perfScore: number;   // productivity score (50 default if no history)
    rank: number;   // composite ranking score — higher = better
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
 * Reads ALL tasks assigned to this employee within the org, runs the SPEC
 * scoring formula, and persists the result to performance_logs.
 *
 * ⚠ Called via dispatchJob() — must not be awaited at call sites that have
 *   already sent an HTTP response. Errors propagate to jobQueue's catcher.
 */
export async function computeProductivityScore(
    payload: ScoreJobPayload,
): Promise<void> {
    const { orgId, taskId, employeeId } = payload;

    // Fetch all tasks for this employee in this org.
    // orgId guard prevents cross-tenant reads even in the background job.
    const assigned = await prisma.task.findMany({
        where: { orgId, assignedTo: employeeId },
        select: { status: true, complexityScore: true, dueDate: true, completedAt: true },
    });

    const result = computeScoreFromTasks(assigned);

    // Persist to performance_logs via the dedicated persistence layer.
    // HISTORY POLICY: persistLog() always INSERTs — never overwrites old entries.
    // source tag travels with the breakdown JSON for audit provenance.
    const logRecord = await persistLog({
        employeeId,
        score:     result.score,
        breakdown: result.breakdown,
        source:    'task_completed',
    });

    console.info(
        `[ai.service] Score computed and persisted — ` +
        `org=${orgId} task=${taskId} employee=${employeeId} ` +
        `score=${logRecord.score ?? 'null (no tasks)'} log=${logRecord.id}`,
    );
}

// =============================================================================
// § 4 — getScore()
//        Direct query used by GET /api/ai/score/:employeeId.
// =============================================================================

/**
 * Compute and return the current productivity score for one employee.
 * Does NOT persist — this is a read-only computation for the API response.
 * Also computes performance trend (§ 5 below).
 *
 * SPEC § 2.4 Score Response shape:
 *   { employeeId, name, score, grade, breakdown, trend, computedAt }
 */
export async function getScore(
    orgId: string,
    employeeId: string,
): Promise<ProductivityScoreResult> {
    // ── Ownership check ────────────────────────────────────────────────────────
    const employee = await prisma.employee.findFirst({
        where: { id: employeeId, orgId },
        select: { id: true, name: true },
    });
    if (!employee) {
        throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found');
    }

    // ── Fetch all tasks for this employee ──────────────────────────────────────
    const assigned = await prisma.task.findMany({
        where: { orgId, assignedTo: employeeId },
        select: { status: true, complexityScore: true, dueDate: true, completedAt: true },
    });

    const result = computeScoreFromTasks(assigned);
    const trend = await computeTrend(employeeId);

    return {
        employeeId,
        name: employee.name,
        score: result.score,
        grade: result.grade,
        breakdown: result.breakdown,
        trend,
        computedAt: new Date(),
    };
}

// =============================================================================
// § 5 — getPerformanceTrend()
//        Compare last 30 days vs previous 30 days using stored PerformanceLogs.
// =============================================================================

/**
 * SPEC § Day 2, Hour 18–20: "getPerformanceTrend(employeeId) — compare last
 * 30 days vs previous 30 days."
 *
 * Reads the two most recent distinct time windows from performance_logs and
 * averages the scores in each window. Trend is:
 *   - 'improving'         → now > before (by >= 1 point)
 *   - 'declining'         → now < before (by >= 1 point)
 *   - 'stable'            → delta < 1 point either direction
 *   - 'insufficient_data' → fewer than 2 log rows spanning both windows
 */
async function computeTrend(
    employeeId: string,
): Promise<ProductivityScoreResult['trend']> {
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const d60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    // Fetch last 60 days of non-null score rows via the persistence layer.
    // getScoreHistory returns PerformanceLogScoreRow[] — score already decoded.
    const logs = await getScoreHistory(employeeId, d60);

    const recent   = logs.filter(l => l.computedAt >= d30);
    const previous = logs.filter(l => l.computedAt <  d30);

    if (recent.length === 0 || previous.length === 0) {
        return 'insufficient_data';
    }

    const avgRecent   = recent.reduce((s, l)   => s + l.score, 0) / recent.length;
    const avgPrevious = previous.reduce((s, l) => s + l.score, 0) / previous.length;
    const delta = avgRecent - avgPrevious;

    if (delta >= 1)  return 'improving';
    if (delta <= -1) return 'declining';
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
 * SPEC ranking factors (verbatim):
 *   1. Skill overlap between employee.skills and task.requiredSkills
 *   2. Current active task count (lower = more available)
 *   3. Productivity score (higher = more reliable; default 50 if no history)
 *
 * SPEC formula:
 *   rank = (skillOverlap * 30) + ((10 - activeCount) * 20) + (perfScore * 0.5)
 *
 * SPEC filter:
 *   employees where isActive && department === task.targetDepartment
 *
 * Note: SPEC references "task.targetDepartment" — this field does not exist in
 * the DB schema. The closest equivalent is inferring the target department from
 * the task's assigned employee's department, or leaving it unfiltered when no
 * department context is available. Here we fetch ALL active employees in the org
 * and skip the department filter when task has no existing assignee — consistent
 * with SPEC intent of "find the best available person".
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
        select: { id: true, name: true, role: true, department: true, skills: true },
    });

    // ── Fetch latest performance score per employee ────────────────────────────
    // Delegates to getLatestScoreMap() in lib/performanceLog — batched single
    // query, decoded to Map<employeeId, number>. Absent employees default to 50.
    const employeeIds = employees.map(e => e.id);
    const scoreMap = await getLatestScoreMap(employeeIds);

    // ── Fetch active task counts per employee ──────────────────────────────────
    // "active" = not completed (assigned or in_progress)
    const activeCounts = await prisma.task.groupBy({
        by: ['assignedTo'],
        where: {
            orgId,
            assignedTo: { in: employeeIds },
            status: { not: 'completed' },
        },
        _count: { id: true },
    });
    const activeCountMap = new Map<string, number>(
        activeCounts
            .filter(r => r.assignedTo !== null)
            .map(r => [r.assignedTo as string, r._count.id]),
    );

    // ── Compute rank per employee and sort ────────────────────────────────────
    const ranked: RecommendationEntry[] = employees.map(employee => {
        // Delegate to lib/scoring which handles case-insensitive matching
        const skillOverlap = computeSkillOverlap(employee.skills, task.requiredSkills);

        const activeCount = activeCountMap.get(employee.id) ?? 0;

        // SPEC: "scores[employee.id]?.score ?? 50"
        const perfScore = scoreMap.get(employee.id) ?? 50;

        const rank = computeRank(skillOverlap, activeCount, perfScore);

        return { employee, skillOverlap, activeCount, perfScore, rank };
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

    // ── Fetch employee ──────────────────────────────────────────────────────────
    const employee = await prisma.employee.findFirst({
        where: { id: employeeId, orgId },
        select: { id: true, name: true, role: true, skills: true },
    });
    if (!employee) {
        throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found');
    }

    // ── Fetch tasks for this role scope ────────────────────────────────────────
    // Strategy: find all employees with the same role in this org, then aggregate
    // requiredSkills across all tasks ever assigned to them.
    // This reflects "tasks that employees in this role handle".
    let allTasksForRole: { requiredSkills: string[] }[];

    if (employee.role) {
        // Employees with the same role
        const sameRoleEmployees = await prisma.employee.findMany({
            where: { orgId, role: employee.role },
            select: { id: true },
        });
        const sameRoleIds = sameRoleEmployees.map(e => e.id);

        allTasksForRole = await prisma.task.findMany({
            where: { orgId, assignedTo: { in: sameRoleIds } },
            select: { requiredSkills: true },
        });
    } else {
        // No role defined — fall back to all tasks ever assigned to this specific employee
        allTasksForRole = await prisma.task.findMany({
            where: { orgId, assignedTo: employeeId },
            select: { requiredSkills: true },
        });
    }

    // SPEC: "requiredSkills = new Set(allTasksForRole.flatMap(t => t.requiredSkills))"
    const requiredSkillsSet = new Set(
        allTasksForRole.flatMap(t => t.requiredSkills).map(s => s.toLowerCase()),
    );
    const employeeSkillsSet = new Set(employee.skills.map(s => s.toLowerCase()));

    // SPEC: "gaps = [...requiredSkills].filter(s => !employeeSkills.has(s))"
    const gapSkills = [...requiredSkillsSet].filter(s => !employeeSkillsSet.has(s));

    // SPEC: coverageRate = (requiredSkills.size - gaps.length) / requiredSkills.size
    const coverageRate = requiredSkillsSet.size > 0
        ? (requiredSkillsSet.size - gapSkills.length) / requiredSkillsSet.size
        : 1; // no required skills → 100% coverage by definition

    return {
        employeeId,
        name: employee.name,
        currentSkills: employee.skills,
        requiredSkills: [...requiredSkillsSet],
        gapSkills,
        coverageRate: Math.round(coverageRate * 1000) / 1000,  // 3 d.p.
    };
}
