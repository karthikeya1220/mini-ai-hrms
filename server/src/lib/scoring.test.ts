// =============================================================================
// Unit tests — AI Scoring Engine (lib/scoring.ts)
//
// SPEC § 2.5 "AI Scoring Engine — Full Specification"
//
// STRATEGY:
//   All tests target the PURE functions in lib/scoring.ts — zero DB access,
//   zero mocking, deterministic inputs → deterministic outputs.
//
//   The tests are structured as explicit formula verifications:
//     expected = (factor × weight) + … computed by hand in comments
//   This means a future maintainer can audit every assertion against the SPEC
//   without needing to run the code.
//
// COVERAGE:
//   ✅ scoreToGrade         — grade boundary conditions
//   ✅ computeRank          — formula components, negative activeCount
//   ✅ computeSkillOverlap  — case-insensitive matching, partial/full/none
//   ✅ computeScoreFromTasks — all four major paths:
//       • no tasks assigned          (null result)
//       • completion rate only       (onTime not applicable)
//       • on-time rate               (subset with dueDate)
//       • complexity weight          (avgComplexity contribution)
//       • combined realistic dataset (end-to-end formula verification)
//       • edge cases                 (tasks without dueDate, 100% score)
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
    scoreToGrade,
    computeRank,
    computeSkillOverlap,
    computeScoreFromTasks,
} from '../lib/scoring';
import type { ScoringTask } from '../lib/scoring';

// ─── Test Fixtures ────────────────────────────────────────────────────────────
// Dates are chosen to be clearly before/after each other for determinism.
// Using literal Date objects (not Date.now()) so tests never drift.

const D1 = new Date('2026-01-10T12:00:00Z'); // due date
const D2 = new Date('2026-01-12T12:00:00Z'); // due date (later)
const BEFORE_D1 = new Date('2026-01-09T23:59:00Z'); // completed before D1 → on-time
const AFTER_D1 = new Date('2026-01-11T00:01:00Z'); // completed after D1  → late
const SAME_D1 = new Date('2026-01-10T12:00:00Z'); // completed exactly at D1 → on-time (<=)

function task(overrides: Partial<ScoringTask>): ScoringTask {
    return {
        status: 'assigned',
        complexityScore: 3,
        dueDate: null,
        completedAt: null,
        ...overrides,
    };
}

function completed(overrides: Partial<ScoringTask> = {}): ScoringTask {
    return task({ status: 'completed', ...overrides });
}

// =============================================================================
// scoreToGrade
// =============================================================================
describe('scoreToGrade', () => {
    it('returns A+ for score >= 90', () => {
        expect(scoreToGrade(90)).toBe('A+');
        expect(scoreToGrade(95)).toBe('A+');
        expect(scoreToGrade(100)).toBe('A+');
    });

    it('returns A for score in [80, 90)', () => {
        expect(scoreToGrade(80)).toBe('A');
        expect(scoreToGrade(85.5)).toBe('A');
        expect(scoreToGrade(89.9)).toBe('A');
    });

    it('returns B for score in [70, 80)', () => {
        expect(scoreToGrade(70)).toBe('B');
        expect(scoreToGrade(75)).toBe('B');
        expect(scoreToGrade(79.9)).toBe('B');
    });

    it('returns C for score in [60, 70)', () => {
        expect(scoreToGrade(60)).toBe('C');
        expect(scoreToGrade(65)).toBe('C');
        expect(scoreToGrade(69.9)).toBe('C');
    });

    it('returns D for score < 60', () => {
        expect(scoreToGrade(0)).toBe('D');
        expect(scoreToGrade(30)).toBe('D');
        expect(scoreToGrade(59.9)).toBe('D');
    });

    it('boundary: exactly 90 is A+, not A', () => {
        expect(scoreToGrade(90)).toBe('A+');
        expect(scoreToGrade(89.9)).toBe('A');
    });

    it('boundary: exactly 60 is C, not D', () => {
        expect(scoreToGrade(60)).toBe('C');
        expect(scoreToGrade(59.9)).toBe('D');
    });
});

