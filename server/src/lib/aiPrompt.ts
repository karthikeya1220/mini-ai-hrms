// =============================================================================
// lib/aiPrompt.ts — Structured prompt builder for Gemini employee analysis.
//
// buildEmployeePrompt() assembles a single self-contained prompt string that
// instructs Gemini to return a strict JSON object with four sections:
//
//   1. productivityScore  — numeric 0–100
//   2. skillGaps          — missing skills + coverage rate
//   3. performanceTrend   — direction (up/down/flat) + plain-English reason
//   4. taskRecommendation — whether to assign new work + rationale
//
// Design principles:
//   - The JSON schema is embedded in the prompt itself so Gemini knows the
//     exact shape to emit (works with responseMimeType: 'application/json').
//   - All numeric inputs are pre-rounded in the prompt to avoid token waste.
//   - The prompt is deterministic — same inputs always produce the same text.
//   - No Prisma / DB imports — pure data-in, string-out.
// =============================================================================

// ─── Input types ──────────────────────────────────────────────────────────────

/** Minimal employee profile fields needed for the prompt. */
export interface PromptEmployee {
    id:         string;
    name:       string;
    jobTitle:   string | null;
    department: string | null;
    skills:     string[];
}

/** Minimal task fields needed for the prompt. */
export interface PromptTask {
    id:             string;
    title:          string;
    status:         'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED';
    priority:       string;           // 'low' | 'medium' | 'high'
    complexityScore: number;          // 1–5
    requiredSkills: string[];
    dueDate:        Date | null;
    completedAt:    Date | null;
}

/** Pre-computed productivity metrics — sourced from computeProductivityScore(). */
export interface PromptMetrics {
    /** Weighted composite productivity score 0–100, 1 d.p. */
    score:          number;
    /** Fraction of assigned tasks completed, 0–1. */
    completionRate: number;
    /** Fraction of completed tasks finished on time, 0–1. */
    onTimeRate:     number;
    /** Mean task complexity across all assigned tasks, 1–5 scale. */
    avgComplexity:  number;
    /** Historical trend derived from 30-day performance_log window. */
    trend:          'up' | 'down' | 'flat' | 'insufficient_data';
    /** % change between last-7-day avg and prior-23-day avg. null when no data. */
    trendDelta:     number | null;
}

// ─── Output type (what Gemini must return) ────────────────────────────────────

