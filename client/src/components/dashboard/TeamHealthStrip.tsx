// components/dashboard/TeamHealthStrip.tsx
// Section 2 — compact horizontal bar of org-level health stats.
// Three neutral stat tiles: Active Employees · Avg Productivity · Task Completion %.

import type { DashboardData } from '../../api/dashboard';

interface TeamHealthStripProps {
    data: DashboardData;
}

interface StatTileProps {
    label: string;
    value: string;
    sub?: string;
    icon: React.ReactNode;
}

function StatTile({ label, value, sub, icon }: StatTileProps) {
    return (
        <div className="flex items-center gap-3 flex-1 px-4 py-3 rounded-lg border border-slate-800 bg-slate-900 min-w-0">
            <span className="flex-shrink-0 text-slate-500">{icon}</span>
            <div className="min-w-0">
                <p className="text-lg font-bold text-slate-100 tabular-nums leading-tight truncate">
                    {value}
                </p>
                <p className="text-xs text-slate-500 leading-tight truncate">{label}</p>
                {sub && <p className="text-[10px] text-slate-600 mt-0.5 truncate">{sub}</p>}
            </div>
        </div>
    );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const ActiveIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
        <polyline points="16 11 18 13 22 9" />
    </svg>
);

const AvgScoreIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
);

const CompletionIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="9 11 12 14 22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
);

// ─── Strip ────────────────────────────────────────────────────────────────────

import React from 'react';

export function TeamHealthStrip({ data }: TeamHealthStripProps) {
    // Average productivity across employees that have a score
    const scoredEmployees = data.employeeStats.filter(e => e.productivityScore !== null);
    const avgProductivity =
        scoredEmployees.length > 0
            ? Math.round(
                  scoredEmployees.reduce((sum, e) => sum + (e.productivityScore ?? 0), 0) /
                      scoredEmployees.length,
              )
            : null;

    const completionPct = Math.round(data.completionRate * 100);

    return (
        <section aria-label="Team health summary">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
                Team Health
            </h2>
            <div className="flex flex-col sm:flex-row gap-2">
                <StatTile
                    label="Active Employees"
                    value={String(data.activeEmployees)}
                    sub={`${data.totalEmployees - data.activeEmployees} inactive`}
                    icon={<ActiveIcon />}
                />
                <StatTile
                    label="Avg Productivity"
                    value={avgProductivity !== null ? `${avgProductivity}` : '—'}
                    sub={scoredEmployees.length > 0 ? `across ${scoredEmployees.length} scored` : 'no scores yet'}
                    icon={<AvgScoreIcon />}
                />
                <StatTile
                    label="Task Completion"
                    value={`${completionPct}%`}
                    sub={`${data.tasksCompleted} of ${data.tasksAssigned} tasks`}
                    icon={<CompletionIcon />}
                />
            </div>
        </section>
    );
}
