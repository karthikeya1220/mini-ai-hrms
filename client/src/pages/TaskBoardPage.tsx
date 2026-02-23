// pages/TaskBoardPage.tsx — Kanban task board
//
// Layout:
//  ── Sticky header: breadcrumb + filter bar + "New task" button + ConnectWalletButton
//  ── Three Kanban columns: Assigned | In Progress | Completed
//  ── Each column accepts HTML5 DnD drops (forward-FSM-only)
//  ── Clicking a card opens TaskDetailDrawer (single-overlay rule enforced)
//  ── "New task" button opens TaskModal (create-only drawer)
//
// Overlay state machine (single active drawer at a time):
//   activeDrawer: 'task' | 'new' | null
//   activeTaskId: string | null
//
// Rules:
//   • Opening TaskDetailDrawer closes TaskModal and vice versa.
//   • AI panel lives inside TaskDetailDrawer — never stacked on top.
//   • DnD moves status without opening a drawer.

import { useState, useCallback, useDeferredValue } from 'react';
// import toast from 'react-hot-toast'; // Web3 disabled (was used for on-chain toasts)
import { useAuth } from '../context/AuthContext';
// import { useWeb3Context } from '../context/Web3Context'; // Web3 disabled
import { useTasks } from '../hooks/useTasks';
import { useEmployees } from '../hooks/useEmployees';
// import { client } from '../api/client'; // Web3 disabled (was used for /web3/log POST)
import type { TaskStatus, TaskPriority } from '../api/tasks';
import { NEXT_STATUS } from '../api/tasks';
import { KanbanColumn } from '../components/tasks/KanbanColumn';
import { TaskCard } from '../components/tasks/TaskCard';
import { TaskModal } from '../components/tasks/TaskModal';
import { TaskDetailDrawer } from '../components/tasks/TaskDetailDrawer';
// import { ConnectWalletButton } from '../components/ui/ConnectWalletButton'; // Web3 disabled

// ─── Priority filter pill ─────────────────────────────────────────────────────

type PriorityFilter = 'all' | TaskPriority;

function PriorityPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${active
                ? 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-300'
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

const COLUMNS: TaskStatus[] = ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED'];

export default function TaskBoardPage() {
    const { isAdmin } = useAuth();
    // const { logTaskCompletion, account } = useWeb3Context(); // Web3 disabled

    // ── Task data ──────────────────────────────────────────────────────────────
    // Server automatically scopes GET /api/tasks to the authenticated employee's
    // own tasks when role === EMPLOYEE (assignedTo forced to req.user.employeeId).
    // No client-side branching needed.
    const { tasks, total, loading, error, refetch, addTask, moveTask } =
        useTasks({ limit: 100 });

    // ── Employees (for assignee names + modal dropdown) ────────────────────────
    const { employees } = useEmployees({ isActive: 'true', limit: 100 });

    const employeeMap = new Map(employees.map(e => [e.id, e]));

    // ── UI state ──────────────────────────────────────────────────────────────
    // Single-overlay rule: only one drawer can be open at a time.
    // 'new'  → TaskModal (create a task)
    // 'task' → TaskDetailDrawer (view/act on a task)
    // null   → nothing open
    type ActiveDrawer = 'new' | 'task' | null;
    const [activeDrawer, setActiveDrawer] = useState<ActiveDrawer>(null);
    const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

    const openNewTask = useCallback(() => {
        setActiveTaskId(null);
        setActiveDrawer('new');
    }, []);

    const openTask = useCallback((id: string) => {
        setActiveTaskId(id);
        setActiveDrawer('task');
    }, []);

    const closeDrawer = useCallback(() => {
        setActiveDrawer(null);
        setActiveTaskId(null);
    }, []);

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

            // ─── 2 & 3. On-chain log (commented out — Web3 integration disabled) ──────────
            /* if (newStatus === 'completed') {
                void (async () => {
                    if (!account) {
                        console.info('[web3] Wallet not connected — skipping on-chain log.');
                        return;
                    }

                    // 2. Call WorkforceLogger.logTaskCompletion() via MetaMask
                    console.info('[web3] Requesting MetaMask tx for task:', id);
                    const txHash = await logTaskCompletion(id);

                    if (!txHash) {
                        toast.error('On-chain log skipped — check MetaMask or contract address.', { id: `web3-skip-${id}` });
                        return;
                    }

                    // 3. Record the tx_hash in our backend off-chain DB
                    try {
                        await client.post('/web3/log', { taskId: id, txHash, eventType: 'task_completed' });
                        toast.success(
                            `⛓ Verified on-chain\n${txHash.slice(0, 10)}…`,
                            { duration: 5000, id: `web3-ok-${id}` },
                        );
                    } catch (logErr: unknown) {
                        const msg = logErr instanceof Error ? logErr.message : String(logErr);
                        console.error('[web3] POST /web3/log failed:', logErr);
                        toast.error(`Tx confirmed but DB log failed: ${msg}`, { id: `web3-err-${id}` });
                    }
                })();
            } */
        } finally {
            setMovingIds(s => { const n = new Set(s); n.delete(id); return n; });
        }
    }, [tasks, moveTask]);

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
        { val: 'all', label: 'All' },
        { val: 'high', label: '🔴 High' },
        { val: 'medium', label: '🟡 Medium' },
        { val: 'low', label: '⚪ Low' },
    ];

    return (
        <div className="min-h-dvh bg-slate-950 text-slate-100 flex flex-col">
            {/* ── Page Header ───────────────────────────────────────────────────────── */}
            <header className="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md">
                <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
                    <h1 className="text-base sm:text-xl font-semibold text-white flex-shrink-0">Task Board</h1>
                    <div className="flex items-center gap-2">
                        {/* Search — hidden on xs, shown sm+ */}
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
                                className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900/70 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 w-36 md:w-44 transition-all"
                            />
                        </div>

                        {/* Refresh */}
                        <button
                            id="btn-tasks-refresh"
                            onClick={refetch}
                            disabled={loading}
                            className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200 transition-all disabled:opacity-40"
                            title="Refresh board"
                        >
                            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
                        </button>

                        {/* <ConnectWalletButton /> */}{/* Web3 disabled */}

                        {isAdmin && (
                            <button
                                id="btn-new-task"
                                onClick={openNewTask}
                                className="btn-primary text-xs gap-1.5 py-1.5"
                            >
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                                <span className="hidden xs:inline">New task</span>
                                <span className="xs:hidden">New</span>
                            </button>
                        )}
                    </div>
                </div>
            </header>

            {/* Sub-header: board title + on-chain indicator + priority filters */}
            <div className="border-b border-slate-900 bg-slate-950/90 backdrop-blur-md sticky top-14 z-10">
                <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-2 flex items-center justify-between gap-4 overflow-x-auto scrollbar-none">
                    <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-xs text-slate-600 whitespace-nowrap">
                            {filteredTasks.length} of {total} task{total !== 1 ? 's' : ''}
                        </span>
                        {/* {account && (
                            <span className="flex items-center gap-1 text-[10px] text-violet-400/70 border border-violet-500/20 bg-violet-500/5 rounded-full px-2 py-0.5 whitespace-nowrap">
                                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                                On-chain active
                            </span>
                        )} */}{/* Web3 disabled */}
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
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
            </div>

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
            <main className="flex-1 max-w-[1400px] mx-auto w-full px-4 sm:px-6 py-5 pb-10 overflow-x-auto">
                {/* On mobile: horizontal scroll with min-width cards; on md+: 3-col grid */}
                <div className="flex gap-4 md:grid md:grid-cols-3 md:gap-4 items-start min-w-[640px] md:min-w-0 h-full">
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
                                            onOpen={openTask}
                                        />
                                    ))
                                )}
                            </KanbanColumn>
                        );
                    })}
                </div>
            </main>

            {/* ── Task create modal ─────────────────────────────────────────── */}
            {activeDrawer === 'new' && (
                <TaskModal
                    onSave={async data => { await addTask(data); }}
                    onClose={closeDrawer}
                    employees={employees}
                />
            )}

            {/* ── Task detail drawer (single overlay rule) ──────────────────── */}
            {activeDrawer === 'task' && activeTaskId && (() => {
                const task = tasks.find(t => t.id === activeTaskId);
                if (!task) return null;
                return (
                    <TaskDetailDrawer
                        task={task}
                        assignee={task.assignedTo ? employeeMap.get(task.assignedTo) : undefined}
                        onClose={closeDrawer}
                        onMove={handleMove}
                        moving={movingIds.has(task.id)}
                    />
                );
            })()}
        </div>
    );
}
