// api/ai.ts — typed wrappers for the four Gemini AI endpoints
//
// Routes (all GET, all require Authorization: Bearer <token>):
//   geminiScore(employeeId)           → GET /api/ai/gemini/score/:employeeId
//   geminiSkillGap(employeeId)        → GET /api/ai/gemini/skill-gap/:employeeId
//   geminiTrend(employeeId)           → GET /api/ai/gemini/trend/:employeeId
//   geminiRecommend(taskId)           → GET /api/ai/gemini/recommend/:taskId
//
// All responses are cached server-side (Redis, 10 min TTL) and carry
// source: 'gemini' to distinguish from deterministic fallback responses.

import { client } from './client';

// ─── Gemini Score ─────────────────────────────────────────────────────────────
// Mirrors server GeminiScoreResult (§ gemini/score route)

export interface GeminiScoreResult {
    employeeId:   string;
    name:         string;
    score:        number | null;   // null = no completed tasks
    grade:        string | null;
    explanation:  string;          // LLM-generated narrative
    strengths:    string[];
    concerns:     string[];
    confidence:   'high' | 'medium' | 'low';
    source:       'gemini';
}

// ─── Gemini Skill Gap ─────────────────────────────────────────────────────────
// Mirrors server GeminiSkillGapResult (§8 ai.service.ts)

export interface GeminiSkillGapResult {
    employeeId:     string;
    name:           string;
    jobTitle:       string | null;
    department:     string | null;
    currentSkills:  string[];
    peerTaskSkills: string[];
    missingSkills:  string[];
    emergingSkills: string[];
    rationale:      string;
    confidence:     'high' | 'medium' | 'low';
    source:         'gemini';
}

// ─── Gemini Trend ─────────────────────────────────────────────────────────────
// Mirrors server GeminiTrendResult (§10 ai.service.ts)

export interface GeminiTrendResult {
    employeeId:  string;
    name:        string;
    trend:       'up' | 'down' | 'flat';
    confidence:  number;       // 0–100
    explanation: string;
    keySignals:  string[];
    forecast:    string;
    windowDays:  number;
    logCount:    number;
    source:      'gemini';
}

// ─── Gemini Recommend ─────────────────────────────────────────────────────────
// Mirrors server GeminiRecommendResult (§9 ai.service.ts)

export interface GeminiRecommendResult {
    taskId:           string;
    taskTitle:        string;
    bestEmployeeId:   string;
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

// ─── API wrappers ─────────────────────────────────────────────────────────────

/** GET /api/ai/gemini/score/:employeeId */
export async function geminiScore(
    employeeId: string,
): Promise<GeminiScoreResult> {
    const res = await client.get<{ success: true; data: GeminiScoreResult }>(
        `/ai/gemini/score/${employeeId}`,
    );
    return res.data.data;
}

/** GET /api/ai/gemini/skill-gap/:employeeId */
export async function geminiSkillGap(
    employeeId: string,
): Promise<GeminiSkillGapResult> {
    const res = await client.get<{ success: true; data: GeminiSkillGapResult }>(
        `/ai/gemini/skill-gap/${employeeId}`,
    );
    return res.data.data;
}

/** GET /api/ai/gemini/trend/:employeeId */
export async function geminiTrend(
    employeeId: string,
): Promise<GeminiTrendResult> {
    const res = await client.get<{ success: true; data: GeminiTrendResult }>(
        `/ai/gemini/trend/${employeeId}`,
    );
    return res.data.data;
}

/** GET /api/ai/gemini/recommend/:taskId */
export async function geminiRecommend(
    taskId: string,
): Promise<GeminiRecommendResult> {
    const res = await client.get<{ success: true; data: GeminiRecommendResult }>(
        `/ai/gemini/recommend/${taskId}`,
    );
    return res.data.data;
}

// ─── Legacy shims (kept so old imports don't break during migration) ───────────
// TODO: remove once GeminiAnalysisPanel fully migrated.

export interface WorkforceScoreAnalysis {
    summary:         string;
    strengths:       string[];
    concerns:        string[];
    recommendations: string[];
    confidence:      'high' | 'medium' | 'low';
}
export interface PriorityGap {
    skill:        string;
    urgency:      'critical' | 'high' | 'medium';
    learningPath: string;
}
export interface SkillGapAnalysis {
    summary:          string;
    priorityGaps:     PriorityGap[];
    quickWins:        string[];
    timelineEstimate: string;
}
export interface WorkloadPrediction {
    riskLevel:        'low' | 'medium' | 'high' | 'critical';
    riskSummary:      string;
    predictedIssues:  string[];
    rebalanceActions: string[];
    capacityScore:    number;
}
export interface AnalyzeResponse<T> {
    type:       'score' | 'skill-gap' | 'workload';
    employeeId: string;
    analysis:   T;
    cached:     boolean;
}
/** @deprecated use geminiScore() */
export async function analyzeScore(employeeId: string): Promise<AnalyzeResponse<WorkforceScoreAnalysis>> {
    const { data } = await client.post<{ data: AnalyzeResponse<WorkforceScoreAnalysis> }>(
        '/ai/analyze', { type: 'score', employeeId },
    );
    return data.data;
}
/** @deprecated use geminiSkillGap() */
export async function analyzeSkillGap(employeeId: string): Promise<AnalyzeResponse<SkillGapAnalysis>> {
    const { data } = await client.post<{ data: AnalyzeResponse<SkillGapAnalysis> }>(
        '/ai/analyze', { type: 'skill-gap', employeeId },
    );
    return data.data;
}
/** @deprecated use geminiTrend() */
export async function analyzeWorkload(employeeId: string): Promise<AnalyzeResponse<WorkloadPrediction>> {
    const { data } = await client.post<{ data: AnalyzeResponse<WorkloadPrediction> }>(
        '/ai/analyze',
        { type: 'workload', employeeId },
    );
    return data.data;
}