// =============================================================================
// computeRank — SPEC formula: (skillOverlap × 30) + ((10 − activeCount) × 20) + (perfScore × 0.5)
// =============================================================================
describe('computeRank', () => {
    it('computes rank correctly with all factors positive', () => {
        // skillOverlap=3, activeCount=2, perfScore=80
        // = (3*30) + ((10-2)*20) + (80*0.5)
        // = 90 + 160 + 40 = 290
        expect(computeRank(3, 2, 80)).toBe(290);
    });

    it('handles zero skill overlap', () => {
        // (0*30) + ((10-2)*20) + (80*0.5) = 0 + 160 + 40 = 200
        expect(computeRank(0, 2, 80)).toBe(200);
    });

    it('penalises high activeCount — (10 − activeCount) goes negative', () => {
        // skillOverlap=5, activeCount=15, perfScore=50
        // = (5*30) + ((10-15)*20) + (50*0.5)
        // = 150 + (-100) + 25 = 75
        expect(computeRank(5, 15, 50)).toBe(75);
    });

    it('uses default perfScore of 50 (SPEC: "?? 50") as baseline', () => {
        // At perfScore=50, the score contribution is 50 * 0.5 = 25
        // skillOverlap=0, activeCount=10 → (0*30) + (0*20) + 25 = 25
        expect(computeRank(0, 10, 50)).toBe(25);
    });

    it('higher skill overlap always improves rank — all else equal', () => {
        const low = computeRank(1, 3, 70);
        const high = computeRank(5, 3, 70);
        expect(high).toBeGreaterThan(low);
    });

    it('lower activeCount always improves rank — all else equal', () => {
        const busy = computeRank(3, 8, 70);
        const free = computeRank(3, 1, 70);
        expect(free).toBeGreaterThan(busy);
    });

    it('higher perfScore always improves rank — all else equal', () => {
        const low = computeRank(3, 3, 40);
        const high = computeRank(3, 3, 90);
        expect(high).toBeGreaterThan(low);
    });
});

// =============================================================================
// computeSkillOverlap — case-insensitive intersection
// =============================================================================
describe('computeSkillOverlap', () => {
    it('counts exact matches correctly', () => {
        expect(computeSkillOverlap(['React', 'Node'], ['React', 'Node'])).toBe(2);
    });

    it('is case-insensitive for employee skills', () => {
        expect(computeSkillOverlap(['react', 'NODE'], ['React', 'Node'])).toBe(2);
    });

    it('is case-insensitive for required skills', () => {
        expect(computeSkillOverlap(['React', 'Node'], ['react', 'node'])).toBe(2);
    });

    it('returns 0 when no overlap', () => {
        expect(computeSkillOverlap(['Python', 'Django'], ['React', 'Node'])).toBe(0);
    });

    it('returns partial overlap count', () => {
        expect(computeSkillOverlap(['React', 'Python', 'AWS'], ['React', 'Node', 'AWS'])).toBe(2);
    });

    it('returns 0 for empty employee skills', () => {
        expect(computeSkillOverlap([], ['React', 'Node'])).toBe(0);
    });

    it('returns 0 for empty required skills', () => {
        expect(computeSkillOverlap(['React', 'Node'], [])).toBe(0);
    });

    it('extra employee skills do not inflate the count', () => {
        // Employee has 5 skills, task requires 2. Max overlap = 2.
        expect(computeSkillOverlap(
            ['React', 'Node', 'AWS', 'Docker', 'Python'],
            ['React', 'Node'],
        )).toBe(2);
    });

    it('handles mixed case with spaces trimmed in advance', () => {
        expect(computeSkillOverlap(['TypeScript'], ['typescript'])).toBe(1);
    });
});

// =============================================================================
// computeScoreFromTasks — the full scoring formula
// =============================================================================
describe('computeScoreFromTasks — no tasks', () => {
    it('returns null score/grade/breakdown when array is empty (SPEC edge case)', () => {
        const result = computeScoreFromTasks([]);
        expect(result.score).toBeNull();
        expect(result.grade).toBeNull();
        expect(result.breakdown).toBeNull();
    });
});

