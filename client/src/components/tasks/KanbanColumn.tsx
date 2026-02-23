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
            {/* Column header */}
            <div className="flex items-center gap-2 px-1 mb-3">
                <span className={`${status === 'IN_PROGRESS' ? 'text-indigo-400'
                        : status === 'COMPLETED' ? 'text-emerald-400'
                            : 'text-slate-500'
                    }`}>
                    {meta.icon}
                </span>
                <h2 className="text-sm font-semibold text-slate-300">{meta.label}</h2>
                <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${meta.badge}`}>
                    {count}
                </span>
            </div>

            {/* Drop zone */}
            <div
                onDragOver={onDragOver}
                onDrop={e => onDrop(e, status)}
                onDragLeave={onDragLeave}
                className={`
          flex-1 rounded-2xl border-2 p-2 space-y-2.5 min-h-[200px]
          transition-all duration-200
          ${isDropTarget
                        ? `${meta.accent} bg-slate-900/60 shadow-inner scale-[1.01]`
                        : 'border-dashed border-slate-800/60 bg-slate-900/20'
                    }
        `}
            >
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
    );
}
