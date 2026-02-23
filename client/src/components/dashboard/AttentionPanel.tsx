// components/dashboard/AttentionPanel.tsx
// Section 1 — three attention cards that surface items requiring admin action.
//
// Derives all values from DashboardData already in memory:
//   • Overdue tasks    → tasks past due date not yet completed (approximated
//                        from employees whose completion rate < 1 and have tasks)
//   • Declining        → employees whose productivityScore < 60 (proxy for
//                        "declining productivity" until trend data is available)
//   • Skill-gap blocked→ employees with 0 assigned tasks whose score is null
//                        (no tasks = possibly blocked by missing skills)
//
// Each card is clickable and calls the supplied handler with a filter key.

import type { DashboardData } from '../../api/dashboard';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AttentionFilter = 'overdue' | 'declining' | 'skill-gap';

interface AttentionPanelProps {
    data: DashboardData;
    onFilter: (filter: AttentionFilter) => void;
    activeFilter: AttentionFilter | null;
}

// ─── Single card ──────────────────────────────────────────────────────────────

interface AttentionCardProps {
    label: string;
    count: number;
    description: string;
    icon: React.ReactNode;
    filterKey: AttentionFilter;
    severity: 'red' | 'amber' | 'violet';
    onClick: () => void;
    isActive: boolean;
}

const severityStyles: Record<
    'red' | 'amber' | 'violet',
    { border: string; activeBorder: string; icon: string; count: string; dot: string }
> = {
    red: {
        border: 'border-slate-800 hover:border-red-500/40',
        activeBorder: 'border-red-500/60 bg-red-500/5',
        icon: 'text-red-400 bg-red-500/10',
        count: 'text-red-300',
        dot: 'bg-red-500',
    },
    amber: {
        border: 'border-slate-800 hover:border-amber-500/40',
        activeBorder: 'border-amber-500/60 bg-amber-500/5',
        icon: 'text-amber-400 bg-amber-500/10',
        count: 'text-amber-300',
        dot: 'bg-amber-500',
    },
    violet: {
        border: 'border-slate-800 hover:border-violet-500/40',
        activeBorder: 'border-violet-500/60 bg-violet-500/5',
        icon: 'text-violet-400 bg-violet-500/10',
        count: 'text-violet-300',
        dot: 'bg-violet-500',
    },
};

function AttentionCard({
    label, count, description, icon, severity, onClick, isActive,
}: AttentionCardProps) {
    const s = severityStyles[severity];

    return (
        <button
            onClick={onClick}
            className={`
                w-full text-left
                rounded-xl border p-4
                transition-all
                bg-slate-900/60
                flex flex-col gap-3
                focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
                ${isActive ? s.activeBorder : s.border}
            `}
            aria-pressed={isActive}
            aria-label={`${label}: ${count}. Click to filter.`}
        >
            <div className="flex items-center justify-between">
                {/* Icon */}
                <span className={`flex items-center justify-center w-8 h-8 rounded-lg ${s.icon}`}>
                    {icon}
                </span>
                {/* Active dot */}
                {isActive && (
                    <span className={`w-2 h-2 rounded-full ${s.dot}`} aria-hidden="true" />
                )}
            </div>

            {/* Count */}
            <div>
                <span className={`text-3xl font-extrabold tabular-nums ${s.count}`}>
                    {count}
                </span>
            </div>

            {/* Label + description */}
            <div>
                <p className="text-sm font-semibold text-slate-200 leading-tight">{label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{description}</p>
            </div>

            {/* CTA hint */}
            <p className="text-[10px] text-slate-600">
                {isActive ? 'Showing filtered view ↓' : 'Click to filter employee list'}
            </p>
        </button>
    );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const OverdueIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
);

const DecliningIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
        <polyline points="17 18 23 18 23 12" />
    </svg>
);

const SkillGapIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
);

// ─── Derived counts ───────────────────────────────────────────────────────────

function deriveAttentionCounts(data: DashboardData) {
    const overdue = data.employeeStats.filter(
        e => e.isActive && e.tasksAssigned > e.tasksCompleted,
    ).length;

    const declining = data.employeeStats.filter(
        e => e.isActive && e.productivityScore !== null && e.productivityScore < 60,
    ).length;

    const skillGap = data.employeeStats.filter(
        e => e.isActive && e.tasksAssigned === 0,
    ).length;

    return { overdue, declining, skillGap };
}

// ─── Panel ────────────────────────────────────────────────────────────────────

import React from 'react';

export function AttentionPanel({ data, onFilter, activeFilter }: AttentionPanelProps) {
    const { overdue, declining, skillGap } = deriveAttentionCounts(data);

    const toggle = (f: AttentionFilter) => onFilter(activeFilter === f ? ('none' as AttentionFilter) : f);

    return (
        <section aria-label="Attention items requiring action">
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest">
                    Needs Attention
                </h2>
                {activeFilter && activeFilter !== ('none' as AttentionFilter) && (
                    <button
                        onClick={() => onFilter('none' as AttentionFilter)}
                        className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                        aria-label="Clear filter"
                    >
                        Clear filter ×
                    </button>
                )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <AttentionCard
                    label="Overdue Tasks"
                    count={overdue}
                    description="Active employees with incomplete tasks"
                    icon={<OverdueIcon />}
                    filterKey="overdue"
                    severity="red"
                    onClick={() => toggle('overdue')}
                    isActive={activeFilter === 'overdue'}
                />
                <AttentionCard
                    label="Declining Productivity"
                    count={declining}
                    description="Score below 60 in last 30 days"
                    icon={<DecliningIcon />}
                    filterKey="declining"
                    severity="amber"
                    onClick={() => toggle('declining')}
                    isActive={activeFilter === 'declining'}
                />
                <AttentionCard
                    label="Skill-Gap Blocked"
                    count={skillGap}
                    description="Active employees with no tasks assigned"
                    icon={<SkillGapIcon />}
                    filterKey="skill-gap"
                    severity="violet"
                    onClick={() => toggle('skill-gap')}
                    isActive={activeFilter === 'skill-gap'}
                />
            </div>
        </section>
    );
}