// ─── Completion Rate factor ───────────────────────────────────────────────────
describe('computeScoreFromTasks — completion rate (weight 40)', () => {
    it('100% completion rate contributes 40 points', () => {
        // 2 assigned, 2 completed (no dueDate → onTimeRate=0), complexity=5 each
        // completionRate = 2/2 = 1.0  → 1.0 * 40 = 40
        // onTimeRate     = 0 (no dueDate)           → 0 * 35 = 0
        // complexityNorm = 5/5 = 1.0               → 1.0 * 25 = 25
        // score = 40 + 0 + 25 = 65
        const tasks = [
            completed({ complexityScore: 5, dueDate: null }),
            completed({ complexityScore: 5, dueDate: null }),
        ];
        const result = computeScoreFromTasks(tasks);
        expect(result.score).toBe(65);
        expect(result.breakdown!.completionRate).toBe(1);
        expect(result.breakdown!.totalCompleted).toBe(2);
        expect(result.breakdown!.totalTasksAssigned).toBe(2);
    });

    it('50% completion rate contributes 20 points', () => {
        // 2 assigned, 1 completed (no due date), complexity=3 for both
        // completionRate = 1/2 = 0.5  → 0.5 * 40 = 20
        // onTimeRate     = 0          → 0
        // avgComplexity  = 3, norm=0.6 → 0.6 * 25 = 15
        // score = 20 + 0 + 15 = 35
        const tasks = [
            completed({ complexityScore: 3 }),
            task({ complexityScore: 3 }),     // still assigned
        ];
        const result = computeScoreFromTasks(tasks);
        expect(result.score).toBe(35);
        expect(result.breakdown!.completionRate).toBe(0.5);
    });

    it('0% completion rate contributes 0 points', () => {
        // 3 assigned, 0 completed, complexity=3 each
        // completionRate = 0 → 0
        // onTimeRate = 0
        // complexityNorm = 3/5 = 0.6 → 0.6 * 25 = 15
        // score = 0 + 0 + 15 = 15
        const tasks = [
            task({ complexityScore: 3 }),
            task({ complexityScore: 3 }),
            task({ complexityScore: 3 }),
        ];
        const result = computeScoreFromTasks(tasks);
        expect(result.score).toBe(15);
        expect(result.breakdown!.completionRate).toBe(0);
        expect(result.breakdown!.totalCompleted).toBe(0);
    });
});

