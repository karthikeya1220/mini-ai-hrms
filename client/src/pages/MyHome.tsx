// =============================================================================
// pages/MyHome.tsx — Employee Home (/my)
//
// SECTION 1 — My Work
//   • Work-summary strip: active tasks, overdue tasks, next due date
//   • My Tasks list (not Kanban) — clickable rows open TaskDetailDrawer
//
// SECTION 2 — My Performance
//   • Productivity Score Ring + grade
//   • Completion / on-time / avg complexity stats
//   • Skill-gap chip panel
//   • Trend indicator
//
// Data sources (no new endpoints):
//   • GET /api/tasks           — auto-filtered by role on server
//   • GET /api/ai/score/:id    — via getEmployeeScore
//   • GET /api/ai/skill-gap/:id — via getSkillGap
// =============================================================================

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useWeb3Context } from '../context/Web3Context';
import { useTasks } from '../hooks/useTasks';
import { getEmployeeScore, getSkillGap } from '../api/employees';
import type { ProductivityScore, SkillGap } from '../api/employees';
import type { Task, TaskStatus } from '../api/tasks';
import { updateTaskStatus } from '../api/tasks';
import { client } from '../api/client';
import { TaskDetailDrawer } from '../components/tasks/TaskDetailDrawer';
import toast from 'react-hot-toast';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_DOT: Record<string, string> = {
    low:    'bg-slate-500',
    medium: 'bg-amber-500',
    high:   'bg-red-500',
};

const STATUS_LABEL: Record<TaskStatus, string> = {
    assigned:    'Assigned',
    in_progress: 'In Progress',
    completed:   'Completed',
};

function fmtDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function dueDateColor(iso: string | null): string {
    if (!iso) return 'text-slate-500';
    const diff = new Date(iso).getTime() - Date.now();
    if (diff < 0)              return 'text-red-400';
    if (diff < 86_400_000 * 2) return 'text-amber-400';
    return 'text-slate-400';
}

// ─── Score Ring ───────────────────────────────────────────────────────────────

function scoreColor(score: number | null): string {
    if (score === null) return '#64748b';
    if (score >= 90)    return '#10b981';
    if (score >= 80)    return '#3b82f6';
    if (score >= 70)    return '#6366f1';
    if (score >= 60)    return '#f59e0b';
    return '#ef4444';
}

function ScoreRing({ score }: { score: number | null }) {
    const size = 96;
    const stroke = 7;
    const r = (size - stroke) / 2;
    const circ = 2 * Math.PI * r;
    const pct = score ?? 0;
    const dash = (pct / 100) * circ;
    const color = scoreColor(score);

    return (
        <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={stroke} />
                <circle
                    cx={size / 2} cy={size / 2} r={r}
                    fill="none"
                    stroke={color}
                    strokeWidth={stroke}
                    strokeLinecap="round"
                    strokeDasharray={`${dash} ${circ}`}
                    style={{ transition: 'stroke-dasharray 0.5s ease' }}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-extrabold text-white tabular-nums leading-none"
                    style={{ color }}
                >
                    {score !== null ? Math.round(score) : '—'}
                </span>
                <span className="text-[9px] text-slate-500 uppercase tracking-wider mt-0.5">score</span>
            </div>
        </div>
    );
}

// ─── Trend badge ──────────────────────────────────────────────────────────────

const TREND_META: Record<string, { label: string; arrow: string; color: string }> = {
    improving:        { label: 'Improving',        arrow: '↑', color: 'text-emerald-400' },
    declining:        { label: 'Declining',         arrow: '↓', color: 'text-red-400'     },
    stable:           { label: 'Stable',            arrow: '→', color: 'text-slate-400'   },
    insufficient_data:{ label: 'Not enough data',   arrow: '·', color: 'text-slate-600'   },
};

function TrendBadge({ trend }: { trend: ProductivityScore['trend'] }) {
    const meta = TREND_META[trend] ?? TREND_META.insufficient_data;
    return (
        <span className={`text-xs font-medium ${meta.color}`}>
            {meta.arrow} {meta.label}
        </span>
    );
}

// ─── Stat pill ────────────────────────────────────────────────────────────────

function StatPill({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex flex-col items-center gap-0.5 px-3 sm:px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 min-w-[72px] sm:min-w-[90px] flex-1 sm:flex-none">
            <span className="text-base font-bold text-white tabular-nums">{value}</span>
            <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
        </div>
    );
}

