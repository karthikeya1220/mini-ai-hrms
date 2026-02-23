// api/ai.ts — typed wrappers for POST /api/ai/analyze (Gemini-powered analysis)
//
// Three analysis types, each with its own input + output type:
//   analyzeScore(employeeId)    → WorkforceScoreAnalysis
//   analyzeSkillGap(employeeId) → SkillGapAnalysis
//   analyzeWorkload(employeeId) → WorkloadPrediction

import { client } from './client';

// ─── Score analysis ───────────────────────────────────────────────────────────

export interface WorkforceScoreAnalysis {
    summary:         string;
    strengths:       string[];
    concerns:        string[];
    recommendations: string[];
    confidence:      'high' | 'medium' | 'low';
}

// ─── Skill gap analysis ───────────────────────────────────────────────────────

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

// ─── Workload prediction ──────────────────────────────────────────────────────

export interface WorkloadPrediction {
    riskLevel:        'low' | 'medium' | 'high' | 'critical';
    riskSummary:      string;
    predictedIssues:  string[];
    rebalanceActions: string[];
    capacityScore:    number;   // 0–100
}

// ─── API response envelope ────────────────────────────────────────────────────

export interface AnalyzeResponse<T> {
    type:       'score' | 'skill-gap' | 'workload';
    employeeId: string;
    analysis:   T;
    cached:     boolean;
}

// ─── API wrappers ─────────────────────────────────────────────────────────────

export async function analyzeScore(
    employeeId: string,
): Promise<AnalyzeResponse<WorkforceScoreAnalysis>> {
    const { data } = await client.post<{ data: AnalyzeResponse<WorkforceScoreAnalysis> }>(
        '/ai/analyze',
        { type: 'score', employeeId },
    );
    return data.data;
}

export async function analyzeSkillGap(
    employeeId: string,
): Promise<AnalyzeResponse<SkillGapAnalysis>> {
    const { data } = await client.post<{ data: AnalyzeResponse<SkillGapAnalysis> }>(
        '/ai/analyze',
        { type: 'skill-gap', employeeId },
    );
    return data.data;
}

export async function analyzeWorkload(
    employeeId: string,
): Promise<AnalyzeResponse<WorkloadPrediction>> {
    const { data } = await client.post<{ data: AnalyzeResponse<WorkloadPrediction> }>(
        '/ai/analyze',
        { type: 'workload', employeeId },
    );
    return data.data;
}
