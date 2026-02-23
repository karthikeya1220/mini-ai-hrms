// =============================================================================
// pages/InsightsPage.tsx — Admin Insights (/insights)
//
// Single home for all AI features. Three sections:
//
//  A  Team Overview   — avg score, improving/declining %, total skill gaps
//  B  Employee Intel  — grid of insight cards; clicking opens ScorePanel
//  C  Smart Assignment Helper — task picker → /api/ai/recommend/:taskId
//
// Query-param deep-links:
//   /insights?employeeId=<uuid>   → opens ScorePanel for that employee
//   /insights?taskId=<uuid>       → pre-selects task in section C
//
// Data sources (no new endpoints):
//   GET /api/dashboard          → employeeStats[]
//   GET /api/ai/score/:id       → via ScorePanel (lazy, per employee)
//   GET /api/ai/recommend/:taskId
//   GET /api/tasks              → task list for section C dropdown
// =============================================================================

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDashboard } from '../hooks/useDashboard';
import { useTasks } from '../hooks/useTasks';
import { useEmployees } from '../hooks/useEmployees';
import { recommendEmployees } from '../api/tasks';
import type { Recommendation } from '../api/tasks';
import type { EmployeeStat } from '../api/dashboard';
import type { Employee } from '../api/employees';
import { ScorePanel } from '../components/employees/ScorePanel';
import { Spinner } from '../components/ui';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(score: number | null): string {
    if (score === null) return '#64748b';
    if (score >= 90)    return '#10b981';
    if (score >= 80)    return '#3b82f6';
    if (score >= 70)    return '#6366f1';
    if (score >= 60)    return '#f59e0b';
    return '#ef4444';
}

function initials(name: string) {
    return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

function avatarHue(name: string) {
    return (name.charCodeAt(0) * 37) % 360;
}

// ─── Small Score Ring (48 px) ─────────────────────────────────────────────────

function MiniScoreRing({ score }: { score: number | null }) {
    const size = 48;
    const stroke = 5;
    const r = (size - stroke) / 2;
    const circ = 2 * Math.PI * r;
    const pct  = score ?? 0;
    const dash = (pct / 100) * circ;
    const color = scoreColor(score);

    return (
        <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
                className="-rotate-90" aria-hidden="true">
                <circle cx={size/2} cy={size/2} r={r}
                    fill="none" stroke="#1e293b" strokeWidth={stroke} />
                <circle cx={size/2} cy={size/2} r={r}
                    fill="none" stroke={color} strokeWidth={stroke}
                    strokeLinecap="round"
                    strokeDasharray={`${dash} ${circ}`} />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[10px] font-extrabold tabular-nums"
                    style={{ color }}>
                    {score !== null ? Math.round(score) : '—'}
                </span>
            </div>
        </div>
    );
}

// ─── Section A — Team Overview stat cards ─────────────────────────────────────

function OverviewCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
    return (
        <div className="flex flex-col gap-1 px-5 py-4 rounded-xl border border-slate-800 bg-slate-900">
            <span className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold">{label}</span>
            <span className="text-2xl font-bold text-white tabular-nums">{value}</span>
            {sub && <span className="text-xs text-slate-500">{sub}</span>}
        </div>
    );
}

// ─── Section B — Employee Insight Card ───────────────────────────────────────

interface InsightCardProps {
    stat: EmployeeStat;
    onViewDetails: () => void;
}

