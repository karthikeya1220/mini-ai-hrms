// =============================================================================
// services/gemini.service.ts — Gemini-powered workforce intelligence.
//
// Three functions, each backed by a structured Gemini prompt:
//
//   analyzeWorkforceScore(payload)
//     → Narrative interpretation of a productivity score + breakdown.
//       Tells the admin WHY the score is what it is and WHAT to do next.
//
//   analyzeSkillGaps(payload)
//     → Prioritised skill gap recommendations with suggested learning paths.
//       Goes beyond "you're missing X" → "here's how to close the gap in 30 days".
//
//   predictWorkload(payload)
//     → Workload prediction: given active task load + historical score trend,
//       predict overload risk and recommend re-distribution actions.
//
// All three functions:
//   1. Build a deterministic data summary from the structured payload
//   2. Inject it into a typed prompt with a strict JSON schema
//   3. Call Gemini via callGemini<T>()
//   4. Return the parsed, typed result
//   5. If Gemini is unavailable, return a structured fallback — never throw 500
//
// DESIGN PRINCIPLE:
//   Gemini adds LANGUAGE to the deterministic scores — it explains, interprets,
//   and recommends. The source-of-truth numbers always come from our own engine.
//   Gemini never computes the score; it reads the score and narrates it.
// =============================================================================

import { callGemini, GeminiUnavailableError } from '../lib/gemini';

// =============================================================================
// § 1 — analyzeWorkforceScore
// =============================================================================

export interface WorkforceScorePayload {
    employeeName:   string;
    score:          number | null;
    grade:          string | null;
    breakdown: {
        completionRate:      number;   // 0–1
        onTimeRate:          number;   // 0–1
        avgComplexity:       number;   // 1–5
        totalTasksAssigned:  number;
        totalCompleted:      number;
        totalOnTime:         number;
    } | null;
    trend: 'improving' | 'declining' | 'stable' | 'insufficient_data';
}

export interface WorkforceScoreAnalysis {
    summary:        string;    // 2-sentence plain English interpretation
    strengths:      string[];  // up to 3 bullet points
    concerns:       string[];  // up to 3 bullet points
    recommendations: string[]; // up to 3 actionable next steps
    confidence:     'high' | 'medium' | 'low'; // based on data completeness
}

export async function analyzeWorkforceScore(
    payload: WorkforceScorePayload,
): Promise<WorkforceScoreAnalysis> {
    const { employeeName, score, grade, breakdown, trend } = payload;

    // If no tasks assigned, return a clean fallback without calling Gemini
    if (score === null || breakdown === null) {
        return {
            summary:         `${employeeName} has no completed tasks yet — no score data available.`,
            strengths:       [],
            concerns:        ['No task history to evaluate performance.'],
            recommendations: ['Assign initial tasks to start building a performance baseline.'],
            confidence:      'low',
        };
    }

    const completionPct  = Math.round(breakdown.completionRate * 100);
    const onTimePct      = Math.round(breakdown.onTimeRate * 100);
    const complexityDesc = breakdown.avgComplexity >= 4
        ? 'high-complexity'
        : breakdown.avgComplexity >= 3
          ? 'medium-complexity'
          : 'low-complexity';

    const prompt = `
You are an expert HR analytics assistant. Analyze the following workforce productivity data
and return a structured JSON analysis. Be specific, actionable, and professional.

EMPLOYEE DATA:
- Name: ${employeeName}
- Productivity Score: ${score}/100 (Grade: ${grade})
- Trend: ${trend}
- Task Completion Rate: ${completionPct}% (${breakdown.totalCompleted}/${breakdown.totalTasksAssigned} tasks completed)
- On-Time Completion Rate: ${onTimePct}% (${breakdown.totalOnTime} tasks delivered on time)
- Average Task Complexity: ${breakdown.avgComplexity.toFixed(1)}/5 (${complexityDesc} work)

Return ONLY valid JSON matching this exact schema — no markdown, no explanation outside JSON:
{
  "summary": "<2 sentences: what the score means and the trend implication>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "concerns": ["<concern 1>", "<concern 2>"],
  "recommendations": ["<action 1>", "<action 2>", "<action 3>"],
  "confidence": "<high|medium|low based on how much data is available>"
}

Rules:
- strengths: 1–3 items, each ≤ 15 words
- concerns: 1–3 items, each ≤ 15 words (empty array [] if score >= 85)
- recommendations: 2–3 items, each ≤ 20 words, specific and actionable
- confidence: "high" if totalTasksAssigned >= 10, "medium" if >= 4, "low" otherwise
`.trim();

    try {
        return await callGemini<WorkforceScoreAnalysis>(prompt);
    } catch (err) {
        if (err instanceof GeminiUnavailableError) {
            return buildScoreFallback(employeeName, score, trend);
        }
        throw err;
    }
}

