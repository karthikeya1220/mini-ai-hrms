// components/employees/GeminiAnalysisPanel.tsx
//
// Renders a tabbed Gemini-powered analysis panel for one employee.
// Three tabs: Score · Skill Gaps · Workload
//
// Each tab lazy-loads its Gemini analysis on first click (never pre-fetches all
// three — Gemini calls are expensive). Results are cached client-side for the
// lifetime of this component mount via local state.

import { useState, useCallback } from 'react';
import {
    analyzeScore,
    analyzeSkillGap,
    analyzeWorkload,
    type WorkforceScoreAnalysis,
    type SkillGapAnalysis,
    type WorkloadPrediction,
} from '../../api/ai';

// ─── Tab types ────────────────────────────────────────────────────────────────

type Tab = 'score' | 'skill-gap' | 'workload';

const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'score',     label: 'Score Analysis',  icon: '📊' },
    { id: 'skill-gap', label: 'Skill Gaps',       icon: '🎯' },
    { id: 'workload',  label: 'Workload Risk',    icon: '⚡' },
];

// ─── Risk colour map ──────────────────────────────────────────────────────────

const RISK_COLOR: Record<WorkloadPrediction['riskLevel'], string> = {
    low:      'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    medium:   'text-amber-400   bg-amber-500/10   border-amber-500/20',
    high:     'text-orange-400  bg-orange-500/10  border-orange-500/20',
    critical: 'text-red-400     bg-red-500/10     border-red-500/20',
};

const URGENCY_COLOR: Record<'critical' | 'high' | 'medium', string> = {
    critical: 'text-red-400     bg-red-500/10     border-red-500/20',
    high:     'text-orange-400  bg-orange-500/10  border-orange-500/20',
    medium:   'text-amber-400   bg-amber-500/10   border-amber-500/20',
};

const CONFIDENCE_COLOR: Record<WorkforceScoreAnalysis['confidence'], string> = {
    high:   'text-emerald-400',
    medium: 'text-amber-400',
    low:    'text-slate-400',
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
    employeeId:   string;
    employeeName: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GeminiAnalysisPanel({ employeeId, employeeName }: Props) {
    const [activeTab, setActiveTab] = useState<Tab>('score');

    // Per-tab state
    const [scoreData,   setScoreData]   = useState<WorkforceScoreAnalysis | null>(null);
    const [gapData,     setGapData]     = useState<SkillGapAnalysis | null>(null);
    const [workData,    setWorkData]    = useState<WorkloadPrediction | null>(null);

    const [scoreLoading,  setScoreLoading]  = useState(false);
    const [gapLoading,    setGapLoading]    = useState(false);
    const [workLoading,   setWorkLoading]   = useState(false);

    const [scoreError,  setScoreError]  = useState<string | null>(null);
    const [gapError,    setGapError]    = useState<string | null>(null);
    const [workError,   setWorkError]   = useState<string | null>(null);

    // ── Lazy loaders ──────────────────────────────────────────────────────────

    const loadScore = useCallback(async () => {
        if (scoreData || scoreLoading) return;
        setScoreLoading(true);
        setScoreError(null);
        try {
            const res = await analyzeScore(employeeId);
            setScoreData(res.analysis);
        } catch {
            setScoreError('Could not load score analysis. Please try again.');
        } finally {
            setScoreLoading(false);
        }
    }, [employeeId, scoreData, scoreLoading]);

    const loadGap = useCallback(async () => {
        if (gapData || gapLoading) return;
        setGapLoading(true);
        setGapError(null);
        try {
            const res = await analyzeSkillGap(employeeId);
            setGapData(res.analysis);
        } catch {
            setGapError('Could not load skill gap analysis. Please try again.');
        } finally {
            setGapLoading(false);
        }
    }, [employeeId, gapData, gapLoading]);

    const loadWork = useCallback(async () => {
        if (workData || workLoading) return;
        setWorkLoading(true);
        setWorkError(null);
        try {
            const res = await analyzeWorkload(employeeId);
            setWorkData(res.analysis);
        } catch {
            setWorkError('Could not load workload prediction. Please try again.');
        } finally {
            setWorkLoading(false);
        }
    }, [employeeId, workData, workLoading]);

    // ── Tab switch ────────────────────────────────────────────────────────────

    const handleTab = (tab: Tab) => {
        setActiveTab(tab);
        if (tab === 'score')     loadScore();
        if (tab === 'skill-gap') loadGap();
        if (tab === 'workload')  loadWork();
    };

    // Trigger first tab on mount
    const [mounted, setMounted] = useState(false);
    if (!mounted) {
        setMounted(true);
        loadScore();
    }

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="rounded-xl border border-slate-700/60 bg-slate-900 overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700/60 bg-slate-800/40">
                <span className="text-lg">✨</span>
                <div>
                    <p className="text-xs font-semibold text-white leading-none">Gemini AI Analysis</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{employeeName}</p>
                </div>
                <span className="ml-auto text-[10px] text-slate-600 font-mono">gemini-1.5-flash</span>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-700/60">
                {TABS.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => handleTab(tab.id)}
                        className={`flex-1 py-2.5 text-[11px] font-medium transition-colors duration-150 ${
                            activeTab === tab.id
                                ? 'text-indigo-300 border-b-2 border-indigo-400 bg-indigo-500/5'
                                : 'text-slate-500 hover:text-slate-300'
                        }`}
                    >
                        <span className="mr-1">{tab.icon}</span>
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            <div className="p-4 min-h-[200px]">
                {activeTab === 'score'     && <ScoreTab     data={scoreData}  loading={scoreLoading}  error={scoreError} />}
                {activeTab === 'skill-gap' && <SkillGapTab  data={gapData}    loading={gapLoading}    error={gapError} />}
                {activeTab === 'workload'  && <WorkloadTab  data={workData}   loading={workLoading}   error={workError} />}
            </div>
        </div>
    );
}