/** The exact JSON shape Gemini is instructed to return. */
export interface GeminiEmployeeAnalysis {
    productivityScore: {
        /** Gemini's own assessment, 0–100 integer. */
        value:      number;
        /** 1–2 sentence plain-English justification. */
        rationale:  string;
        /** 'high' | 'medium' | 'low' — based on data volume and recency. */
        confidence: 'high' | 'medium' | 'low';
    };
    skillGaps: {
        /** Skills required by assigned tasks but absent from employee profile. */
        missingSkills:   string[];
        /** Skills on the employee profile that match required skills (normalised). */
        matchedSkills:   string[];
        /** Fraction of required skills covered, 0–1. */
        coverageRate:    number;
        /** 1–2 sentence explanation of impact. */
        summary:         string;
    };
    performanceTrend: {
        /** Direction of performance over the observed window. */
        direction:  'up' | 'down' | 'flat' | 'insufficient_data';
        /** Plain-English reason for the trend (1 sentence). */
        reason:     string;
        /** Specific, actionable suggestion to maintain or improve the trend. */
        suggestion: string;
    };
    taskRecommendation: {
        /** Whether Gemini recommends assigning new tasks to this employee now. */
        shouldAssign:  boolean;
        /** Maximum additional tasks recommended without risking overload (0–5). */
        maxNewTasks:   number;
        /** Up to 3 skill tags the employee should prioritise in their next task. */
        focusSkills:   string[];
        /** 1–2 sentence rationale. */
        rationale:     string;
    };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(rate: number): string {
    return `${Math.round(rate * 100)}%`;
}

function round1(n: number): string {
    return n.toFixed(1);
}

function taskLine(t: PromptTask): string {
    const due = t.dueDate
        ? t.dueDate.toISOString().slice(0, 10)
        : 'no deadline';
    const done = t.completedAt
        ? t.completedAt.toISOString().slice(0, 10)
        : '—';
    const skills = t.requiredSkills.length > 0
        ? t.requiredSkills.join(', ')
        : 'none';
    return (
        `  • [${t.status}] "${t.title}" ` +
        `priority=${t.priority} complexity=${t.complexityScore}/5 ` +
        `due=${due} completedAt=${done} requiredSkills=[${skills}]`
    );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a self-contained Gemini prompt for employee performance analysis.
 *
 * The returned string embeds:
 *   - All employee and task data in a compact tabular form
 *   - Pre-computed metrics so Gemini can cross-check rather than re-derive
 *   - A strict JSON schema with field-level constraints
 *   - Temperature-guiding instructions ("be concise, factual, actionable")
 *
 * @param employee  Minimal employee profile (name, skills, job title, dept).
 * @param tasks     All tasks currently or recently assigned to the employee.
 * @param metrics   Pre-computed productivity metrics from computeProductivityScore().
 * @returns         Full prompt string ready to pass to callGemini<GeminiEmployeeAnalysis>().
 */
export function buildEmployeePrompt(
    employee: PromptEmployee,
    tasks:    ReadonlyArray<PromptTask>,
    metrics:  PromptMetrics,
): string {
    // ── Employee section ──────────────────────────────────────────────────────
    const profile = [
        `Name:       ${employee.name}`,
        `Job title:  ${employee.jobTitle ?? '(not set)'}`,
        `Department: ${employee.department ?? '(not set)'}`,
        `Skills:     ${employee.skills.length > 0 ? employee.skills.join(', ') : '(none recorded)'}`,
    ].join('\n');

    // ── Tasks section ─────────────────────────────────────────────────────────
    const taskCount = {
        total:      tasks.length,
        assigned:   tasks.filter(t => t.status === 'ASSIGNED').length,
        inProgress: tasks.filter(t => t.status === 'IN_PROGRESS').length,
        completed:  tasks.filter(t => t.status === 'COMPLETED').length,
    };

    const taskSection = tasks.length > 0
        ? tasks.map(taskLine).join('\n')
        : '  (no tasks assigned)';

    // ── Metrics section ───────────────────────────────────────────────────────
    const trendStr = metrics.trendDelta !== null
        ? `${metrics.trend} (delta ${metrics.trendDelta > 0 ? '+' : ''}${round1(metrics.trendDelta)}% vs prior 23-day avg)`
        : metrics.trend;

    const metricsBlock = [
        `Productivity score : ${round1(metrics.score)} / 100`,
        `Completion rate    : ${pct(metrics.completionRate)} (${taskCount.completed}/${taskCount.total} tasks)`,
        `On-time rate       : ${pct(metrics.onTimeRate)} (of tasks with a deadline)`,
        `Avg complexity     : ${round1(metrics.avgComplexity)} / 5`,
        `30-day trend       : ${trendStr}`,
    ].join('\n');

    // ── Required skills across all tasks ─────────────────────────────────────
    const allRequired = [
        ...new Set(tasks.flatMap(t => t.requiredSkills).map(s => s.toLowerCase())),
    ];
    const empSkillsLower = new Set(employee.skills.map(s => s.toLowerCase()));
    const missing  = allRequired.filter(s => !empSkillsLower.has(s));
    const matched  = allRequired.filter(s =>  empSkillsLower.has(s));
    const coverage = allRequired.length > 0
        ? matched.length / allRequired.length
        : 1;

    const skillGapHint = allRequired.length > 0
        ? [
            `Required (all tasks): ${allRequired.join(', ')}`,
            `Matched             : ${matched.length > 0 ? matched.join(', ') : '(none)'}`,
            `Missing             : ${missing.length > 0 ? missing.join(', ') : '(none — full coverage)'}`,
            `Coverage            : ${pct(coverage)}`,
          ].join('\n')
        : 'No required skills across current tasks.';

    // ── JSON schema (embedded so Gemini knows the exact shape) ───────────────
    const schema = `
{
  "productivityScore": {
    "value":      <integer 0–100>,
    "rationale":  "<1–2 sentence justification>",
    "confidence": "<'high' | 'medium' | 'low'>"
  },
  "skillGaps": {
    "missingSkills":  ["<skill>", ...],
    "matchedSkills":  ["<skill>", ...],
    "coverageRate":   <number 0–1, 2 decimal places>,
    "summary":        "<1–2 sentence impact explanation>"
  },
  "performanceTrend": {
    "direction":  "<'up' | 'down' | 'flat' | 'insufficient_data'>",
    "reason":     "<1 sentence>",
    "suggestion": "<1 actionable sentence>"
  },
  "taskRecommendation": {
    "shouldAssign": <true | false>,
    "maxNewTasks":  <integer 0–5>,
    "focusSkills":  ["<skill>", ...],
    "rationale":    "<1–2 sentence rationale>"
  }
}`.trim();

    // ── Assemble final prompt ─────────────────────────────────────────────────
    return `
You are an expert HR analytics AI. Analyse the following employee data and return ONLY a valid JSON object — no markdown, no explanation outside the JSON.

═══════════════════════════════════════════════
EMPLOYEE PROFILE
═══════════════════════════════════════════════
${profile}

═══════════════════════════════════════════════
TASKS  (${taskCount.total} total: ${taskCount.assigned} assigned, ${taskCount.inProgress} in-progress, ${taskCount.completed} completed)
═══════════════════════════════════════════════
${taskSection}

═══════════════════════════════════════════════
PRE-COMPUTED PRODUCTIVITY METRICS
═══════════════════════════════════════════════
${metricsBlock}

═══════════════════════════════════════════════
SKILL GAP HINT  (cross-reference against employee.skills)
═══════════════════════════════════════════════
${skillGapHint}

═══════════════════════════════════════════════
INSTRUCTIONS
═══════════════════════════════════════════════
1. productivityScore.value  — Use the pre-computed score as the primary signal.
   Adjust by ±5 points only if task evidence clearly contradicts it. Do not
   fabricate data not present above.

2. skillGaps  — Use the SKILL GAP HINT above. Normalise skill names to lowercase.
   coverageRate must match: matchedSkills.length / (matchedSkills.length + missingSkills.length)
   or 1.0 when there are no required skills.

3. performanceTrend  — Base direction on the 30-day trend value above.
   "insufficient_data" when trend is 'insufficient_data' or task count < 3.
   Reason must reference concrete data (completion rate, on-time rate, delta %).

4. taskRecommendation  — shouldAssign = true if productivity score ≥ 50 AND
   in-progress tasks ≤ 5. maxNewTasks = 0 when shouldAssign = false.
   focusSkills must be a subset of missingSkills (or empty if none missing).

5. Be concise, factual, and actionable. Do not invent skills, tasks, or metrics.

═══════════════════════════════════════════════
REQUIRED JSON SCHEMA  (return exactly this shape)
═══════════════════════════════════════════════
${schema}
`.trim();
}
