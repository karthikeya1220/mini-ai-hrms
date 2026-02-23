// components/dashboard/AttentionPanel.tsx
// Section 1 — three attention cards that surface items requiring admin action.
//
// Each card: single number · short label · clickable → filters employee grid.
// Severity colours are semantic-only: red / amber / violet.

import React from 'react';
import type { DashboardData } from '../../api/dashboard';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AttentionFilter = 'overdue' | 'declining' | 'skill-gap';

interface AttentionPanelProps {
    data: DashboardData;
    onFilter: (filter: AttentionFilter) => void;
    activeFilter: AttentionFilter | null;
}

// ─── Severity tokens ─────────────────────────────────────────────────────────

const SEV = {
    red: {
        idle:   'border-slate-800 hover:border-red-500/30 hover:bg-red-500/[0.03]',
        active: 'border-red-500/50 bg-red-500/[0.06]',
        num:    'text-red-300',
        pill:   'bg-red-500/10 text-red-400',
        dot:    'bg-red-500',
    },
    amber: {
        idle:   'border-slate-800 hover:border-amber-500/30 hover:bg-amber-500/[0.03]',
        active: 'border-amber-500/50 bg-amber-500/[0.06]',
        num:    'text-amber-300',
        pill:   'bg-amber-500/10 text-amber-400',
        dot:    'bg-amber-500',
    },
    violet: {
        idle:   'border-slate-800 hover:border-violet-500/30 hover:bg-violet-500/[0.03]',
        active: 'border-violet-500/50 bg-violet-500/[0.06]',
        num:    'text-violet-300',
        pill:   'bg-violet-500/10 text-violet-400',
        dot:    'bg-violet-500',
    },
} as const;

// ─── Icons ────────────────────────────────────────────────────────────────────

const OverdueIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
);

const DecliningIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
        <polyline points="17 18 23 18 23 12" />
    </svg>
);

const SkillGapIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
);

// ─── Single attention card ────────────────────────────────────────────────────

interface CardDef {
    key: AttentionFilter;
    label: string;
    description: string;
    count: number;
    sev: keyof typeof SEV;
    icon: React.ReactNode;
}

function AttentionCard({
    card,
    isActive,
    onClick,
}: {
    card: CardDef;
    isActive: boolean;
    onClick: () => void;
}) {
    const s = SEV[card.sev];

    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={isActive}
            aria-label={`${card.label}: ${card.count}. ${isActive ? 'Click to clear filter.' : 'Click to filter employee list.'}`}
            className={`
                group w-full text-left rounded-xl border bg-slate-900 p-5
                flex flex-col gap-4
                focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60
                transition-all duration-150
                ${isActive ? s.active : s.idle}
            `}
        >
            {/* Row 1 — icon + active indicator */}
            <div className="flex items-center justify-between">
                <span className={`flex items-center justify-center w-8 h-8 rounded-lg ${s.pill}`}>
                    {card.icon}
                </span>
                {isActive && (
                    <span className={`w-2 h-2 rounded-full ${s.dot} flex-shrink-0`} aria-hidden="true" />
                )}
            </div>

            {/* Row 2 — number (primary metric) */}
            <div>
                <span className={`text-4xl font-extrabold tabular-nums leading-none ${s.num}`}>
                    {card.count}
                </span>
            </div>

            {/* Row 3 — label + description */}
            <div>
                <p className="text-sm font-semibold text-slate-200 leading-snug">{card.label}</p>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">{card.description}</p>
            </div>

            {/* Row 4 — CTA hint */}
            <p className="text-[10px] text-slate-600 group-hover:text-slate-500 transition-colors">
                {isActive ? '↓ Showing filtered view · click to clear' : 'Click to filter ↓'}
            </p>
        </button>
    );
}

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

export function AttentionPanel({ data, onFilter, activeFilter }: AttentionPanelProps) {
    const { overdue, declining, skillGap } = deriveAttentionCounts(data);

    const toggle = (f: AttentionFilter) =>
        onFilter(activeFilter === f ? ('none' as AttentionFilter) : f);

    const cards: CardDef[] = [
        {
            key: 'overdue',
            label: 'Overdue Tasks',
            description: 'Active employees with incomplete tasks past due',
            count: overdue,
            sev: 'red',
            icon: <OverdueIcon />,
        },
        {
            key: 'declining',
            label: 'Declining Productivity',
            description: 'Employees with a score below 60',
            count: declining,
            sev: 'amber',
            icon: <DecliningIcon />,
        },
        {
            key: 'skill-gap',
            label: 'No Tasks Assigned',
            description: 'Active employees with zero tasks — possible skill gap',
            count: skillGap,
            sev: 'violet',
            icon: <SkillGapIcon />,
        },
    ];

    return (
        <section aria-label="Attention items requiring action">
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
                    Needs Attention
                </h2>
                {activeFilter && activeFilter !== ('none' as AttentionFilter) && (
                    <button
                        type="button"
                        onClick={() => onFilter('none' as AttentionFilter)}
                        className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                        aria-label="Clear filter"
                    >
                        Clear filter ×
                    </button>
                )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {cards.map(card => (
                    <AttentionCard
                        key={card.key}
                        card={card}
                        isActive={activeFilter === card.key}
                        onClick={() => toggle(card.key)}
                    />
                ))}
            </div>
        </section>
    );
}
