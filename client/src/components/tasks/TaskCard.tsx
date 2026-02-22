// components/tasks/TaskCard.tsx
// Draggable Kanban card — drag-and-drop via HTML5 DnD API (no library).
// Also has a dropdown status control for keyboard/touch users.

import { useRef } from 'react';
import type { Task, TaskStatus } from '../../api/tasks';
import { NEXT_STATUS } from '../../api/tasks';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PRIORITY_META: Record<string, { dot: string; label: string }> = {
    low: { dot: 'bg-slate-500', label: 'Low' },
    medium: { dot: 'bg-amber-500', label: 'Medium' },
    high: { dot: 'bg-red-500', label: 'High' },
};

function dueDateStyle(iso: string | null): string {
    if (!iso) return 'text-slate-600';
    const diff = new Date(iso).getTime() - Date.now();
    if (diff < 0) return 'text-red-400';        // overdue
    if (diff < 86_400_000 * 2) return 'text-amber-400';      // due in < 2 days
    return 'text-slate-500';
}

function dueDateLabel(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function complexityDots(score: number) {
    return Array.from({ length: 5 }, (_, i) => (
        <span
            key={i}
            className={`inline-block w-1.5 h-1.5 rounded-full ${i < score ? 'bg-brand-400' : 'bg-slate-800'}`}
        />
    ));
}

// Avatar from first two initials of assigned employee name (passed as prop)
function MiniAvatar({ name }: { name?: string }) {
    if (!name) return null;
    const initials = name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
    const hue = (name.charCodeAt(0) * 37) % 360;
    return (
        <span
            className="inline-flex w-5 h-5 rounded-full items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
            style={{ background: `hsl(${hue},55%,32%)` }}
            title={name}
        >
            {initials}
        </span>
    );
}

// ─── Status dropdown ──────────────────────────────────────────────────────────

const STATUS_LABELS: Record<TaskStatus, string> = {
    assigned: 'Assigned',
    in_progress: 'In Progress',
    completed: 'Completed',
};

const ALL_STATUSES: TaskStatus[] = ['assigned', 'in_progress', 'completed'];

interface StatusDropdownProps {
    current: TaskStatus;
    taskId: string;
    onMove: (id: string, status: TaskStatus) => void;
    disabled: boolean;
}

function StatusDropdown({ current, taskId, onMove, disabled }: StatusDropdownProps) {
    // Only allow forward-only moves (FSM rule)
    const allowedStatuses = ALL_STATUSES.filter(s => {
        if (s === current) return true;
        const next = NEXT_STATUS[current];
        return next === s;
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
        focus:outline-none focus:border-brand-500
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
    moving: boolean;                // true while PUT is in-flight
    onDragStart: (id: string) => void;
    onDragEnd: () => void;
}

export function TaskCard({
    task, assigneeName, onMove, moving, onDragStart, onDragEnd,
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
            className={`
        group relative rounded-xl border bg-slate-900 p-3.5 space-y-2.5
        select-none cursor-grab active:cursor-grabbing
        transition-all duration-200
        ${moving
                    ? 'opacity-50 border-brand-500/50 scale-95'
                    : 'border-slate-800 hover:border-slate-700 hover:shadow-lg hover:shadow-black/30'
                }
        ${task.status === 'completed' ? 'cursor-default opacity-70' : ''}
      `}
        >
            {/* Priority dot + title row */}
            <div className="flex items-start gap-2">
                <span className={`mt-1.5 flex-shrink-0 w-2 h-2 rounded-full ${p.dot}`} title={p.label} />
                <p className={`text-sm font-medium leading-snug flex-1 ${task.status === 'completed' ? 'line-through text-slate-500' : 'text-slate-100'}`}>
                    {task.title}
                </p>
            </div>

            {/* Description preview */}
            {task.description && (
                <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed pl-4">
                    {task.description}
                </p>
            )}

            {/* Skills */}
            {task.requiredSkills.length > 0 && (
                <div className="flex flex-wrap gap-1 pl-4">
                    {task.requiredSkills.slice(0, 3).map(s => (
                        <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-brand-500/10 border border-brand-500/20 text-brand-400">
                            {s}
                        </span>
                    ))}
                    {task.requiredSkills.length > 3 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-600">
                            +{task.requiredSkills.length - 3}
                        </span>
                    )}
                </div>
            )}

            {/* Footer row */}
            <div className="flex items-center justify-between pt-1 pl-4 gap-2">
                {/* Left: assignee + complexity */}
                <div className="flex items-center gap-2">
                    <MiniAvatar name={assigneeName} />
                    <span className="flex gap-0.5">{complexityDots(task.complexityScore)}</span>
                </div>

                {/* Right: due date + status dropdown */}
                <div className="flex items-center gap-2">
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
                <div className="absolute inset-0 rounded-xl flex items-center justify-center bg-slate-900/60">
                    <div className="w-4 h-4 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
                </div>
            )}
        </div>
    );
}