// ─── On-Time Rate factor ──────────────────────────────────────────────────────
describe('computeScoreFromTasks — on-time rate (weight 35)', () => {
    it('100% on-time completion contributes 35 points', () => {
        // 2 assigned, 2 completed, both before dueDate, complexity=1 each
        // completionRate = 1.0 → 40
        // onTimeRate = 2/2 = 1.0 → 35
        // complexityNorm = 1/5 = 0.2 → 5
        // score = 40 + 35 + 5 = 80
        const tasks = [
            completed({ complexityScore: 1, dueDate: D1, completedAt: BEFORE_D1 }),
            completed({ complexityScore: 1, dueDate: D2, completedAt: BEFORE_D1 }),
        ];
        const result = computeScoreFromTasks(tasks);
        expect(result.score).toBe(80);
        expect(result.breakdown!.onTimeRate).toBe(1);
        expect(result.breakdown!.totalOnTime).toBe(2);
        expect(result.grade).toBe('A');
    });

    it('0% on-time (all late) contributes 0 points', () => {
        // 2 assigned, 2 completed, both AFTER their dueDate (D1=Jan10, AFTER_D1=Jan11)
        // Both tasks use dueDate=D1 so AFTER_D1 is unambiguously late for each.
        // completionRate = 1.0 → 40
        // onTimeRate = 0/2 = 0 → 0
        // complexityNorm = 1/5 = 0.2 → 5
        // score = 40 + 0 + 5 = 45
        const tasks = [
            completed({ complexityScore: 1, dueDate: D1, completedAt: AFTER_D1 }),
            completed({ complexityScore: 1, dueDate: D1, completedAt: AFTER_D1 }),
        ];
        const result = computeScoreFromTasks(tasks);
        expect(result.score).toBe(45);
        expect(result.breakdown!.onTimeRate).toBe(0);
        expect(result.breakdown!.totalOnTime).toBe(0);
    });

    it('completedAt exactly equal to dueDate counts as on-time (SPEC: completedAt <= dueDate)', () => {
        const tasks = [
            completed({ complexityScore: 3, dueDate: D1, completedAt: SAME_D1 }),
        ];
        const result = computeScoreFromTasks(tasks);
        expect(result.breakdown!.totalOnTime).toBe(1);
        expect(result.breakdown!.onTimeRate).toBe(1);
    });

    it('tasks without dueDate are excluded from onTimeRate denominator', () => {
        // 3 completed: 2 have dueDate (1 on-time, 1 late), 1 has no dueDate
        // onTimeRate = 1 / 2 = 0.5  ← denominator is completedWithDueDate.length (2), NOT totalCompleted (3)
        const tasks = [
            completed({ complexityScore: 3, dueDate: D1, completedAt: BEFORE_D1 }), // on-time
            completed({ complexityScore: 3, dueDate: D1, completedAt: AFTER_D1 }), // late
            completed({ complexityScore: 3, dueDate: null, completedAt: BEFORE_D1 }), // no deadline
        ];
        const result = computeScoreFromTasks(tasks);
        expect(result.breakdown!.onTimeRate).toBeCloseTo(0.5, 3);
        expect(result.breakdown!.totalOnTime).toBe(1);
    });

    it('when ALL completed tasks lack a dueDate, onTimeRate is 0 (cannot be calculated)', () => {
        const tasks = [
            completed({ complexityScore: 3, dueDate: null }),
            completed({ complexityScore: 3, dueDate: null }),
        ];
        const result = computeScoreFromTasks(tasks);
        expect(result.breakdown!.onTimeRate).toBe(0);
    });

    it('partial on-time: 1 of 2 deadline tasks on-time → onTimeRate = 0.5', () => {
        const tasks = [
            completed({ complexityScore: 3, dueDate: D1, completedAt: BEFORE_D1 }), // on-time
            completed({ complexityScore: 3, dueDate: D1, completedAt: AFTER_D1 }), // late
        ];
        const result = computeScoreFromTasks(tasks);
        expect(result.breakdown!.onTimeRate).toBeCloseTo(0.5, 3);
    });
});

// ─── Complexity Weight factor ─────────────────────────────────────────────────
describe('computeScoreFromTasks — complexity weight (weight 25)', () => {
    it('max complexity (5) contributes 25 points', () => {
        // complexityNorm = 5/5 = 1.0 → 1.0 * 25 = 25
        // Use a single assigned (not completed) task to isolate complexity contribution
        // completionRate = 0 → 0 | onTimeRate = 0 → 0 | complexity = 25
        const tasks = [task({ complexityScore: 5 })];
        const result = computeScoreFromTasks(tasks);
        expect(result.score).toBe(25);
        expect(result.breakdown!.avgComplexity).toBe(5);
    });

    it('min complexity (1) contributes 5 points', () => {
        // complexityNorm = 1/5 = 0.2 → 0.2 * 25 = 5
        const tasks = [task({ complexityScore: 1 })];
        const result = computeScoreFromTasks(tasks);
        expect(result.score).toBe(5);
        expect(result.breakdown!.avgComplexity).toBe(1);
    });

    it('default complexity (3) contributes 15 points', () => {
        // complexityNorm = 3/5 = 0.6 → 0.6 * 25 = 15
        const tasks = [task({ complexityScore: 3 })];
        const result = computeScoreFromTasks(tasks);
        expect(result.score).toBe(15);
    });

    it('avgComplexity covers ALL assigned tasks — not just completed', () => {
        // 2 tasks: one completed complexity=5, one assigned (not completed) complexity=1
        // avgComplexity = (5 + 1) / 2 = 3  → norm = 0.6
        // completionRate = 1/2 = 0.5 → 20
        // onTimeRate = 0 → 0
        // complexityNorm = 3/5 = 0.6 → 15
        // score = 20 + 0 + 15 = 35
        const tasks = [
            completed({ complexityScore: 5 }),
            task({ complexityScore: 1 }),
        ];
        const result = computeScoreFromTasks(tasks);
        expect(result.breakdown!.avgComplexity).toBe(3);
        expect(result.score).toBe(35);
    });

    it('mixed complexities produce correct average', () => {
        // complexities: 1, 2, 3, 4, 5 → avg = 3.0
        const tasks = [1, 2, 3, 4, 5].map(c => task({ complexityScore: c }));
        const result = computeScoreFromTasks(tasks);
        expect(result.breakdown!.avgComplexity).toBe(3);
    });
});

