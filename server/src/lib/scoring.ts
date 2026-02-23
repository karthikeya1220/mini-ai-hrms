// =============================================================================
// lib/scoring.ts — Pure deterministic scoring functions.
//
// EXTRACTED FROM ai.service.ts § 2 so these functions are:
//   1. Importable by tests without touching any DB / Prisma dependency.
//   2. Reusable by future modules (dashboard aggregation, batch scoring, etc.)
//   3. Verifiable in isolation: given the same input → always the same output.
//
// ZERO dependencies: no Prisma, no Express, no env vars.
// This file can be imported in any context safely.
//
// SPEC references:
//   SPEC § 2.5 "AI Scoring Engine — Full Specification"
//   SPEC § 1.3 "AI as a Scoring Layer, Not a Black Box"
// =============================================================================

import type { ScoringBreakdown } from '../services/ai.service';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Minimal task shape required for score computation. */
export interface ScoringTask {
    status: string;         // 'assigned' | 'in_progress' | 'completed'
    complexityScore: number;         // 1–5 integer
    dueDate: Date | null;    // null = no deadline
    completedAt: Date | null;    // null = not yet completed
}

/** Return type when at least one task exists. */
export interface ScoreResult {
    score: number;           // 0–100, rounded to 1 decimal
    grade: string;           // A+ | A | B | C | D
    breakdown: ScoringBreakdown;
}

/** Return type when the employee has no assigned tasks. */
export interface NoTasksResult {
    score: null;
    grade: null;
    breakdown: null;
}

export type ComputeResult = ScoreResult | NoTasksResult;

// ─── Exported pure functions ──────────────────────────────────────────────────

/**
 * SPEC § 2.5 — Grade boundary mapping (verbatim).
 *
 *   A+ ≥ 90 | A ≥ 80 | B ≥ 70 | C ≥ 60 | D < 60
 */
export function scoreToGrade(score: number): string {
    if (score >= 90) return 'A+';
    if (score >= 80) return 'A';
    if (score >= 70) return 'B';
    if (score >= 60) return 'C';
    return 'D';
}

/**
 * Composite ranking score for employee recommendation.
 *
 * New formula (weights sum to 100):
 *   rank = (skillOverlapRate × 50) + (inverseActiveRate × 30) + (perfRate × 20)
 *
 * Factor definitions:
 *   skillOverlapRate  = overlap / max(requiredCount, 1)          → 0–1
 *                       Normalized against the task's required skill count so
 *                       a 3/3 match always beats a 3/5 match regardless of totals.
 *
 *   inverseActiveRate = max(0, 10 − activeCount) / 10            → 0–1
 *                       Capped at 10 open tasks; beyond that the employee
 *                       is at full capacity and scores 0 on availability.
 *                       Goes negative above 10 intentionally — the clamp prevents
 *                       penalising other factors.
 *
 *   perfRate          = clamp(perfScore, 0, 100) / 100           → 0–1
 *                       perfScore defaults to 50 when no history exists, yielding
 *                       perfRate = 0.5 (neutral — neither rewarded nor penalised).
 *
 * Output range: 0–100 (all three sub-scores are in [0, 1] before weighting).
 *
 * @param overlap        Count of matched skills between employee and task.
 * @param requiredCount  Total skills the task requires (denominator for overlap).
 * @param activeCount    Current open (non-COMPLETED) task count for this employee.
 * @param perfScore      Latest productivity score 0–100 (use 50 when absent).
 */
export function computeRank(
    overlap: number,
    requiredCount: number,
    activeCount: number,
    perfScore: number,
): number {
    const skillOverlapRate  = overlap / Math.max(requiredCount, 1);
    const inverseActiveRate = Math.max(0, 10 - activeCount) / 10;
    const perfRate          = Math.min(Math.max(perfScore, 0), 100) / 100;

    return (skillOverlapRate * 50) + (inverseActiveRate * 30) + (perfRate * 20);
}

/**
 * SPEC § 2.5 — Productivity Score formula (verbatim).
 *
 * Weights:
 *   40% — Task Completion Rate     (completed / assigned)
 *   35% — On-Time Completion Rate  (onTime / completedWithDueDate)
 *   25% — Average Task Complexity  (avgComplexity / 5, normalized 0–1)
 *
 * DEVIATION from SPEC literal (documented):
 *   SPEC says: onTimeRate = totalOnTime / totalCompleted
 *   Implementation: onTimeRate = totalOnTime / completedWithDueDate.length
 *   Reason: tasks without a dueDate cannot be "on time" or "late". Dividing by
 *   totalCompleted would unfairly deflate onTimeRate when many tasks lack a
 *   deadline. Using only the deadline-tracked subset is a faithful interpretation
 *   of the SPEC's intent.
 *
 * @param tasks All tasks assigned to this employee (any status).
 */
