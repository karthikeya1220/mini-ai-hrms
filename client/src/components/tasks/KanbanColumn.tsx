// components/tasks/KanbanColumn.tsx
// Drop zone for a single Kanban column.
// Only exports a React component (required for Vite fast-refresh).
// Column metadata (COLUMN_META) lives in ./columnMeta.tsx.

import type { ReactNode } from 'react';
import type { TaskStatus } from '../../api/tasks';
import { COLUMN_META } from './columnMeta';

// Re-export for consumers that import from this file
export { COLUMN_META };

// ─── Column ───────────────────────────────────────────────────────────────────

interface KanbanColumnProps {
    status: TaskStatus;
    count: number;
    children: ReactNode;
    isDropTarget: boolean;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent, status: TaskStatus) => void;
    onDragLeave: () => void;
}

export function KanbanColumn({
    status, count, children,
    isDropTarget, onDragOver, onDrop, onDragLeave,
}: KanbanColumnProps) {
    const meta = COLUMN_META[status];

    return (
        <div className="flex flex-col min-w-[300px] w-full">
            {/* Column container */}
            <div
                onDragOver={onDragOver}
                onDrop={e => onDrop(e, status)}
                onDragLeave={onDragLeave}
                className={`
                    flex-1 flex flex-col rounded-xl p-3 min-h-[200px]
                    backdrop-blur-sm transition-all duration-200
                    shadow-[0_0_0_1px_rgba(255,255,255,0.05)]
                    ${status === 'COMPLETED'
                        ? 'bg-emerald-950/30'
                        : 'bg-slate-900/40'
                    }
                    ${isDropTarget ? `${meta.accent} scale-[1.01]` : ''}
                `}
            >
                {/* Column header */}
                <div className="flex items-center gap-2 border-b border-white/10 pb-2 mb-3">
                    <span className={`${status === 'IN_PROGRESS' ? 'text-lime-400'
                            : status === 'COMPLETED' ? 'text-emerald-400'
                                : 'text-slate-500'
                        }`}>
                        {meta.icon}
                    </span>
                    <h2 className="text-sm font-semibold text-slate-300">{meta.label}</h2>
                    <span className={`
                        ml-auto min-w-[22px] text-center text-xs font-bold
                        px-2 py-0.5 rounded-full tabular-nums
                        bg-white/5 text-slate-400
                        shadow-[0_0_0_1px_rgba(255,255,255,0.08)]
                        ${meta.badge}
                    `}>
                        {count}
                    </span>
                </div>

                {/* Cards */}
                <div className="flex-1 space-y-2.5">
                    {children}

                    {/* Empty state */}
                    {count === 0 && (
                        <div className="flex flex-col items-center justify-center h-24 text-slate-700 text-xs gap-1.5">
                            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                                <rect x="3" y="3" width="18" height="18" rx="3" />
                                <line x1="12" y1="8" x2="12" y2="16" />
                                <line x1="8" y1="12" x2="16" y2="12" />
                            </svg>
                            Drop cards here
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