// ─── Combined formula verification ───────────────────────────────────────────
describe('computeScoreFromTasks — combined formula verification', () => {
    it('realistic dataset: 4 tasks, 3 completed, 2 on-time, avg complexity 3.5', () => {
        // Tasks:
        //   T1: completed, dueDate=D1, completedAt=BEFORE_D1 (on-time), complexity=4
        //   T2: completed, dueDate=D2, completedAt=BEFORE_D1 (on-time), complexity=3
        //   T3: completed, dueDate=D1, completedAt=AFTER_D1  (late),    complexity=4
        //   T4: assigned  (not done),                                    complexity=3
        //
        // totalAssigned    = 4
        // totalCompleted   = 3   → completionRate = 3/4 = 0.75
        // completedWithDueDate = 3 (T1, T2, T3 all have dueDates)
        // totalOnTime      = 2   → onTimeRate = 2/3 ≈ 0.667
        // avgComplexity    = (4+3+4+3)/4 = 3.5
        // complexityNorm   = 3.5/5 = 0.7
        //
        // rawScore = (0.75 * 40) + (0.667 * 35) + (0.7 * 25)
        //          = 30 + 23.333 + 17.5
        //          = 70.833  → Math.round(70.833 * 10) / 10 = 70.8
        const tasks = [
            completed({ complexityScore: 4, dueDate: D1, completedAt: BEFORE_D1 }),
            completed({ complexityScore: 3, dueDate: D2, completedAt: BEFORE_D1 }),
            completed({ complexityScore: 4, dueDate: D1, completedAt: AFTER_D1 }),
            task({ complexityScore: 3 }),
        ];
        const result = computeScoreFromTasks(tasks);

        expect(result.score).toBe(70.8);
        expect(result.grade).toBe('B');
        expect(result.breakdown!.completionRate).toBeCloseTo(0.75, 3);
        expect(result.breakdown!.onTimeRate).toBeCloseTo(0.667, 2);
        expect(result.breakdown!.avgComplexity).toBeCloseTo(3.5, 2);
        expect(result.breakdown!.totalTasksAssigned).toBe(4);
        expect(result.breakdown!.totalCompleted).toBe(3);
        expect(result.breakdown!.totalOnTime).toBe(2);
    });

    it('perfect employee: 100% complete, 100% on-time, max complexity → score near 100', () => {
        // completionRate = 1.0 → 40
        // onTimeRate = 1.0 → 35
        // complexityNorm = 5/5 → 25
        // score = 100
        const tasks = [
            completed({ complexityScore: 5, dueDate: D1, completedAt: BEFORE_D1 }),
            completed({ complexityScore: 5, dueDate: D2, completedAt: BEFORE_D1 }),
        ];
        const result = computeScoreFromTasks(tasks);
        expect(result.score).toBe(100);
        expect(result.grade).toBe('A+');
    });

    it('worst employee: 0% on any factor → score = minimum complexity contribution', () => {
        // Only one task, complexity=1, not completed, no dueDate
        // completionRate = 0 → 0
        // onTimeRate = 0 → 0
        // complexityNorm = 1/5 = 0.2 → 5
        // score = 5
        const tasks = [task({ complexityScore: 1 })];
        const result = computeScoreFromTasks(tasks);
        expect(result.score).toBe(5);
        expect(result.grade).toBe('D');
    });

    it('breakdown values are correctly rounded to 3 decimal places', () => {
        // onTimeRate = 1/3 = 0.333...
        const tasks = [
            completed({ complexityScore: 3, dueDate: D1, completedAt: BEFORE_D1 }),
            completed({ complexityScore: 3, dueDate: D1, completedAt: AFTER_D1 }),
            completed({ complexityScore: 3, dueDate: D1, completedAt: AFTER_D1 }),
        ];
        const result = computeScoreFromTasks(tasks);
        // 0.333 to 3 d.p. — check it's been rounded not truncated
        expect(result.breakdown!.onTimeRate).toBe(0.333);
    });

    it('score is clamped to 1 decimal place via Math.round', () => {
        // Create a score that would produce many decimals without rounding
        // 3 tasks, 2 completed, 1 on-time, complexity=3
        // completionRate = 2/3 = 0.6667
        // onTimeRate = 1/2 = 0.5
        // complexityNorm = 3/5 = 0.6
        // rawScore = (0.6667*40) + (0.5*35) + (0.6*25) = 26.667 + 17.5 + 15 = 59.167
        // score = Math.round(59.167 * 10) / 10 = 59.2
        const tasks = [
            completed({ complexityScore: 3, dueDate: D1, completedAt: BEFORE_D1 }),
            completed({ complexityScore: 3, dueDate: D1, completedAt: AFTER_D1 }),
            task({ complexityScore: 3 }),
        ];
        const result = computeScoreFromTasks(tasks);
        expect(result.score).toBe(59.2);
        // Verify it's exactly 1 decimal place
        const decimals = result.score!.toString().split('.')[1]?.length ?? 0;
        expect(decimals).toBeLessThanOrEqual(1);
    });
});

