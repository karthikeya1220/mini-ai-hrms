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
 * SPEC § 2.5 — Composite ranking score for employee recommendation.
 *
 *   rank = (skillOverlap × 30) + ((10 − activeCount) × 20) + (perfScore × 0.5)
 *
 * Notes:
 *   - activeCount can exceed 10 → (10 − activeCount) goes negative intentionally.
 *   - perfScore defaults to 50 when no history exists (SPEC: "?? 50").
 */
export function computeRank(
    skillOverlap: number,
    activeCount: number,
    perfScore: number,
): number {
    return (skillOverlap * 30) + ((10 - activeCount) * 20) + (perfScore * 0.5);
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
    const completed = tasks.filter(t => t.status === 'completed');
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
