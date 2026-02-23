// components/employees/ScorePanel.tsx
// Slide-out panel showing an employee's AI productivity score and breakdown.

import { useState, useEffect } from 'react';
import { getEmployeeScore, getSkillGap } from '../../api/employees';
import type { Employee, ProductivityScore, SkillGap } from '../../api/employees';
import { Spinner } from '../ui';
import { ScoreBadge } from '../dashboard/ScoreBadge';
import { GeminiAnalysisPanel } from './GeminiAnalysisPanel';

// ─── Radial score ring ────────────────────────────────────────────────────────

function ScoreRing({ score, grade }: { score: number; grade: string }) {
    const r = 52;
    const circ = 2 * Math.PI * r;
    const fill = (score / 100) * circ;

    const color =
        score >= 90 ? '#10b981' :   /* emerald — A+ */
            score >= 80 ? '#8b5cf6' :   /* violet  — A  */
                score >= 70 ? '#38bdf8' :   /* sky     — B  */
                    score >= 60 ? '#f59e0b' : '#ef4444'; /* amber C / red D */

    return (
        <div className="flex flex-col items-center gap-2">
            <svg width="128" height="128" viewBox="0 0 128 128">
                {/* Track */}
                <circle cx="64" cy="64" r={r} fill="none" stroke="#1e293b" strokeWidth="10" />
                {/* Progress */}
                <circle
                    cx="64" cy="64" r={r}
                    fill="none"
                    stroke={color}
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={`${fill} ${circ}`}
                    strokeDashoffset={circ * 0.25}  /* start from top */
                    style={{ transition: 'stroke-dasharray 1s cubic-bezier(0.4,0,0.2,1)' }}
                />
                <text x="64" y="58" textAnchor="middle" fill="white" fontSize="26" fontWeight="800" fontFamily="Inter,sans-serif">
                    {score}
                </text>
                <text x="64" y="76" textAnchor="middle" fill={color} fontSize="13" fontWeight="600" fontFamily="Inter,sans-serif">
                    {grade}
                </text>
            </svg>
            <p className="text-xs text-slate-500">Productivity score</p>
        </div>
    );
}

// ─── Breakdown bar ────────────────────────────────────────────────────────────