// ─── recommendation ranking logic ─────────────────────────────────────────────
describe('computeRank — recommendation ranking logic', () => {
    it('employee with full skill match ranks higher than partial match', () => {
        // Both employees: activeCount=2, perfScore=70
        // Full:     skillOverlap=5 → rank = (5*30)+((10-2)*20)+(70*0.5) = 150+160+35 = 345
        // Partial:  skillOverlap=2 → rank = (2*30)+160+35 = 255
        const fullMatch = computeRank(5, 2, 70);
        const partialMatch = computeRank(2, 2, 70);
        expect(fullMatch).toBeGreaterThan(partialMatch);
        expect(fullMatch).toBe(345);
        expect(partialMatch).toBe(255);
    });

    it('employee with fewer active tasks ranks higher — SPEC availability factor', () => {
        // Both: skillOverlap=3, perfScore=70
        // Free:   activeCount=1 → (3*30)+((10-1)*20)+(70*0.5) = 90+180+35 = 305
        // Busy:   activeCount=8 → (3*30)+((10-8)*20)+35 = 90+40+35 = 165
        const free = computeRank(3, 1, 70);
        const busy = computeRank(3, 8, 70);
        expect(free).toBeGreaterThan(busy);
        expect(free).toBe(305);
        expect(busy).toBe(165);
    });

    it('employee with higher perfScore ranks higher — SPEC reliability factor', () => {
        // Both: skillOverlap=3, activeCount=3
        // High: perfScore=90  → (3*30)+((10-3)*20)+(90*0.5) = 90+140+45 = 275
        // Low:  perfScore=40  → 90+140+20 = 250
        const high = computeRank(3, 3, 90);
        const low = computeRank(3, 3, 40);
        expect(high).toBeGreaterThan(low);
        expect(high).toBe(275);
        expect(low).toBe(250);
    });

    it('default perfScore 50 (SPEC: ?? 50) matches no-history employees baseline', () => {
        // skillOverlap=0, activeCount=10, perfScore=50
        // = (0*30)+((10-10)*20)+(50*0.5) = 0 + 0 + 25 = 25
        expect(computeRank(0, 10, 50)).toBe(25);
    });

    it('correctly orders 3 candidates to match expected top-3 recommendation', () => {
        // This simulates the sort that recommendEmployees applies.
        const candidates = [
            { name: 'Alice', rank: computeRank(2, 5, 70) },  // 60+100+35 = 195
            { name: 'Bob', rank: computeRank(5, 1, 90) },  // 150+180+45 = 375
            { name: 'Charlie', rank: computeRank(4, 3, 60) },  // 120+140+30 = 290
        ];
        const sorted = [...candidates].sort((a, b) => b.rank - a.rank);
        expect(sorted[0]!.name).toBe('Bob');     // rank 375
        expect(sorted[1]!.name).toBe('Charlie'); // rank 290
        expect(sorted[2]!.name).toBe('Alice');   // rank 195
    });
});
