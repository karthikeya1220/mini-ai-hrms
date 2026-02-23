// components/employees/GeminiAnalysisPanel.tsx
//
// Tabbed Gemini AI panel embedded in ScorePanel.
// Three tabs — each lazy-loads on first click, results cached for component lifetime.
//
// Tab 1 · Score     → GET /api/ai/gemini/score/:employeeId
//   Displays: numeric score ring, grade, explanation, strengths/concerns, confidence
//
// Tab 2 · Skill Gaps → GET /api/ai/gemini/skill-gap/:employeeId
//   Displays: missing skills (chips), emerging skills (chips), rationale, confidence
//
// Tab 3 · Trend      → GET /api/ai/gemini/trend/:employeeId
//   Displays: directional arrow, confidence bar, explanation, key signals, forecast

import { useState, useCallback, useEffect } from 'react';
import {
    geminiScore,
    geminiSkillGap,
    geminiTrend,
    type GeminiScoreResult,
    type GeminiSkillGapResult,
    type GeminiTrendResult,
} from '../../api/ai';

// ─── Tab registry ─────────────────────────────────────────────────────────────

type Tab = 'score' | 'skill-gap' | 'trend';

const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'score',     label: 'Score',      icon: '📊' },
    { id: 'skill-gap', label: 'Skill Gaps', icon: '🎯' },
    { id: 'trend',     label: 'Trend',      icon: '📈' },
];

// ─── Colour maps ──────────────────────────────────────────────────────────────

const CONFIDENCE_TEXT: Record<'high' | 'medium' | 'low', string> = {
    high:   'text-emerald-400',
    medium: 'text-amber-400',
    low:    'text-slate-500',
};

const TREND_META: Record<'up' | 'down' | 'flat', { arrow: string; label: string; cls: string }> = {
    up:   { arrow: '↑', label: 'Improving',  cls: 'text-emerald-400' },
    down: { arrow: '↓', label: 'Declining',  cls: 'text-red-400'     },
    flat: { arrow: '→', label: 'Stable',     cls: 'text-slate-400'   },
};

// ─── Shared loading / error states ───────────────────────────────────────────

function LoadingState() {
    return (
        <div className="flex flex-col items-center justify-center py-10 gap-3">
            <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-slate-500">Gemini is analysing…</p>
        </div>
    );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
            <span className="text-2xl">⚠️</span>
            <p className="text-xs text-slate-400 max-w-[240px]">{message}</p>
            <button
                onClick={onRetry}
                className="text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-2 mt-1"
            >
                Retry
            </button>
        </div>
    );
}

// ─── Score Tab ────────────────────────────────────────────────────────────────

