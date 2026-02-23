// components/tasks/columnMeta.tsx
// Column metadata constants extracted here so KanbanColumn.tsx only exports
// a component (satisfying Vite fast-refresh requirements).

import type { ReactNode } from 'react';
import type { TaskStatus } from '../../api/tasks';

export const COLUMN_META: Record<
    TaskStatus,
    { label: string; accent: string; badge: string; icon: ReactNode }
> = {
    assigned: {
        label: 'Assigned',
        accent: 'border-slate-500',
        badge: 'bg-slate-800 text-slate-400',
        icon: (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
            </svg>
        ),
    },
    in_progress: {
        label: 'In Progress',
        accent: 'border-indigo-500',
        badge: 'bg-indigo-500/15 text-indigo-400',
        icon: (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
        ),
    },
    completed: {
        label: 'Completed',
        accent: 'border-emerald-500',
        badge: 'bg-emerald-500/15 text-emerald-400',
        icon: (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
            </svg>
        ),
    },
};