function buildScoreFallback(
    name: string,
    score: number,
    trend: string,
): WorkforceScoreAnalysis {
    const isGood = score >= 75;
    return {
        summary: `${name} has a productivity score of ${score}/100 with a ${trend} trend. ${
            isGood ? 'Performance is on track.' : 'Performance may need attention.'
        }`,
        strengths:       isGood ? ['Consistent task delivery', 'Positive trend direction'] : [],
        concerns:        isGood ? [] : ['Score below 75 threshold', 'Review task assignments'],
        recommendations: ['Review recent task history', 'Schedule a 1:1 check-in'],
        confidence:      'low',
    };
}

// =============================================================================
// § 2 — analyzeSkillGaps
// =============================================================================

export interface SkillGapPayload {
    employeeName:   string;
    jobTitle:       string | null;
    currentSkills:  string[];
    requiredSkills: string[];
    gapSkills:      string[];
    coverageRate:   number;   // 0–1
}

export interface SkillGapAnalysis {
    summary:        string;
    priorityGaps:   Array<{
        skill:          string;
        urgency:        'critical' | 'high' | 'medium';
        learningPath:   string;   // ≤ 20 words: specific resource / action
    }>;
    quickWins:      string[];  // skills the employee is close to having
    timelineEstimate: string;  // e.g. "4–6 weeks to close top 2 gaps"
}

export async function analyzeSkillGaps(
    payload: SkillGapPayload,
): Promise<SkillGapAnalysis> {
    const { employeeName, currentSkills, gapSkills, coverageRate } = payload;

    if (gapSkills.length === 0) {
        return {
            summary:          `${employeeName} has full skill coverage for their current role scope — no gaps detected.`,
            priorityGaps:     [],
            quickWins:        [],
            timelineEstimate: 'No action required.',
        };
    }

    const coveragePct = Math.round(coverageRate * 100);

    const prompt = `
You are an expert HR skills development advisor. Analyze the following skill gap data
and return a structured JSON response with a prioritized learning plan.

EMPLOYEE DATA:
- Name: ${employeeName}
- Role: ${payload.jobTitle ?? 'Not specified'}
- Current Skills: ${currentSkills.length > 0 ? currentSkills.join(', ') : 'None listed'}
- Required Skills (for their role): ${payload.requiredSkills.join(', ')}
- Skill Gaps (missing): ${gapSkills.join(', ')}
- Coverage Rate: ${coveragePct}%

Return ONLY valid JSON matching this exact schema — no markdown, no explanation outside JSON:
{
  "summary": "<2 sentences: overall gap assessment and business impact>",
  "priorityGaps": [
    {
      "skill": "<skill name>",
      "urgency": "<critical|high|medium>",
      "learningPath": "<specific resource or action, ≤ 20 words>"
    }
  ],
  "quickWins": ["<skill close to having, ≤ 10 words each>"],
  "timelineEstimate": "<realistic timeline to close top gaps>"
}

Rules:
- priorityGaps: rank by business impact for the role; max 5 items
- urgency "critical": foundational to the role; "high": frequently needed; "medium": nice to have
- quickWins: skills the employee likely has informally or can learn in < 1 week (may be empty [])
- learningPath: name a specific course platform, certification, or hands-on exercise
- timelineEstimate: be realistic (weeks, not days) for genuine skill building
`.trim();

    try {
        return await callGemini<SkillGapAnalysis>(prompt);
    } catch (err) {
        if (err instanceof GeminiUnavailableError) {
            return buildSkillGapFallback(employeeName, gapSkills);
        }
        throw err;
    }
}

function buildSkillGapFallback(name: string, gaps: string[]): SkillGapAnalysis {
    return {
        summary: `${name} has ${gaps.length} skill gap${gaps.length !== 1 ? 's' : ''} identified. A targeted learning plan is recommended.`,
        priorityGaps: gaps.slice(0, 3).map(skill => ({
            skill,
            urgency:      'high' as const,
            learningPath: 'Review relevant online courses or internal documentation.',
        })),
        quickWins:        [],
        timelineEstimate: 'Estimated 4–8 weeks depending on skill complexity.',
    };
}

