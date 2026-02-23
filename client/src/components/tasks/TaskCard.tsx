// components/tasks/TaskCard.tsx
// Minimal Kanban card — shows ONLY the four summary fields:
//   priority dot · title · assignee avatar · due date
//
// Clicking the card fires onOpen() → TaskDetailDrawer handles all detail.
// Drag-and-drop still moves status directly (FSM-guarded).
// The status dropdown remains for keyboard/touch users.

import { useRef } from 'react';
import type { Task, TaskStatus } from '../../api/tasks';
import { NEXT_STATUS } from '../../api/tasks';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PRIORITY_META: Record<string, { dot: string; label: string }> = {
    low:    { dot: 'bg-slate-500',  label: 'Low'    },
    medium: { dot: 'bg-amber-500',  label: 'Medium' },
    high:   { dot: 'bg-red-500',    label: 'High'   },
};

function dueDateStyle(iso: string | null): string {
    if (!iso) return 'text-slate-600';
    const diff = new Date(iso).getTime() - Date.now();
    if (diff < 0)              return 'text-red-400';
    if (diff < 86_400_000 * 2) return 'text-amber-400';
    return 'text-slate-500';
}

function dueDateLabel(iso: string | null): string {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Assignee initials avatar */
function MiniAvatar({ name }: { name?: string }) {
    if (!name) return null;
    const initials = name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
    const hue = (name.charCodeAt(0) * 37) % 360;
    return (
        <span
            className="inline-flex w-5 h-5 rounded-full items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
            style={{ background: `hsl(${hue},55%,32%)` }}
            title={name}
            aria-label={name}
        >
            {initials}
        </span>
    );
}

// ─── Minimal status dropdown (keyboard / touch fallback) ──────────────────────

const STATUS_LABELS: Record<TaskStatus, string> = {
    assigned:    'Assigned',
    in_progress: 'In Progress',
    completed:   'Completed',
};

const ALL_STATUSES: TaskStatus[] = ['assigned', 'in_progress', 'completed'];

interface StatusDropdownProps {
    current: TaskStatus;
    taskId: string;
    onMove: (id: string, status: TaskStatus) => void;
    disabled: boolean;
}

function StatusDropdown({ current, taskId, onMove, disabled }: StatusDropdownProps) {
    const allowedStatuses = ALL_STATUSES.filter(s => {
        if (s === current) return true;
        return NEXT_STATUS[current] === s;
    });

    return (
        <select
            value={current}
            disabled={disabled || current === 'completed'}
            onChange={e => onMove(taskId, e.target.value as TaskStatus)}
            onClick={e => e.stopPropagation()}
            className="
                appearance-none text-[10px] font-medium px-2 py-0.5 pr-5 rounded-md
                border border-slate-700 bg-slate-800 text-slate-300
                focus:outline-none focus:border-indigo-500
                disabled:opacity-40 disabled:cursor-not-allowed
                cursor-pointer transition-colors hover:border-slate-600
                bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIiIGhlaWdodD0iOCIgdmlld0JveD0iMCAwIDEyIDgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTEgMUw2IDYgMTEgMSIgc3Ryb2tlPSIjNjQ3NDhiIiBzdHJva2Utd2lkdGg9IjEuNSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+PC9zdmc+')]
                bg-no-repeat bg-[right_4px_center]
            "
            aria-label="Change task status"
        >
            {allowedStatuses.map(s => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
        </select>
    );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export interface TaskCardProps {
    task: Task;
    assigneeName?: string;
    onMove: (id: string, status: TaskStatus) => void;
    moving: boolean;
    onDragStart: (id: string) => void;
    onDragEnd: () => void;
    onOpen: (id: string) => void;   // ← opens TaskDetailDrawer
}

export function TaskCard({
    task, assigneeName, onMove, moving, onDragStart, onDragEnd, onOpen,
}: TaskCardProps) {
    const cardRef = useRef<HTMLDivElement>(null);
    const p = PRIORITY_META[task.priority] ?? PRIORITY_META.medium;

    return (
        <div
            ref={cardRef}
            id={`task-card-${task.id}`}
            draggable={task.status !== 'completed'}
            onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart(task.id); }}
            onDragEnd={onDragEnd}
            onClick={() => onOpen(task.id)}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(task.id); } }}
            aria-label={`Open task: ${task.title}`}
            className={`
                relative rounded-xl border bg-slate-900 p-3 space-y-2
                select-none cursor-pointer
                transition-colors duration-150
                focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
                ${moving
                    ? 'opacity-50 border-indigo-500/50 scale-95'
                    : 'border-slate-800 hover:border-slate-700'
                }
                ${task.status === 'completed' ? 'opacity-60' : ''}
            `}
        >
            {/* ── Row 1: priority dot + title ── */}
            <div className="flex items-start gap-2">
                <span
                    className={`mt-1 flex-shrink-0 w-2 h-2 rounded-full ${p.dot}`}
                    title={p.label}
                    aria-label={`Priority: ${p.label}`}
                />
                <p className={`text-sm font-medium leading-snug flex-1 min-w-0 ${
                    task.status === 'completed' ? 'line-through text-slate-500' : 'text-slate-100'
                }`}>
                    {task.title}
                </p>
            </div>

            {/* ── Row 2: assignee avatar · due date · status dropdown ── */}
            <div className="flex items-center justify-between gap-2 pl-4">
                {/* Left: assignee */}
                <MiniAvatar name={assigneeName} />

                {/* Right: verification badge · due date · dropdown */}
                <div className="flex items-center gap-2 ml-auto">
                    {/* Blockchain verification — show on completed tasks */}
                    {task.status === 'completed' && (
                        task.txHash ? (
                            <a
                                href={`https://amoy.polygonscan.com/tx/${task.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                                aria-label="Blockchain verified — view on PolygonScan"
                                title={`Verified: ${task.txHash.slice(0, 10)}…`}
                            >
                                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                                Verified
                            </a>
                        ) : (
                            <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-slate-800 border border-slate-700 text-slate-500"
                                title="No on-chain record for this task"
                            >
                                Not Verified
                            </span>
                        )
                    )}

                    {task.dueDate && (
                        <span className={`text-[10px] font-medium tabular-nums ${dueDateStyle(task.dueDate)}`}>
                            {dueDateLabel(task.dueDate)}
                        </span>
                    )}
                    <StatusDropdown
                        current={task.status}
                        taskId={task.id}
                        onMove={onMove}
                        disabled={moving}
                    />
                </div>
            </div>

            {/* Moving overlay */}
            {moving && (
                <div className="absolute inset-0 rounded-xl flex items-center justify-center bg-slate-900/60" aria-hidden="true">
                    <div className="w-4 h-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                </div>
            )}
        </div>
    );
}

