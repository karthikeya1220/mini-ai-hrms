// components/tasks/columnMeta.tsx
// Column metadata constants extracted here so KanbanColumn.tsx only exports
// a component (satisfying Vite fast-refresh requirements).

import type { ReactNode } from 'react';
import type { TaskStatus } from '../../api/tasks';

export const COLUMN_META: Record<
    TaskStatus,
    { label: string; accent: string; badge: string; icon: ReactNode }
> = {
    ASSIGNED: {
        label: 'Assigned',
        accent: 'border-slate-500',
        badge: 'bg-white/5 text-slate-400',
        icon: (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
            </svg>
        ),
    },
    IN_PROGRESS: {
        label: 'In Progress',
        accent: 'border-lime-400',
        badge: 'bg-lime-400/15 text-lime-400',
        icon: (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
        ),
    },
    COMPLETED: {
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