export function computeScoreFromTasks(tasks: ReadonlyArray<ScoringTask>): ComputeResult {
    const totalAssigned = tasks.length;

    // SPEC: "if (totalAssigned === 0) return { score: null, reason: 'no_tasks_assigned' }"
    if (totalAssigned === 0) {
        return { score: null, grade: null, breakdown: null };
    }

    // ── Factor 1: Completion Rate (weight 40) ──────────────────────────────────
    const completed = tasks.filter(t => t.status === 'COMPLETED');
    const totalCompleted = completed.length;
    const completionRate = totalCompleted / totalAssigned;

    // ── Factor 2: On-Time Rate (weight 35) ────────────────────────────────────
    // Only tasks with a dueDate can be classified as on-time or late.
    const completedWithDueDate = completed.filter(t => t.dueDate !== null);
    const onTime = completedWithDueDate.filter(
        t => t.completedAt !== null && t.completedAt <= t.dueDate!,
    );
    const totalOnTime = onTime.length;
    const onTimeRate = completedWithDueDate.length > 0
        ? totalOnTime / completedWithDueDate.length
        : 0;

    // ── Factor 3: Average Complexity (weight 25) ───────────────────────────────
    // Over ALL assigned tasks — not just completed. SPEC: "mean(assigned.map(complexityScore))"
    const avgComplexity = tasks.reduce((sum, t) => sum + t.complexityScore, 0) / totalAssigned;
    const complexityNorm = avgComplexity / 5; // normalize 1–5 → 0.2–1.0

    // ── Weighted sum ───────────────────────────────────────────────────────────
    const rawScore = (completionRate * 40) + (onTimeRate * 35) + (complexityNorm * 25);

    // SPEC: "Math.round(score * 10) / 10" — 1 decimal place
    const score = Math.round(rawScore * 10) / 10;

    return {
        score,
        grade: scoreToGrade(score),
        breakdown: {
            completionRate: Math.round(completionRate * 1000) / 1000, // 3 d.p.
            onTimeRate: Math.round(onTimeRate * 1000) / 1000,
            avgComplexity: Math.round(avgComplexity * 100) / 100,   // 2 d.p.
            totalTasksAssigned: totalAssigned,
            totalCompleted,
            totalOnTime,
        },
    };
}

/**
 * Compute skill overlap between an employee's skills and a task's required skills.
 * Comparison is case-insensitive (real-world data has mixed casing).
 *
 * Used by recommendEmployees() to feed the rank formula.
 */
export function computeSkillOverlap(
    employeeSkills: ReadonlyArray<string>,
    requiredSkills: ReadonlyArray<string>,
): number {
    const required = new Set(requiredSkills.map(s => s.toLowerCase()));
    return employeeSkills.filter(s => required.has(s.toLowerCase())).length;
}

// ─── computeProductivityScore ─────────────────────────────────────────────────

/** Return shape for computeProductivityScore. All rates are 0–1 fractions. */
export interface ProductivityScore {
    /** Weighted composite, 0–100 (1 decimal place). */
    score: number;
    /** completed / totalAssigned  (0–1). */
    completionRate: number;
    /** onTime / completedWithDueDate  (0–1; 0 when no deadline-tracked tasks). */
    onTimeRate: number;
    /** Mean complexityScore across ALL assigned tasks (1–5 scale). */
    avgComplexity: number;
}

/**
 * Pure productivity scorer.
 *
 * Weights (SPEC § 2.5):
 *   40% — completion rate   (completed / assigned)
 *   35% — on-time rate      (onTime / completedWithDueDate)
 *   25% — avg complexity    (avgComplexity / 5, normalised 0–1)
 *
 * When `tasks` is empty, all rates are 0 and score is 0.
 *
 * No DB. No side-effects. Same input → same output.
 */
export function computeProductivityScore(
    tasks: ReadonlyArray<ScoringTask>,
): ProductivityScore {
    const total = tasks.length;

    if (total === 0) {
        return { score: 0, completionRate: 0, onTimeRate: 0, avgComplexity: 0 };
    }

    // 40% — completion rate
    const completed = tasks.filter(t => t.status === 'COMPLETED');
    const completionRate = completed.length / total;

    // 35% — on-time rate (only tasks with a dueDate are countable)
    const withDue = completed.filter(t => t.dueDate !== null);
    const onTime  = withDue.filter(
        t => t.completedAt !== null && t.completedAt <= t.dueDate!,
    );
    const onTimeRate = withDue.length > 0 ? onTime.length / withDue.length : 0;

    // 25% — average complexity (all assigned, normalised /5 for weighting)
    const avgComplexity =
        tasks.reduce((sum, t) => sum + t.complexityScore, 0) / total;
    const complexityNorm = avgComplexity / 5;

    // Weighted sum → 0–100, 1 decimal place
    const raw   = completionRate * 40 + onTimeRate * 35 + complexityNorm * 25;
    const score = Math.round(raw * 10) / 10;

    return {
        score,
        completionRate: Math.round(completionRate * 1000) / 1000,
        onTimeRate:     Math.round(onTimeRate     * 1000) / 1000,
        avgComplexity:  Math.round(avgComplexity  * 100)  / 100,
    };
}