// ─── Work Summary Strip ───────────────────────────────────────────────────────

interface WorkSummaryProps {
    tasks: Task[];
}

function WorkSummary({ tasks }: WorkSummaryProps) {
    const active   = tasks.filter(t => t.status !== 'completed');
    const overdue  = active.filter(t => t.dueDate && new Date(t.dueDate) < new Date());
    const upcoming = active
        .filter(t => t.dueDate)
        .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())[0];

    return (
        <div className="flex flex-wrap gap-2 sm:gap-3 items-stretch">
            <StatPill label="Active" value={String(active.length)} />
            <StatPill label="Overdue" value={String(overdue.length)} />
            <div className="flex flex-col gap-0.5 px-3 sm:px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 flex-1 sm:flex-none">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">Next due</span>
                <span className={`text-sm font-semibold tabular-nums ${upcoming ? dueDateColor(upcoming.dueDate) : 'text-slate-600'}`}>
                    {upcoming ? fmtDate(upcoming.dueDate) : 'None'}
                </span>
            </div>
        </div>
    );
}

// ─── Task Row ─────────────────────────────────────────────────────────────────

interface TaskRowProps {
    task: Task;
    onClick: (id: string) => void;
}

function TaskRow({ task, onClick }: TaskRowProps) {
    return (
        <button
            type="button"
            onClick={() => onClick(task.id)}
            className="
                w-full flex items-center gap-3 px-4 py-3
                rounded-xl border border-slate-800 bg-slate-900
                hover:border-slate-700 hover:bg-slate-800
                transition-colors duration-150 text-left
                focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
            "
        >
            {/* Priority dot */}
            <span
                className={`flex-shrink-0 w-2 h-2 rounded-full ${PRIORITY_DOT[task.priority] ?? PRIORITY_DOT.medium}`}
                aria-label={`Priority: ${task.priority}`}
            />

            {/* Title */}
            <span className="flex-1 min-w-0 text-sm font-medium text-slate-200 truncate">
                {task.title}
            </span>

            {/* Status */}
            <span className="flex-shrink-0 text-xs text-slate-500 hidden sm:block">
                {STATUS_LABEL[task.status]}
            </span>

            {/* Blockchain verification badge — visible on completed tasks */}
            {task.status === 'completed' && (
                task.txHash ? (
                    <a
                        href={`https://amoy.polygonscan.com/tx/${task.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="flex-shrink-0 hidden sm:flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                        aria-label="Blockchain verified — view on PolygonScan"
                        title={`Verified: ${task.txHash.slice(0, 10)}…`}
                    >
                        <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        Verified
                    </a>
                ) : (
                    <span className="flex-shrink-0 hidden sm:flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800 border border-slate-700 text-slate-500">
                        Not Verified
                    </span>
                )
            )}

            {/* Due date */}
            <span className={`flex-shrink-0 text-xs tabular-nums ${dueDateColor(task.dueDate)}`}>
                {fmtDate(task.dueDate)}
            </span>

            {/* Chevron */}
            <svg className="flex-shrink-0 w-4 h-4 text-slate-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
        </button>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MyHome() {
    const { user } = useAuth();
    const { account, logTaskCompletion } = useWeb3Context();

    // ── Task state ────────────────────────────────────────────────────────────
    const { tasks, loading: tasksLoading, error: tasksError, refetch: refetchTasks } = useTasks();

    // ── Drawer overlay ────────────────────────────────────────────────────────
    const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
    const [movingIds,    setMovingIds]    = useState<Set<string>>(new Set());

    const openTask  = useCallback((id: string) => setActiveTaskId(id), []);
    const closeTask = useCallback(() => setActiveTaskId(null), []);

    // Status transition — task completion also fires an optional on-chain log.
    // Web3 is fire-and-forget: failure never blocks or rolls back the DB update.
    const handleMove = useCallback(async (id: string, status: TaskStatus) => {
        setMovingIds(prev => new Set(prev).add(id));
        try {
            // ── 1. Update status in backend (always, no MetaMask required) ────
            const updated = await updateTaskStatus(id, status);
            toast.success('Status updated');

            // ── 2. Sync server response into local state immediately ──────────
            // This prevents the drawer from showing a stale "Move to →" button
            // after the transition, which would cause a 422 on a second click.
            // Also picks up server-stamped fields: completedAt, txHash.
            refetchTasks();
            // Keep the drawer open on the updated task — close only if the
            // server returned a different id (shouldn't happen, but be safe).
            if (updated.id !== id) closeTask();

            // ── 3. On-chain log — only when marking completed ─────────────────
            if (status === 'completed') {
                void (async () => {
                    if (!account) {
                        console.info('[web3] Wallet not connected — skipping on-chain log.');
                        return;
                    }

                    // Call WorkforceLogger.logTaskCompletion(taskId) via MetaMask
                    console.info('[web3] Requesting MetaMask tx for task:', id);
                    const txHash = await logTaskCompletion(id);

                    if (!txHash) {
                        // logTaskCompletion already console.warns on failure
                        toast.error('On-chain log skipped — check MetaMask or contract address.', { id: `web3-skip-${id}` });
                        return;
                    }

                    console.info('[web3] Tx confirmed, posting to server:', txHash);

                    // POST tx hash to our backend so the DB links task ↔ chain
                    try {
                        const res = await client.post<{ success: true; data: object }>('/web3/log', {
                            taskId: id,
                            txHash,
                            eventType: 'task_completed',
                        });
                        console.info('[web3] blockchain_log created:', res.data);
                        toast.success(`⛓ Verified on-chain\n${txHash.slice(0, 10)}…`, { duration: 5000, id: `web3-ok-${id}` });
                        // Refresh to show the green Verified badge
                        refetchTasks();
                    } catch (logErr: unknown) {
                        const msg = logErr instanceof Error ? logErr.message : String(logErr);
                        console.error('[web3] POST /web3/log failed:', logErr);
                        toast.error(`Tx confirmed but DB log failed: ${msg}`, { id: `web3-err-${id}` });
                    }
                })();
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to update status');
        } finally {
            setMovingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
        }
    }, [account, logTaskCompletion, closeTask, refetchTasks]);

    // ── Performance state ─────────────────────────────────────────────────────
    const [score,    setScore]    = useState<ProductivityScore | null>(null);
    const [skillGap, setSkillGap] = useState<SkillGap | null>(null);
    const [perfLoading, setPerfLoading] = useState(false);
    const [perfError,   setPerfError]   = useState<string | null>(null);

    // Only fetch once when employeeId is known
    // user.id  = User UUID (auth identity) — NOT what the AI routes expect
    // user.employeeId = Employee UUID — matches :employeeId in /api/ai/score/:employeeId
    const fetchedRef = useRef(false);
    useEffect(() => {
        if (!user?.employeeId || fetchedRef.current) return;
        fetchedRef.current = true;
        setPerfLoading(true);
        Promise.all([
            getEmployeeScore(user.employeeId),
            getSkillGap(user.employeeId),
        ])
            .then(([s, g]) => { setScore(s); setSkillGap(g); })
            .catch(e => setPerfError(e instanceof Error ? e.message : 'Failed to load performance data'))
            .finally(() => setPerfLoading(false));
    }, [user?.employeeId]);

    // ── Sorted task list ──────────────────────────────────────────────────────
    const sortedTasks = useMemo(() => {
        // Active first, then by due date ascending, completed at bottom
        return [...tasks].sort((a, b) => {
            if (a.status === 'completed' && b.status !== 'completed') return 1;
            if (a.status !== 'completed' && b.status === 'completed') return -1;
            if (!a.dueDate && !b.dueDate) return 0;
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        });
    }, [tasks]);

    // ── Active task for drawer ────────────────────────────────────────────────
    const activeTask = activeTaskId ? tasks.find(t => t.id === activeTaskId) : undefined;

    // ── Perf breakdown shorthands ─────────────────────────────────────────────
    const bd = score?.breakdown;

    return (
        <div className="px-4 sm:px-6 py-5 sm:py-8 max-w-3xl mx-auto space-y-8 sm:space-y-10 pb-10">

            {/* ── Header ─────────────────────────────────────────────────────── */}
            <header>
                <h1 className="text-xl sm:text-2xl font-semibold text-white tracking-tight">
                    My Home
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                    Welcome back, {user?.name ?? user?.email}
                </p>
            </header>

            {/* ══════════════════════════════════════════════════════════════════
                SECTION 1 — MY WORK
            ══════════════════════════════════════════════════════════════════ */}
            <section aria-labelledby="my-work-heading">
                <h2 id="my-work-heading" className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">
                    My Work
                </h2>

                {/* Work summary strip */}
                {tasksLoading ? (
                    <div className="flex gap-3">
                        {[1,2,3].map(i => (
                            <div key={i} className="h-16 w-24 rounded-xl bg-slate-800 animate-pulse" />
                        ))}
                    </div>
                ) : (
                    <WorkSummary tasks={tasks} />
                )}

                {/* Task list */}
                <div className="mt-5 space-y-2">
                    {tasksLoading && (
                        <div className="space-y-2">
                            {[1,2,3,4].map(i => (
                                <div key={i} className="h-12 rounded-xl bg-slate-800 animate-pulse" />
                            ))}
                        </div>
                    )}

                    {!tasksLoading && tasksError && (
                        <p className="text-sm text-red-400 px-1">{tasksError}</p>
                    )}

                    {!tasksLoading && !tasksError && sortedTasks.length === 0 && (
                        <p className="text-sm text-slate-600 px-1">No tasks assigned yet.</p>
                    )}

                    {!tasksLoading && !tasksError && sortedTasks.map(task => (
                        <TaskRow key={task.id} task={task} onClick={openTask} />
                    ))}
                </div>
            </section>

            {/* ══════════════════════════════════════════════════════════════════
                SECTION 2 — MY PERFORMANCE
            ══════════════════════════════════════════════════════════════════ */}
            <section aria-labelledby="my-perf-heading">
                <h2 id="my-perf-heading" className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">
                    My Performance
                </h2>

                {perfLoading && (
                    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 animate-pulse h-48" />
                )}

                {!perfLoading && !user?.employeeId && (
                    <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5 text-sm text-slate-500">
                        Your account is not linked to an employee profile yet. Contact your admin.
                    </div>
                )}

                {!perfLoading && !!user?.employeeId && perfError && (
                    <p className="text-sm text-red-400 px-1">{perfError}</p>
                )}

                {!perfLoading && !!user?.employeeId && !perfError && (

                    <div className="space-y-4">

                        {/* ── Performance Card ──────────────────────────────── */}
                        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                            <div className="flex items-center gap-6 flex-wrap">

                                {/* Score Ring */}
                                <ScoreRing score={score?.score ?? null} />

                                {/* Stats */}
                                <div className="flex-1 min-w-0 space-y-3">
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <span className="text-sm font-semibold text-slate-300">
                                            {score?.grade ? `Grade ${score.grade}` : 'No grade yet'}
                                        </span>
                                        {score && <TrendBadge trend={score.trend} />}
                                    </div>

                                    {bd ? (
                                        <div className="flex flex-wrap gap-2">
                                            <StatPill
                                                label="Completion"
                                                value={`${Math.round(bd.completionRate * 100)}%`}
                                            />
                                            <StatPill
                                                label="On-time"
                                                value={`${Math.round(bd.onTimeRate * 100)}%`}
                                            />
                                            <StatPill
                                                label="Avg complexity"
                                                value={bd.avgComplexity > 0 ? bd.avgComplexity.toFixed(1) : '—'}
                                            />
                                        </div>
                                    ) : (
                                        <p className="text-xs text-slate-600">
                                            Complete some tasks to see your breakdown.
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* ── Skill Gap Panel ───────────────────────────────── */}
                        {skillGap && (
                            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                                    Skill Gap
                                </p>
                                <p className="text-xs text-slate-600 mb-3">
                                    Skills to improve for upcoming tasks
                                </p>

                                {skillGap.gapSkills.length === 0 ? (
                                    <p className="text-xs text-emerald-400">
                                        ✓ You have all the skills required for your current tasks.
                                    </p>
                                ) : (
                                    <div className="flex flex-wrap gap-2">
                                        {skillGap.gapSkills.map(skill => (
                                            <span
                                                key={skill}
                                                className="px-2.5 py-1 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs font-medium text-amber-300"
                                            >
                                                {skill}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {skillGap.gapSkills.length > 0 && (
                                    <p className="mt-3 text-[10px] text-slate-600">
                                        Coverage: {Math.round(skillGap.coverageRate * 100)}% of required skills covered
                                    </p>
                                )}
                            </div>
                        )}

                    </div>
                )}
            </section>

            {/* ── Task Detail Drawer ──────────────────────────────────────────── */}
            {activeTask && (
                <TaskDetailDrawer
                    task={activeTask}
                    assignee={undefined}      /* employees don't need to see assignee info */
                    onClose={closeTask}
                    onMove={handleMove}
                    moving={movingIds.has(activeTask.id)}
                />
            )}
        </div>
    );
}