// =============================================================================
// Sub-tab renderers
// =============================================================================

function LoadingState() {
    return (
        <div className="flex flex-col items-center justify-center py-10 gap-3">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-slate-500">Gemini is analysing…</p>
        </div>
    );
}

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
    return (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
            <span className="text-2xl">⚠️</span>
            <p className="text-xs text-slate-400">{message}</p>
            {onRetry && (
                <button onClick={onRetry} className="text-xs text-indigo-400 hover:text-indigo-300 mt-1">
                    Retry
                </button>
            )}
        </div>
    );
}

// ── Score Tab ─────────────────────────────────────────────────────────────────

function ScoreTab({ data, loading, error }: {
    data: WorkforceScoreAnalysis | null;
    loading: boolean;
    error: string | null;
}) {
    if (loading) return <LoadingState />;
    if (error)   return <ErrorState message={error} />;
    if (!data)   return null;

    return (
        <div className="space-y-4">
            {/* Summary */}
            <p className="text-sm text-slate-300 leading-relaxed">{data.summary}</p>

            {/* Confidence */}
            <p className={`text-[10px] font-semibold uppercase tracking-widest ${CONFIDENCE_COLOR[data.confidence]}`}>
                Confidence: {data.confidence}
            </p>

            {/* Strengths */}
            {data.strengths.length > 0 && (
                <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">Strengths</p>
                    <ul className="space-y-1.5">
                        {data.strengths.map((s, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                                <span className="text-emerald-400 mt-0.5">✓</span>
                                {s}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Concerns */}
            {data.concerns.length > 0 && (
                <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">Concerns</p>
                    <ul className="space-y-1.5">
                        {data.concerns.map((c, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                                <span className="text-amber-400 mt-0.5">!</span>
                                {c}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Recommendations */}
            {data.recommendations.length > 0 && (
                <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">Recommendations</p>
                    <ul className="space-y-1.5">
                        {data.recommendations.map((r, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                                <span className="text-indigo-400 mt-0.5 font-bold">{i + 1}.</span>
                                {r}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

// ── Skill Gap Tab ─────────────────────────────────────────────────────────────

function SkillGapTab({ data, loading, error }: {
    data: SkillGapAnalysis | null;
    loading: boolean;
    error: string | null;
}) {
    if (loading) return <LoadingState />;
    if (error)   return <ErrorState message={error} />;
    if (!data)   return null;

    return (
        <div className="space-y-4">
            <p className="text-sm text-slate-300 leading-relaxed">{data.summary}</p>

            {data.priorityGaps.length > 0 && (
                <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">Priority Gaps</p>
                    <ul className="space-y-2">
                        {data.priorityGaps.map((gap, i) => (
                            <li key={i} className="rounded-lg border border-slate-700/60 p-3 bg-slate-800/40">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-semibold text-white capitalize">{gap.skill}</span>
                                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${URGENCY_COLOR[gap.urgency]}`}>
                                        {gap.urgency}
                                    </span>
                                </div>
                                <p className="text-[11px] text-slate-400">{gap.learningPath}</p>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {data.quickWins.length > 0 && (
                <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">Quick Wins</p>
                    <ul className="flex flex-wrap gap-2">
                        {data.quickWins.map((w, i) => (
                            <li key={i} className="text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded">
                                {w}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="flex items-center gap-2 pt-1">
                <span className="text-xs text-slate-500">Timeline:</span>
                <span className="text-xs text-slate-300 font-medium">{data.timelineEstimate}</span>
            </div>
        </div>
    );
}

// ── Workload Tab ──────────────────────────────────────────────────────────────

function WorkloadTab({ data, loading, error }: {
    data: WorkloadPrediction | null;
    loading: boolean;
    error: string | null;
}) {
    if (loading) return <LoadingState />;
    if (error)   return <ErrorState message={error} />;
    if (!data)   return null;

    return (
        <div className="space-y-4">
            {/* Risk badge */}
            <div className="flex items-center gap-2">
                <span className={`text-xs font-bold px-2.5 py-1 rounded border uppercase tracking-wide ${RISK_COLOR[data.riskLevel]}`}>
                    {data.riskLevel} risk
                </span>
                <span className="text-xs text-slate-400">{data.riskSummary}</span>
            </div>

            {/* Capacity bar */}
            <div>
                <div className="flex justify-between mb-1">
                    <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-widest">Remaining Capacity</span>
                    <span className="text-[10px] text-slate-400">{data.capacityScore}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all duration-500 ${
                            data.capacityScore >= 60 ? 'bg-emerald-500'
                            : data.capacityScore >= 35 ? 'bg-amber-500'
                            : 'bg-red-500'
                        }`}
                        style={{ width: `${Math.min(100, Math.max(0, data.capacityScore))}%` }}
                    />
                </div>
            </div>

            {/* Predicted issues */}
            {data.predictedIssues.length > 0 && (
                <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">If Unaddressed</p>
                    <ul className="space-y-1.5">
                        {data.predictedIssues.map((issue, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                                <span className="text-red-400 mt-0.5">→</span>
                                {issue}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Actions */}
            {data.rebalanceActions.length > 0 && (
                <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">Recommended Actions</p>
                    <ul className="space-y-1.5">
                        {data.rebalanceActions.map((action, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                                <span className="text-indigo-400 mt-0.5 font-bold">{i + 1}.</span>
                                {action}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