function InsightCard({ stat, onViewDetails }: InsightCardProps) {
    const ini  = initials(stat.name);
    const hue  = avatarHue(stat.name);
    const score = stat.productivityScore;

    // Derive a rough trend from the score bands (we don't have per-card trend
    // without an extra network call; show grade instead)
    const grade =
        score === null ? '—'   :
        score >= 90   ? 'A+'   :
        score >= 80   ? 'A'    :
        score >= 70   ? 'B'    :
        score >= 60   ? 'C'    : 'D';

    return (
        <article className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex flex-col gap-3">
            {/* Header row */}
            <div className="flex items-center gap-3">
                <div
                    className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
                    style={{ background: `hsl(${hue},55%,32%)` }}
                    aria-hidden="true"
                >
                    {ini}
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-200 truncate">{stat.name}</p>
                    <p className="text-[10px] text-slate-500 truncate">{stat.role ?? 'Employee'}</p>
                </div>
                <MiniScoreRing score={score} />
            </div>

            {/* Grade + status row */}
            <div className="flex items-center gap-2 text-xs">
                <span className="px-2 py-0.5 rounded-md border border-slate-700 bg-slate-800 font-semibold text-slate-300">
                    Grade {grade}
                </span>
                <span className={`${stat.isActive ? 'text-emerald-400' : 'text-slate-600'} flex items-center gap-1`}>
                    <span className={`w-1.5 h-1.5 rounded-full inline-block ${stat.isActive ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                    {stat.isActive ? 'Active' : 'Inactive'}
                </span>
            </div>

            {/* Task stats */}
            <div className="flex gap-3 text-[10px] text-slate-500">
                <span>{stat.tasksCompleted}/{stat.tasksAssigned} tasks</span>
                <span>{Math.round(stat.completionRate * 100)}% completion</span>
            </div>

            {/* View details */}
            <button
                type="button"
                onClick={onViewDetails}
                className="
                    w-full mt-auto text-xs font-medium text-slate-400
                    border border-slate-800 rounded-lg py-1.5
                    hover:border-slate-600 hover:text-slate-200
                    transition-colors text-center
                "
            >
                View Details →
            </button>
        </article>
    );
}

// ─── Section C — Smart Assignment Helper ─────────────────────────────────────

interface AssignHelperProps {
    tasks: { id: string; title: string; status: string }[];
    initialTaskId?: string;
}

function AssignHelper({ tasks, initialTaskId }: AssignHelperProps) {
    const openTasks = tasks.filter(t => t.status !== 'completed');
    const [selectedTaskId, setSelectedTaskId] = useState(initialTaskId ?? '');
    const [recs, setRecs]       = useState<Recommendation[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError]     = useState<string | null>(null);
    const [fetched, setFetched] = useState<string | null>(null); // last fetched taskId

    // If deep-link brings a pre-selected task, auto-fetch once
    useEffect(() => {
        if (initialTaskId && initialTaskId !== fetched) {
            handleGet(initialTaskId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialTaskId]);

    async function handleGet(overrideId?: string) {
        const id = overrideId ?? selectedTaskId;
        if (!id) return;
        setLoading(true);
        setError(null);
        setRecs(null);
        try {
            const data = await recommendEmployees(id);
            setRecs(data);
            setFetched(id);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load recommendations');
        } finally {
            setLoading(false);
        }
    }

    const taskTitle = openTasks.find(t => t.id === (fetched ?? selectedTaskId))?.title;

    return (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                Smart Assignment Helper
            </p>

            {/* Task selector */}
            <div className="flex gap-2 items-end flex-wrap">
                <div className="flex-1 min-w-[200px]">
                    <label htmlFor="assign-task-select" className="block text-[10px] text-slate-600 mb-1 uppercase tracking-wider">
                        Select task
                    </label>
                    <select
                        id="assign-task-select"
                        value={selectedTaskId}
                        onChange={e => { setSelectedTaskId(e.target.value); setRecs(null); setFetched(null); }}
                        className="
                            w-full px-3 py-2 rounded-lg
                            border border-slate-700 bg-slate-800
                            text-sm text-slate-200
                            focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20
                        "
                    >
                        <option value="">— Choose a task —</option>
                        {openTasks.map(t => (
                            <option key={t.id} value={t.id}>{t.title}</option>
                        ))}
                    </select>
                </div>

                <button
                    onClick={() => handleGet()}
                    disabled={!selectedTaskId || loading}
                    className="
                        px-4 py-2 rounded-lg text-sm font-medium
                        border border-indigo-500/40 bg-indigo-500/10 text-indigo-300
                        hover:bg-indigo-500/20 hover:border-indigo-500/60
                        disabled:opacity-40 disabled:cursor-not-allowed
                        transition-colors flex items-center gap-2
                    "
                >
                    {loading && <Spinner className="w-3.5 h-3.5" />}
                    Get Recommendation
                </button>
            </div>

            {/* Error */}
            {error && <p className="text-sm text-red-400">{error}</p>}

            {/* Results */}
            {recs !== null && (
                <div className="space-y-2">
                    <p className="text-[10px] text-slate-600 uppercase tracking-wider">
                        Results for: <span className="text-slate-400 normal-case">{taskTitle}</span>
                    </p>

                    {recs.length === 0 ? (
                        <p className="text-sm text-slate-600">No suitable candidates found.</p>
                    ) : (
                        <div className="space-y-2">
                            {recs.map(r => (
                                <div
                                    key={r.employee.id}
                                    className="flex items-center gap-3 px-3 py-3 rounded-xl border border-slate-800 bg-slate-800/40"
                                >
                                    {/* Rank badge */}
                                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-400">
                                        #{r.rank}
                                    </span>

                                    {/* Avatar */}
                                    <div
                                        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                                        style={{ background: `hsl(${avatarHue(r.employee.name)},55%,32%)` }}
                                    >
                                        {initials(r.employee.name)}
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-slate-200 truncate">{r.employee.name}</p>
                                        <p className="text-[10px] text-slate-500 truncate">
                                            {r.employee.role ?? 'Employee'}
                                            {r.employee.department ? ` · ${r.employee.department}` : ''}
                                        </p>
                                    </div>

                                    {/* Reasoning */}
                                    <div className="flex-shrink-0 text-right space-y-0.5">
                                        <p className="text-[10px] text-slate-400 tabular-nums">
                                            {r.reasoning.skillOverlap} skill{r.reasoning.skillOverlap !== 1 ? 's' : ''} match
                                        </p>
                                        <p className="text-[10px] text-slate-600 tabular-nums">
                                            {r.reasoning.activeCount} active task{r.reasoning.activeCount !== 1 ? 's' : ''}
                                        </p>
                                        <p className="text-[10px] text-slate-600 tabular-nums">
                                            Score: {Math.round(r.reasoning.perfScore)}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InsightsPage() {
    const [searchParams] = useSearchParams();
    const deepLinkEmployeeId = searchParams.get('employeeId') ?? undefined;
    const deepLinkTaskId     = searchParams.get('taskId')     ?? undefined;

    // ── Dashboard data (employee stats) ───────────────────────────────────────
    const { data: dash, loading: dashLoading, error: dashError } = useDashboard();

    // ── Full employee list (needed to pass Employee object to ScorePanel) ──────
    const { employees } = useEmployees({ isActive: 'true', limit: 100 });
    const empMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);

    // ── Task list for section C ────────────────────────────────────────────────
    const { tasks } = useTasks({ limit: 100 });

    // ── Score panel overlay ───────────────────────────────────────────────────
    // Initial value handles deep-link (?employeeId=...) by finding the employee
    // once employees are loaded. We open lazily on first render via the
    // "View Details" button path; deep-link opens via useEffect when empMap populates.
    const [scorePanelTarget, setScorePanelTarget] = useState<Employee | null>(null);

    // When empMap is ready and a deep-link employeeId is present, open the panel.
    // Use a timeout to avoid calling setState synchronously inside an effect.
    useEffect(() => {
        if (!deepLinkEmployeeId || scorePanelTarget) return;
        const emp = empMap.get(deepLinkEmployeeId);
        if (!emp) return;
        const id = setTimeout(() => setScorePanelTarget(emp), 0);
        return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deepLinkEmployeeId, empMap]);

    // ── Team overview derived stats ───────────────────────────────────────────
    const stats = dash?.employeeStats ?? [];

    const scoredEmployees = stats.filter(s => s.productivityScore !== null);
    const avgScore = scoredEmployees.length
        ? scoredEmployees.reduce((acc, s) => acc + (s.productivityScore ?? 0), 0) / scoredEmployees.length
        : null;

    // Proxy for "improving": score >= 70; "declining": score < 60
    const improving = scoredEmployees.filter(s => (s.productivityScore ?? 0) >= 70).length;
    const declining = scoredEmployees.filter(s => (s.productivityScore ?? 0) < 60).length;
    const totalEmployees = stats.length;

    // Skill-gap proxy: employees with completionRate < 0.5 as rough gap signal
    // (actual gap count would need per-employee calls — use completion rate as proxy)
    const lowCompletion = stats.filter(s => s.completionRate < 0.5).length;

    return (
        <div className="min-h-dvh bg-slate-950 text-slate-100">

            {/* ── Header ─────────────────────────────────────────────────────── */}
            <header className="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center">
                    <h1 className="text-2xl font-semibold text-white tracking-tight">Insights</h1>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-10">

                {dashError && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
                        {dashError}
                    </div>
                )}

                {/* ══════════════════════════════════════════════════════════════
                    SECTION A — Team Overview
                ══════════════════════════════════════════════════════════════ */}
                <section aria-labelledby="overview-heading">
                    <h2 id="overview-heading" className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">
                        Team Overview
                    </h2>

                    {dashLoading ? (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {[1,2,3,4].map(i => (
                                <div key={i} className="h-20 rounded-xl bg-slate-800 animate-pulse" />
                            ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <OverviewCard
                                label="Avg Score"
                                value={avgScore !== null ? Math.round(avgScore) : '—'}
                                sub={`${scoredEmployees.length} of ${totalEmployees} scored`}
                            />
                            <OverviewCard
                                label="High Performers"
                                value={improving}
                                sub={`score ≥ 70 · ${totalEmployees ? Math.round(improving / totalEmployees * 100) : 0}%`}
                            />
                            <OverviewCard
                                label="Need Attention"
                                value={declining}
                                sub={`score < 60 · ${totalEmployees ? Math.round(declining / totalEmployees * 100) : 0}%`}
                            />
                            <OverviewCard
                                label="Low Completion"
                                value={lowCompletion}
                                sub="completion rate < 50%"
                            />
                        </div>
                    )}
                </section>

                {/* ══════════════════════════════════════════════════════════════
                    SECTION B — Employee Intelligence
                ══════════════════════════════════════════════════════════════ */}
                <section aria-labelledby="intel-heading">
                    <h2 id="intel-heading" className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">
                        Employee Intelligence
                    </h2>

                    {dashLoading ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {[1,2,3,4,5,6].map(i => (
                                <div key={i} className="h-44 rounded-xl bg-slate-800 animate-pulse" />
                            ))}
                        </div>
                    ) : stats.length === 0 ? (
                        <p className="text-sm text-slate-600">No employee data available.</p>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {stats.map(stat => (
                                <InsightCard
                                    key={stat.employeeId}
                                    stat={stat}
                                    onViewDetails={() => {
                                        const emp = empMap.get(stat.employeeId);
                                        if (emp) setScorePanelTarget(emp);
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </section>

                {/* ══════════════════════════════════════════════════════════════
                    SECTION C — Smart Assignment Helper
                ══════════════════════════════════════════════════════════════ */}
                <section aria-labelledby="assign-heading">
                    <h2 id="assign-heading" className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">
                        Smart Assignment
                    </h2>
                    <AssignHelper tasks={tasks} initialTaskId={deepLinkTaskId} />
                </section>

            </main>

            {/* ── Score Panel overlay ─────────────────────────────────────────── */}
            {scorePanelTarget && (
                <ScorePanel
                    employee={scorePanelTarget}
                    onClose={() => setScorePanelTarget(null)}
                />
            )}
        </div>
    );
}