// =============================================================================
// § 3 — predictWorkload
// =============================================================================

export interface WorkloadPayload {
    employeeName:     string;
    activeTaskCount:  number;
    activePriorities: { low: number; medium: number; high: number };
    avgComplexity:    number;    // 1–5
    trend:            'improving' | 'declining' | 'stable' | 'insufficient_data';
    score:            number | null;
    // Historical weekly task completions for trend (last 4 weeks, oldest first)
    weeklyCompletions?: number[];
}

export interface WorkloadPrediction {
    riskLevel:       'low' | 'medium' | 'high' | 'critical';
    riskSummary:     string;   // 1–2 sentences
    predictedIssues: string[]; // up to 3 likely problems if nothing changes
    rebalanceActions: string[]; // up to 3 concrete rebalancing suggestions
    capacityScore:   number;   // 0–100, higher = more capacity available
}

export async function predictWorkload(
    payload: WorkloadPayload,
): Promise<WorkloadPrediction> {
    const {
        employeeName, activeTaskCount, activePriorities, avgComplexity, trend, score, weeklyCompletions,
    } = payload;

    const highPriorityLoad = activePriorities.high + activePriorities.medium;
    const weeklyTrend = weeklyCompletions && weeklyCompletions.length >= 2
        ? weeklyCompletions[weeklyCompletions.length - 1] - weeklyCompletions[0] > 0
            ? 'increasing output'
            : 'decreasing output'
        : 'insufficient weekly data';

    const prompt = `
You are an expert workforce planning analyst. Analyze the following workload data
and predict overload risk, then recommend concrete rebalancing actions.

EMPLOYEE DATA:
- Name: ${employeeName}
- Active (open) Tasks: ${activeTaskCount} total
  - High priority: ${activePriorities.high}
  - Medium priority: ${activePriorities.medium}
  - Low priority: ${activePriorities.low}
- Average Task Complexity: ${avgComplexity.toFixed(1)}/5
- Current Productivity Score: ${score !== null ? `${score}/100` : 'No data'}
- Performance Trend: ${trend}
- Weekly Output Trend: ${weeklyTrend}

CONTEXT: Industry benchmark — sustainable load is 3–5 active tasks for high-complexity work,
5–8 for medium, 8–12 for low. High-priority tasks carry 2x the cognitive load.

Return ONLY valid JSON matching this exact schema — no markdown, no explanation outside JSON:
{
  "riskLevel": "<low|medium|high|critical>",
  "riskSummary": "<1–2 sentences: current situation and primary risk>",
  "predictedIssues": ["<issue 1>", "<issue 2>"],
  "rebalanceActions": ["<action 1>", "<action 2>", "<action 3>"],
  "capacityScore": <integer 0–100, higher means more capacity available>
}

Rules:
- riskLevel "critical": likely to miss deadlines soon without intervention
- riskLevel "high": overloaded, productivity declining expected
- riskLevel "medium": approaching capacity limits
- riskLevel "low": well within sustainable range
- capacityScore: 100 = fully free, 0 = completely overloaded
- rebalanceActions: specific (e.g. "Reassign 2 medium-priority tasks to an underloaded team member")
- predictedIssues: realistic consequences if no action is taken
`.trim();

    try {
        return await callGemini<WorkloadPrediction>(prompt);
    } catch (err) {
        if (err instanceof GeminiUnavailableError) {
            return buildWorkloadFallback(employeeName, activeTaskCount, highPriorityLoad);
        }
        throw err;
    }
}

function buildWorkloadFallback(
    name: string,
    activeCount: number,
    highPriorityLoad: number,
): WorkloadPrediction {
    const isOverloaded = activeCount > 8 || highPriorityLoad > 4;
    return {
        riskLevel:        isOverloaded ? 'high' : activeCount > 5 ? 'medium' : 'low',
        riskSummary:      `${name} has ${activeCount} active tasks. ${
            isOverloaded ? 'Workload appears heavy — review for redistribution.' : 'Workload appears manageable.'
        }`,
        predictedIssues:  isOverloaded ? ['Potential deadline misses', 'Quality degradation under load'] : [],
        rebalanceActions: ['Review current task assignments', 'Discuss priorities in next 1:1'],
        capacityScore:    Math.max(0, Math.min(100, 100 - activeCount * 10)),
    };
}
