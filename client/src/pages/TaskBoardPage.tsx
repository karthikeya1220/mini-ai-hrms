// pages/TaskBoardPage.tsx — Kanban task board
//
// Layout:
//  ── Sticky header: breadcrumb + filter bar + "New task" button + ConnectWalletButton
//  ── Three Kanban columns: Assigned | In Progress | Completed
//  ── Each column accepts HTML5 DnD drops (forward-FSM-only)
//  ── Each card also has a status dropdown for keyboard/touch users
//  ── "New task" opens TaskModal slide-in drawer
//  ── Employees are fetched to resolve assignee names and populate the
//     "assign to" dropdown in the modal
//
// Web3 integration (optional — app works identically without MetaMask)
// ─────────────────────────────────────────────────────────────────────
//  When a task moves to "completed":
//    1. Backend PUT /api/tasks/:id/status (always called, no MetaMask required)
//    2. WorkforceLogger.logTaskCompletion(taskId) via MetaMask (if connected)
//    3. POST /api/web3/log { taskId, txHash, eventType } (if step 2 succeeded)
//  Steps 2–3 are fire-and-forget: failure does NOT block task completion.

import { useState, useCallback, useDeferredValue } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { useWeb3Context } from '../context/Web3Context';
import { useTasks } from '../hooks/useTasks';
import { useEmployees } from '../hooks/useEmployees';
import { postWeb3Log } from '../api/web3';
import type { TaskStatus, TaskPriority } from '../api/tasks';
import { NEXT_STATUS } from '../api/tasks';
import { KanbanColumn } from '../components/tasks/KanbanColumn';
import { TaskCard } from '../components/tasks/TaskCard';
import { TaskModal } from '../components/tasks/TaskModal';
import { ConnectWalletButton } from '../components/ui/ConnectWalletButton';

// ─── Priority filter pill ─────────────────────────────────────────────────────

type PriorityFilter = 'all' | TaskPriority;

function PriorityPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${active
                ? 'bg-brand-500/20 border border-brand-500/40 text-brand-300'
                : 'border border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-300'
                }`}
        >
            {label}
        </button>
    );
}

// ─── Skeleton board ───────────────────────────────────────────────────────────

function SkeletonCard() {
    return (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3.5 space-y-2 animate-pulse">
            <div className="flex gap-2">
                <div className="w-2 h-2 rounded-full bg-slate-800 mt-1" />
                <div className="flex-1 space-y-1.5">
                    <div className="h-3 rounded-full bg-slate-800 w-3/4" />
                    <div className="h-3 rounded-full bg-slate-800 w-1/2" />
                </div>
            </div>
            <div className="flex gap-1 pl-4">
                <div className="h-4 w-12 rounded bg-slate-800" />
                <div className="h-4 w-10 rounded bg-slate-800" />
            </div>
            <div className="flex justify-between pl-4">
                <div className="h-3 w-20 rounded-full bg-slate-800" />
                <div className="h-4 w-16 rounded bg-slate-800" />
            </div>
        </div>
    );
}

// ─── Board ────────────────────────────────────────────────────────────────────

const COLUMNS: TaskStatus[] = ['assigned', 'in_progress', 'completed'];

export default function TaskBoardPage() {
    const { accessToken } = useAuth();
    const { logTaskCompletion, account } = useWeb3Context();

    // ── Task data ──────────────────────────────────────────────────────────────
    const { tasks, total, loading, error, refetch, addTask, moveTask } =
        useTasks(accessToken, { limit: 100 });

    // ── Employees (for assignee names + modal dropdown) ────────────────────────
    const { employees } = useEmployees(accessToken, { isActive: 'true', limit: 100 });

    const employeeMap = new Map(employees.map(e => [e.id, e]));

    // ── UI state ──────────────────────────────────────────────────────────────
    const [showModal, setShowModal] = useState(false);
    const [search, setSearch] = useState('');
    const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');

    const deferredSearch = useDeferredValue(search);

    // ── Moving tasks (track in-flight moves to show spinner overlay) ───────────
    const [movingIds, setMovingIds] = useState<Set<string>>(new Set());

    // ── Drag state ─────────────────────────────────────────────────────────────
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null);

    // ── Filter tasks client-side ───────────────────────────────────────────────
    const filteredTasks = tasks.filter(t => {
        if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
        if (deferredSearch) {
            const q = deferredSearch.toLowerCase();
            const assigneeName = t.assignedTo ? employeeMap.get(t.assignedTo)?.name?.toLowerCase() : '';
            return (
                t.title.toLowerCase().includes(q) ||
                (t.description?.toLowerCase().includes(q)) ||
                t.requiredSkills.some(s => s.toLowerCase().includes(q)) ||
                (assigneeName?.includes(q))
            );
        }
        return true;
    });

    const tasksByStatus = (status: TaskStatus) => filteredTasks.filter(t => t.status === status);

    // ── Handle move (both DnD and dropdown) ───────────────────────────────────
    const handleMove = useCallback(async (id: string, newStatus: TaskStatus) => {
        const task = tasks.find(t => t.id === id);
        if (!task) return;

        // FSM guard on client: only forward
        if (NEXT_STATUS[task.status] !== newStatus) return;

        setMovingIds(s => new Set(s).add(id));
        try {
            // ─── 1. Update status in backend (always, no MetaMask required) ──────
            await moveTask(id, newStatus);

            // ─── 2 & 3. On-chain log (only when moving to "completed") ────────────
            if (newStatus === 'completed') {
                // Fire-and-forget — do NOT await in the critical path
                void (async () => {
                    if (!account) {
                        // Wallet not connected — silently skip on-chain log
                        return;
                    }

                    // 2. Call WorkforceLogger.logTaskCompletion() via MetaMask
                    const txHash = await logTaskCompletion(id);

                    if (!txHash) {
                        // User rejected or contract unavailable — silent skip
                        return;
                    }

                    // 3. Record the tx_hash in our backend off-chain DB
                    const logged = await postWeb3Log(accessToken ?? '', {
                        taskId:    id,
                        txHash,
                        eventType: 'task_completed',
                    });

                    if (logged) {
                        toast.success(
                            `⛓ On-chain log recorded\n${txHash.slice(0, 10)}…`,
                            { duration: 5000, id: `web3-${id}` },
                        );
                    }
                })();
            }
        } finally {
            setMovingIds(s => { const n = new Set(s); n.delete(id); return n; });
        }
    }, [tasks, moveTask, logTaskCompletion, account, accessToken]);

    // ── DnD handlers ──────────────────────────────────────────────────────────
    function handleDragOver(e: React.DragEvent, targetStatus: TaskStatus) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        // Only allow drop if it's a valid forward transition
        const task = tasks.find(t => t.id === draggingId);
        if (!task || NEXT_STATUS[task.status] !== targetStatus) {
            e.dataTransfer.dropEffect = 'none';
            return;
        }
        setDropTarget(targetStatus);
    }

    function handleDrop(e: React.DragEvent, targetStatus: TaskStatus) {
        e.preventDefault();
        setDropTarget(null);
        const id = draggingId;
        setDraggingId(null);
        if (id) handleMove(id, targetStatus);
    }

    const PRIORITY_FILTERS: { val: PriorityFilter; label: string }[] = [
        { val: 'all',    label: 'All' },
        { val: 'high',   label: '🔴 High' },
        { val: 'medium', label: '🟡 Medium' },
        { val: 'low',    label: '⚪ Low' },
    ];

    return (
        <div className="min-h-dvh bg-slate-950 text-slate-100 flex flex-col">
            {/* ── Sticky header ─────────────────────────────────────────────────── */}
            <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
                <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
                    {/* Breadcrumb */}
                    <nav className="flex items-center gap-1 text-sm">
                        <a href="/dashboard" className="text-slate-500 hover:text-slate-300 transition-colors px-2 py-1 rounded-lg hover:bg-slate-800 font-medium">
                            Dashboard
                        </a>
                        <span className="text-slate-700">/</span>
                        <span className="text-slate-200 font-semibold px-2">Tasks</span>
                    </nav>

                    {/* Right controls */}
                    <div className="flex items-center gap-2">
                        {/* Search */}
                        <div className="relative hidden sm:block">
                            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                            <input
                                id="task-search"
                                type="search"
                                placeholder="Search tasks…"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900/70 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-brand-500 w-44 transition-all"
                            />
                        </div>

                        {/* Refresh */}
                        <button
                            onClick={refetch}
                            disabled={loading}
                            className="p-2 rounded-lg border border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700 transition-all disabled:opacity-40"
                            title="Refresh"
                        >
                            <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                            </svg>
                        </button>

                        {/* ── Connect Wallet button ───────────────────────────────
                             Completely optional — non-connected state still allows
                             full use of the task board. Only appears when Web3
                             logging is possible (MetaMask installed = visible).   */}
                        <ConnectWalletButton compact />

                        <button
                            id="btn-new-task"
                            onClick={() => setShowModal(true)}
                            className="btn-primary text-sm gap-1.5"
                        >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                            New task
                        </button>
                    </div>
                </div>

                {/* Sub-header: title + priority filters */}
                <div className="border-t border-slate-900 max-w-[1400px] mx-auto px-4 sm:px-6 py-2 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <h1 className="text-sm font-bold text-white">Task Board</h1>
                        <span className="text-xs text-slate-600">
                            {filteredTasks.length} of {total} task{total !== 1 ? 's' : ''}
                        </span>
                        {/* On-chain indicator — only shown when wallet connected */}
                        {account && (
                            <span className="flex items-center gap-1 text-[10px] text-violet-400/70 border border-violet-500/20 bg-violet-500/5 rounded-full px-2 py-0.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                                On-chain logging active
                            </span>
                        )}
                    </div>
                    <div className="flex gap-1.5">
                        {PRIORITY_FILTERS.map(f => (
                            <PriorityPill
                                key={f.val}
                                label={f.label}
                                active={priorityFilter === f.val}
                                onClick={() => setPriorityFilter(f.val)}
                            />
                        ))}
                    </div>
                </div>
            </header>

            {/* ── Error ─────────────────────────────────────────────────────────── */}
            {error && (
                <div className="max-w-[1400px] mx-auto w-full px-4 sm:px-6 pt-4">
                    <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300 flex justify-between">
                        <span>{error}</span>
                        <button onClick={refetch} className="text-xs text-red-400 hover:text-red-200 underline">Retry</button>
                    </div>
                </div>
            )}

            {/* ── Kanban board ──────────────────────────────────────────────────── */}
            <main className="flex-1 max-w-[1400px] mx-auto w-full px-4 sm:px-6 py-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start h-full">
                    {COLUMNS.map(status => {
                        const columnTasks = tasksByStatus(status);
                        return (
                            <KanbanColumn
                                key={status}
                                status={status}
                                count={columnTasks.length}
                                isDropTarget={dropTarget === status}
                                onDragOver={e => handleDragOver(e, status)}
                                onDrop={(e) => handleDrop(e, status)}
                                onDragLeave={() => setDropTarget(null)}
                            >
                                {loading ? (
                                    [0, 1, 2].map(i => <SkeletonCard key={i} />)
                                ) : (
                                    columnTasks.map(task => (
                                        <TaskCard
                                            key={task.id}
                                            task={task}
                                            assigneeName={task.assignedTo ? employeeMap.get(task.assignedTo)?.name : undefined}
                                            onMove={handleMove}
                                            moving={movingIds.has(task.id)}
                                            onDragStart={id => setDraggingId(id)}
                                            onDragEnd={() => { setDraggingId(null); setDropTarget(null); }}
                                        />
                                    ))
                                )}
                            </KanbanColumn>
                        );
                    })}
                </div>
            </main>

            {/* ── Task modal ────────────────────────────────────────────────────── */}
            {showModal && (
                <TaskModal
                    onSave={async data => { await addTask(data); }}
                    onClose={() => setShowModal(false)}
                    employees={employees}
                />
            )}
        </div>
    );
}