function BreakdownBar({ label, value, max = 1 }: { label: string; value: number; max?: number }) {
    const pct = Math.round((value / max) * 100);
    return (
        <div className="space-y-1">
            <div className="flex justify-between text-xs">
                <span className="text-slate-400">{label}</span>
                <span className="text-slate-300 tabular-nums font-medium">{pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                    className="h-full rounded-full bg-lime-400 transition-all duration-700"
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
}

// ─── Skill gap section ────────────────────────────────────────────────────────

function SkillGapSection({ employeeId }: { employeeId: string }) {
    const [gap, setGap] = useState<SkillGap | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const t = setTimeout(() => {
            if (!cancelled) setLoading(true);
        }, 0);

        getSkillGap(employeeId)
            .then(data => { if (!cancelled) setGap(data); })
            .catch(() => { if (!cancelled) setGap(null); })
            .finally(() => { if (!cancelled) { clearTimeout(t); setLoading(false); } });

        return () => { cancelled = true; clearTimeout(t); };
    }, [employeeId]);

    if (loading) return <div className="h-20 flex items-center justify-center"><Spinner className="w-5 h-5 opacity-40" /></div>;
    if (!gap || gap.requiredSkills.length === 0) return null;

    return (
        <section className="rounded-xl border border-white/8 bg-white/3 p-4 space-y-3">
            <div className="flex justify-between items-center">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Skill Gap Analysis</h3>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-lime-400/10 text-lime-400 border border-lime-400/20">
                    {Math.round(gap.coverageRate * 100)}% Coverage
                </span>
            </div>

            {gap.gapSkills.length > 0 ? (
                <div className="space-y-2">
                    <p className="text-[11px] text-slate-400">Missing skills required for current role:</p>
                    <div className="flex flex-wrap gap-1.5">
                        {gap.gapSkills.map(s => (
                            <span key={s} className="px-2 py-0.5 rounded-md bg-red-500/10 border border-red-500/20 text-[10px] font-medium text-red-400">
                                {s}
                            </span>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="flex items-center gap-2 text-[11px] text-emerald-400">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Skills fully aligned with role requirements
                </div>
            )}
        </section>
    );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

interface Props {
    employee: Employee;
    onClose: () => void;
}

export function ScorePanel({ employee, onClose }: Props) {
    type ScoreState =
        | { status: 'loading' }
        | { status: 'ok'; data: ProductivityScore }
        | { status: 'error'; message: string };

    const [state, setState] = useState<ScoreState>({ status: 'loading' });

    useEffect(() => {
        let cancelled = false;
        // reset to loading asynchronously so React doesn't cascade
        const t = setTimeout(() => {
            if (!cancelled) setState({ status: 'loading' });
        }, 0);
        getEmployeeScore(employee.id)
            .then(d => { if (!cancelled) { clearTimeout(t); setState({ status: 'ok', data: d }); } })
            .catch(e => { if (!cancelled) { clearTimeout(t); setState({ status: 'error', message: e.message ?? 'Failed to load score' }); } });
        return () => { cancelled = true; clearTimeout(t); };
    }, [employee.id]);

    const loading = state.status === 'loading';
    const error = state.status === 'error' ? state.message : '';
    const data = state.status === 'ok' ? state.data : null;

    return (
        <>
            <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
            <aside
                role="dialog"
                aria-modal
                aria-label={`Productivity score — ${employee.name}`}
                className="fixed inset-y-0 right-0 z-50 w-full max-w-sm flex flex-col bg-[#0a0a0a] border-l border-white/8 shadow-2xl"
                style={{ animation: 'slideInRight 0.22s ease both' }}
            >
                {/* Header */}
                <header className="flex items-center justify-between px-6 py-4 border-b border-white/8">
                    <div>
                        <p className="text-sm font-semibold text-white">{employee.name}</p>
                        <p className="text-xs text-slate-500">{employee.jobTitle ?? 'No job title'}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-all"
                        aria-label="Close"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </header>

                <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-40 gap-3 text-slate-500">
                            <Spinner className="w-8 h-8" />
                            <p className="text-sm">Computing score…</p>
                        </div>
                    ) : error ? (
                        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300 text-center">
                            {error}
                            <br />
                            <span className="text-xs text-slate-500 mt-1 block">
                                The score requires at least one completed task.
                            </span>
                        </div>
                    ) : data ? (
                        <>
                            {data.score === null ? (
                                <div className="rounded-xl border border-white/8 bg-white/3 p-6 text-center text-sm text-slate-500">
                                    No completed tasks yet — score will appear once a task is completed.
                                </div>
                            ) : (
                            <>
                            {/* Score ring */}
                            <div className="flex justify-center">
                                <ScoreRing score={data.score} grade={data.grade ?? '—'} />
                            </div>

                            {/* Trend */}
                            <div className="flex items-center justify-center gap-2">
                                <span className={`text-sm font-semibold ${data.trend === 'improving' ? 'text-emerald-400' : data.trend === 'declining' ? 'text-red-400' : 'text-slate-400'}`}>
                                    {data.trend === 'improving' ? '↑ Improving' : data.trend === 'declining' ? '↓ Declining' : data.trend === 'stable' ? '→ Stable' : '— Insufficient data'}
                                </span>
                            </div>

                            {/* Breakdown */}
                            {data.breakdown && (
                            <section className="rounded-xl border border-white/8 bg-white/3 p-4 space-y-4">
                                <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Score breakdown</h3>
                                <BreakdownBar label="Task completion rate" value={data.breakdown.completionRate} />
                                <BreakdownBar label="On-time delivery" value={data.breakdown.onTimeRate} />
                                <BreakdownBar
                                    label="Avg task complexity"
                                    value={data.breakdown.avgComplexity}
                                    max={5}
                                />
                                <div className="pt-2 flex justify-between text-xs text-slate-600">
                                    <span>Tasks assigned: <span className="text-slate-400 font-medium">{data.breakdown.totalTasksAssigned}</span></span>
                                    <span>Completed: <span className="text-slate-400 font-medium">{data.breakdown.totalCompleted}</span></span>
                                </div>
                            </section>
                            )}

                            {/* Skill Gaps */}
                            <SkillGapSection employeeId={employee.id} />

                            {/* Gemini AI Analysis */}
                            <GeminiAnalysisPanel
                                employeeId={employee.id}
                                employeeName={employee.name}
                            />

                            {/* Meta + badge */}
                            <div className="pt-2 text-center text-xs text-slate-600">
                                Computed: {new Date(data.computedAt).toLocaleDateString()}
                            </div>

                            {/* Score badge */}
                            <div className="flex justify-center">
                                <ScoreBadge rate={data.score / 100} size="md" />
                            </div>
                            </>
                            )}
                        </>
                    ) : null}
                </div>

                <style>{`
          @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0.6; }
            to   { transform: translateX(0);    opacity: 1; }
          }
        `}</style>
            </aside>
        </>
    );
}
