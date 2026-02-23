// components/dashboard/TeamHealthStrip.tsx
// Section 2 — compact horizontal strip of three org-level KPI tiles.
//
// Anatomy: value (large) → label → sub-label.
// Deliberately neutral — no colour, just hierarchy.

import React from 'react';
import type { DashboardData } from '../../api/dashboard';

interface TeamHealthStripProps {
    data: DashboardData;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const PeopleIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
    </svg>
);

const ScoreIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
);

const CheckIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="9 11 12 14 22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
);

// ─── Tile ─────────────────────────────────────────────────────────────────────

interface TileProps {
    icon: React.ReactNode;
    value: string;
    label: string;
    sub: string;
}

function Tile({ icon, value, label, sub }: TileProps) {
    return (
        <div className="flex items-center gap-3.5 flex-1 min-w-0 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3.5">
            <span className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-slate-800 text-slate-400">
                {icon}
            </span>
            <div className="min-w-0">
                <p className="text-2xl font-extrabold text-white tabular-nums leading-none">{value}</p>
                <p className="text-xs font-medium text-slate-400 mt-1 leading-tight truncate">{label}</p>
                <p className="text-[10px] text-slate-600 mt-0.5 truncate">{sub}</p>
            </div>
        </div>
    );
}

// ─── Strip ────────────────────────────────────────────────────────────────────

export function TeamHealthStrip({ data }: TeamHealthStripProps) {
    const scored = data.employeeStats.filter(e => e.productivityScore !== null);
    const avgScore =
        scored.length > 0
            ? Math.round(scored.reduce((s, e) => s + (e.productivityScore ?? 0), 0) / scored.length)
            : null;

    const completionPct = Math.round(data.completionRate * 100);

    return (
        <section aria-label="Team health summary">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
                Team Health
            </h2>
            <div className="flex flex-col sm:flex-row gap-2">
                <Tile
                    icon={<PeopleIcon />}
                    value={String(data.activeEmployees)}
                    label="Active Employees"
                    sub={`${data.totalEmployees - data.activeEmployees} inactive`}
                />
                <Tile
                    icon={<ScoreIcon />}
                    value={avgScore !== null ? String(avgScore) : '—'}
                    label="Avg Productivity Score"
                    sub={scored.length > 0 ? `across ${scored.length} scored` : 'no scores yet'}
                />
                <Tile
                    icon={<CheckIcon />}
                    value={`${completionPct}%`}
                    label="Task Completion"
                    sub={`${data.tasksCompleted} of ${data.tasksAssigned} tasks done`}
                />
            </div>
        </section>
    );
}


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