function ScoreTab({
    data, loading, error, onRetry,
}: {
    data: GeminiScoreResult | null;
    loading: boolean;
    error: string | null;
    onRetry: () => void;
}) {
    if (loading) return <LoadingState />;
    if (error)   return <ErrorState message={error} onRetry={onRetry} />;
    if (!data)   return null;

    const score   = data.score ?? 0;
    const r       = 44;
    const circ    = 2 * Math.PI * r;
    const fill    = (score / 100) * circ;
    const color   =
        score >= 90 ? '#10b981' :
        score >= 80 ? '#8b5cf6' :
        score >= 70 ? '#38bdf8' :
        score >= 60 ? '#f59e0b' : '#ef4444';

    return (
        <div className="space-y-4">
            {/* Score ring + grade */}
            {data.score !== null ? (
                <div className="flex items-center gap-4">
                    <svg width="108" height="108" viewBox="0 0 108 108" className="shrink-0">
                        <circle cx="54" cy="54" r={r} fill="none" stroke="#1e293b" strokeWidth="8" />
                        <circle
                            cx="54" cy="54" r={r}
                            fill="none"
                            stroke={color}
                            strokeWidth="8"
                            strokeLinecap="round"
                            strokeDasharray={`${fill} ${circ}`}
                            strokeDashoffset={circ * 0.25}
                            style={{ transition: 'stroke-dasharray 0.9s cubic-bezier(0.4,0,0.2,1)' }}
                        />
                        <text x="54" y="50" textAnchor="middle" fill="white" fontSize="22" fontWeight="800" fontFamily="Inter,sans-serif">
                            {score}
                        </text>
                        <text x="54" y="66" textAnchor="middle" fill={color} fontSize="12" fontWeight="700" fontFamily="Inter,sans-serif">
                            {data.grade ?? '—'}
                        </text>
                    </svg>
                    <div className="space-y-1.5 min-w-0">
                        <p className="text-xs text-slate-300 leading-relaxed">{data.explanation}</p>
                        <p className={`text-[10px] font-semibold uppercase tracking-widest ${CONFIDENCE_TEXT[data.confidence]}`}>
                            Confidence: {data.confidence}
                        </p>
                    </div>
                </div>
            ) : (
                <p className="text-xs text-slate-500 text-center py-4">
                    No completed tasks yet — score will appear once a task is completed.
                </p>
            )}

            {/* Strengths */}
            {data.strengths.length > 0 && (
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">Strengths</p>
                    <ul className="space-y-1.5">
                        {data.strengths.map((s, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                                <span className="text-emerald-400 mt-0.5 shrink-0">✓</span>
                                {s}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Concerns */}
            {data.concerns.length > 0 && (
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">Concerns</p>
                    <ul className="space-y-1.5">
                        {data.concerns.map((c, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                                <span className="text-amber-400 mt-0.5 shrink-0">!</span>
                                {c}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

// ─── Skill Gap Tab ────────────────────────────────────────────────────────────

function SkillGapTab({
    data, loading, error, onRetry,
}: {
    data: GeminiSkillGapResult | null;
    loading: boolean;
    error: string | null;
    onRetry: () => void;
}) {
    if (loading) return <LoadingState />;
    if (error)   return <ErrorState message={error} onRetry={onRetry} />;
    if (!data)   return null;

    return (
        <div className="space-y-4">
            {/* Rationale */}
            <p className="text-xs text-slate-300 leading-relaxed">{data.rationale}</p>

            {/* Confidence */}
            <p className={`text-[10px] font-semibold uppercase tracking-widest ${CONFIDENCE_TEXT[data.confidence]}`}>
                Confidence: {data.confidence}
                {data.peerTaskSkills.length > 0 && (
                    <span className="text-slate-600 font-normal normal-case ml-1">
                        ({data.peerTaskSkills.length} peer skills sampled)
                    </span>
                )}
            </p>

            {/* Missing skills */}
            {data.missingSkills.length > 0 ? (
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">
                        Missing Skills
                        <span className="ml-1 text-red-400 font-bold">({data.missingSkills.length})</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                        {data.missingSkills.map(skill => (
                            <span
                                key={skill}
                                className="px-2 py-0.5 rounded-md bg-red-500/10 border border-red-500/25 text-[11px] font-medium text-red-300"
                            >
                                {skill}
                            </span>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="flex items-center gap-2 text-xs text-emerald-400">
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                    No skill gaps detected — fully aligned with peer role requirements.
                </div>
            )}

            {/* Emerging skills */}
            {data.emergingSkills.length > 0 && (
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">
                        Emerging Skills to Consider
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                        {data.emergingSkills.map(skill => (
                            <span
                                key={skill}
                                className="px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/25 text-[11px] font-medium text-indigo-300"
                            >
                                {skill}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Current skills (collapsed list) */}
            {data.currentSkills.length > 0 && (
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 mb-1.5">
                        Current Skills ({data.currentSkills.length})
                    </p>
                    <div className="flex flex-wrap gap-1">
                        {data.currentSkills.map(skill => (
                            <span
                                key={skill}
                                className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700/60 text-[10px] text-slate-400"
                            >
                                {skill}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Trend Tab ────────────────────────────────────────────────────────────────

function TrendTab({
    data, loading, error, onRetry,
}: {
    data: GeminiTrendResult | null;
    loading: boolean;
    error: string | null;
    onRetry: () => void;
}) {
    if (loading) return <LoadingState />;
    if (error)   return <ErrorState message={error} onRetry={onRetry} />;
    if (!data)   return null;

    const meta = TREND_META[data.trend];

    return (
        <div className="space-y-4">
            {/* Trend arrow + direction */}
            <div className="flex items-center gap-3">
                <span className={`text-4xl font-black leading-none ${meta.cls}`}>{meta.arrow}</span>
                <div>
                    <p className={`text-base font-bold ${meta.cls}`}>{meta.label}</p>
                    <p className="text-[10px] text-slate-500">
                        {data.logCount} log{data.logCount !== 1 ? 's' : ''} over {data.windowDays}-day window
                    </p>
                </div>
                {/* Confidence badge */}
                <div className="ml-auto text-right">
                    <p className="text-[10px] text-slate-500 mb-0.5">Confidence</p>
                    <p className={`text-sm font-bold tabular-nums ${
                        data.confidence >= 75 ? 'text-emerald-400' :
                        data.confidence >= 40 ? 'text-amber-400'   : 'text-slate-500'
                    }`}>{data.confidence}%</p>
                </div>
            </div>

            {/* Confidence bar */}
            <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all duration-700 ${
                        data.confidence >= 75 ? 'bg-emerald-500' :
                        data.confidence >= 40 ? 'bg-amber-500'   : 'bg-slate-600'
                    }`}
                    style={{ width: `${data.confidence}%` }}
                />
            </div>

            {/* Explanation */}
            <p className="text-xs text-slate-300 leading-relaxed">{data.explanation}</p>

            {/* Key signals */}
            {data.keySignals.length > 0 && (
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">Key Signals</p>
                    <ul className="space-y-1.5">
                        {data.keySignals.map((signal, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                                <span className={`mt-0.5 shrink-0 font-bold ${meta.cls}`}>•</span>
                                {signal}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Forecast */}
            {data.forecast && (
                <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">7-Day Forecast</p>
                    <p className="text-xs text-slate-300 leading-relaxed">{data.forecast}</p>
                </div>
            )}
        </div>
    );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
    employeeId:   string;
    employeeName: string;
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function GeminiAnalysisPanel({ employeeId, employeeName }: Props) {
    const [activeTab, setActiveTab] = useState<Tab>('score');

    // Per-tab data
    const [scoreData,  setScoreData]  = useState<GeminiScoreResult   | null>(null);
    const [gapData,    setGapData]    = useState<GeminiSkillGapResult | null>(null);
    const [trendData,  setTrendData]  = useState<GeminiTrendResult    | null>(null);

    // Per-tab loading
    const [scoreLoading,  setScoreLoading]  = useState(false);
    const [gapLoading,    setGapLoading]    = useState(false);
    const [trendLoading,  setTrendLoading]  = useState(false);

    // Per-tab errors
    const [scoreError,  setScoreError]  = useState<string | null>(null);
    const [gapError,    setGapError]    = useState<string | null>(null);
    const [trendError,  setTrendError]  = useState<string | null>(null);

    // ── Lazy loaders ──────────────────────────────────────────────────────────

    const loadScore = useCallback(async () => {
        if (scoreData || scoreLoading) return;
        setScoreLoading(true);
        setScoreError(null);
        try {
            setScoreData(await geminiScore(employeeId));
        } catch {
            setScoreError('Gemini score unavailable. The server may be busy — please retry.');
        } finally {
            setScoreLoading(false);
        }
    }, [employeeId, scoreData, scoreLoading]);

    const retryScore = useCallback(() => {
        setScoreData(null);
        setScoreError(null);
        setScoreLoading(false);
    }, []);

    const loadGap = useCallback(async () => {
        if (gapData || gapLoading) return;
        setGapLoading(true);
        setGapError(null);
        try {
            setGapData(await geminiSkillGap(employeeId));
        } catch {
            setGapError('Skill gap analysis unavailable. Please retry.');
        } finally {
            setGapLoading(false);
        }
    }, [employeeId, gapData, gapLoading]);

    const retryGap = useCallback(() => {
        setGapData(null);
        setGapError(null);
        setGapLoading(false);
    }, []);

    const loadTrend = useCallback(async () => {
        if (trendData || trendLoading) return;
        setTrendLoading(true);
        setTrendError(null);
        try {
            setTrendData(await geminiTrend(employeeId));
        } catch {
            setTrendError('Trend analysis unavailable. Please retry.');
        } finally {
            setTrendLoading(false);
        }
    }, [employeeId, trendData, trendLoading]);

    const retryTrend = useCallback(() => {
        setTrendData(null);
        setTrendError(null);
        setTrendLoading(false);
    }, []);

    // Auto-load score on first mount
    useEffect(() => { loadScore(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Tab switch ────────────────────────────────────────────────────────────

    const handleTab = (tab: Tab) => {
        setActiveTab(tab);
        if (tab === 'score')     loadScore();
        if (tab === 'skill-gap') loadGap();
        if (tab === 'trend')     loadTrend();
    };

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="rounded-xl border border-slate-700/60 bg-slate-900 overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700/60 bg-slate-800/50">
                <span className="text-base">✨</span>
                <div>
                    <p className="text-xs font-semibold text-white leading-none">Gemini AI Analysis</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{employeeName}</p>
                </div>
                <span className="ml-auto text-[10px] text-slate-600 font-mono">gemini-2.5-flash</span>
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
            <div className="p-4 min-h-[220px]">
                {activeTab === 'score'     && (
                    <ScoreTab
                        data={scoreData}
                        loading={scoreLoading}
                        error={scoreError}
                        onRetry={retryScore}
                    />
                )}
                {activeTab === 'skill-gap' && (
                    <SkillGapTab
                        data={gapData}
                        loading={gapLoading}
                        error={gapError}
                        onRetry={retryGap}
                    />
                )}
                {activeTab === 'trend'     && (
                    <TrendTab
                        data={trendData}
                        loading={trendLoading}
                        error={trendError}
                        onRetry={retryTrend}
                    />
                )}
            </div>
        </div>
    );
}
