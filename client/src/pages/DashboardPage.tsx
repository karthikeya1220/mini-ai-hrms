// pages/DashboardPage.tsx — decision-centered admin dashboard.
//
// Layout (top → bottom):
//  ┌─ Header (page title + refresh) ─────────────────────────────┐
//  ├─ SECTION 1: AttentionPanel (3 alert cards) ──────────────────┤
//  ├─ SECTION 2: TeamHealthStrip (compact KPIs) ──────────────────┤
//  ├─ SECTION 3: Employee Card Grid + filter label ───────────────┤
//  └─ On-chain activity log (preserved) ─────────────────────────┘

import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useDashboard } from '../hooks/useDashboard';
import { AttentionPanel } from '../components/dashboard/AttentionPanel';
import { TeamHealthStrip } from '../components/dashboard/TeamHealthStrip';
import { EmployeeCard } from '../components/dashboard/EmployeeCard';
import type { AttentionFilter } from '../components/dashboard/AttentionPanel';
import type { EmployeeStat } from '../api/dashboard';

// ─── Icon ─────────────────────────────────────────────────────────────────────

const RefreshIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
);

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
    return <div className={`rounded-xl bg-white/5 animate-pulse ${className}`} />;
}

function DashboardSkeleton() {
    return (
        <div className="space-y-6">
            <div>
                <Skeleton className="h-4 w-32 mb-3" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[0, 1, 2].map(i => <Skeleton key={i} className="h-36" />)}
                </div>
            </div>
            <div>
                <Skeleton className="h-4 w-24 mb-3" />
                <div className="flex gap-2">
                    {[0, 1, 2].map(i => <Skeleton key={i} className="h-16 flex-1" />)}
                </div>
            </div>
            <div>
                <Skeleton className="h-4 w-40 mb-3" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-52" />)}
                </div>
            </div>
        </div>
    );
}

// ─── Error banner ─────────────────────────────────────────────────────────────

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 flex flex-col items-center gap-4 text-center">
            <svg className="w-8 h-8 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>
                <p className="text-white font-semibold mb-1">Failed to load dashboard</p>
                <p className="text-sm text-slate-400">{message}</p>
            </div>
            <button
                onClick={onRetry}
                className="px-5 py-2 rounded-lg border border-white/10 text-sm text-slate-300 hover:border-white/20 hover:text-white transition-colors"
            >
                Try again
            </button>
        </div>
    );
}

// ─── Filter helpers ───────────────────────────────────────────────────────────

function applyFilter(
    employees: EmployeeStat[],
    filter: AttentionFilter | null,
): EmployeeStat[] {
    if (!filter || filter === ('none' as AttentionFilter)) return employees;
    switch (filter) {
        case 'overdue':
            return employees.filter(e => e.isActive && e.tasksAssigned > e.tasksCompleted);
        case 'declining':
            return employees.filter(e => e.isActive && e.productivityScore !== null && e.productivityScore < 60);
        case 'skill-gap':
            return employees.filter(e => e.isActive && e.tasksAssigned === 0);
        default:
            return employees;
    }
}

const FILTER_LABELS: Record<string, string> = {
    overdue: 'Overdue Tasks',
    declining: 'Declining Productivity',
    'skill-gap': 'Skill-Gap Blocked',
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
    useAuth(); // keep context subscription so ProtectedRoute re-renders on logout
    const { data, loading, error, refetch } = useDashboard();
    const navigate = useNavigate();

    const [activeFilter, setActiveFilter] = useState<AttentionFilter | null>(null);

    const handleAssignTask = useCallback(() => {
        navigate('/tasks');
    }, [navigate]);

    const handleViewDetails = useCallback(() => {
        navigate('/employees');
    }, [navigate]);

    const visibleEmployees = useMemo(() => {
        if (!data) return [];
        return applyFilter(data.employeeStats, activeFilter);
    }, [data, activeFilter]);

    const orgAvgScore = useMemo(() => {
        if (!data) return null;
        const scored = data.employeeStats.filter(e => e.productivityScore !== null);
        if (scored.length === 0) return null;
        return Math.round(scored.reduce((s, e) => s + (e.productivityScore ?? 0), 0) / scored.length);
    }, [data]);

    const updatedAt = data?.generatedAt
        ? new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : null;

    return (
        <div className="min-h-dvh bg-black text-slate-100">

            {/* ── Header ───────────────────────────────────────────────────── */}
            <header className="sticky top-0 z-10 border-b border-white/5 bg-black/85 backdrop-blur-xl lg:top-0">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                        <h1 className="text-lg sm:text-2xl font-semibold text-white tracking-tight truncate">Admin Dashboard</h1>
                        {updatedAt && (
                            <span className="hidden sm:inline text-xs text-slate-600">
                                · updated {updatedAt}
                            </span>
                        )}
                    </div>
                    <button
                        id="btn-dashboard-refresh"
                        onClick={refetch}
                        disabled={loading}
                        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/8 text-xs text-slate-400 hover:border-white/15 hover:text-slate-200 transition-colors disabled:opacity-40"
                        aria-label="Refresh dashboard"
                    >
                        <span className={loading ? 'animate-spin' : ''}><RefreshIcon /></span>
                        <span className="hidden sm:inline">Refresh</span>
                    </button>
                </div>
            </header>

            {/* ── Main ─────────────────────────────────────────────────────── */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 py-5 sm:py-6 space-y-6 sm:space-y-8 pb-10">

                {loading && !data ? (
                    <DashboardSkeleton />
                ) : error ? (
                    <ErrorBanner message={error} onRetry={refetch} />
                ) : data ? (
                    <>
                        {/* ═══════════════════════════════════════════════════
                            SECTION 1 — Attention Panel
                        ═══════════════════════════════════════════════════ */}
                        <AttentionPanel
                            data={data}
                            onFilter={setActiveFilter}
                            activeFilter={activeFilter}
                        />

                        {/* ═══════════════════════════════════════════════════
                            SECTION 2 — Actionable Employee List
                        ═══════════════════════════════════════════════════ */}
                        <section aria-label="Employee list">
                            <div className="rounded-2xl bg-slate-900/40 p-4">
                                <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
                                            Employees
                                        </h2>
                                        {activeFilter && activeFilter !== ('none' as AttentionFilter) && (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-white/5 text-slate-300 border border-white/10">
                                                {FILTER_LABELS[activeFilter]}
                                                <button
                                                    onClick={() => setActiveFilter(null)}
                                                    className="ml-0.5 text-slate-500 hover:text-slate-200 transition-colors"
                                                    aria-label="Clear filter"
                                                >
                                                    ×
                                                </button>
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-xs text-slate-600">
                                        {visibleEmployees.length} of {data.employeeStats.length} employees
                                    </span>
                                </div>

                                {visibleEmployees.length === 0 ? (
                                    <div className="rounded-xl border border-dashed border-white/10 py-12 text-center">
                                        <p className="text-slate-600 text-sm">
                                            {activeFilter
                                                ? 'No employees match this filter.'
                                                : 'No employees found for this organisation.'}
                                        </p>
                                        {activeFilter && (
                                            <button
                                                onClick={() => setActiveFilter(null)}
                                                className="mt-3 text-xs text-slate-500 hover:text-slate-300 underline transition-colors"
                                            >
                                                Clear filter
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                        {visibleEmployees.map(emp => (
                                            <EmployeeCard
                                                key={emp.employeeId}
                                                emp={emp}
                                                orgAvgScore={orgAvgScore}
                                                onAssignTask={handleAssignTask}
                                                onViewDetails={handleViewDetails}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </section>

                        {/* ═══════════════════════════════════════════════════
                            SECTION 3 — Team Health Strip
                        ═══════════════════════════════════════════════════ */}
                        <TeamHealthStrip data={data} />

                        {/* ── On-chain activity log (commented out — Web3 integration disabled) ──
                        {data.recentLogs.length > 0 && (
                            <section aria-label="Recent on-chain activity">
                                <div className="flex items-center justify-between mb-3">
                                    <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
                                        On-chain Activity
                                    </h2>
                                    <span className="text-xs text-slate-600">Polygon Amoy</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {data.recentLogs.map(log => (
                                        <div key={log.txHash} className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-violet-500/30 transition-colors duration-150">
                                            <div className="flex justify-between items-start mb-2">
                                                <span className="p-1.5 rounded-lg bg-violet-500/10 text-violet-400">
                                                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                                        <polyline points="22 4 12 14.01 9 11.01" />
                                                    </svg>
                                                </span>
                                                <a
                                                    href={`https://amoy.polygonscan.com/tx/${log.txHash}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-[10px] tabular-nums text-slate-500 hover:text-violet-400 border border-slate-800 rounded px-1.5 py-0.5 flex items-center gap-1"
                                                    aria-label="View transaction on PolygonScan"
                                                >
                                                    {log.txHash.slice(0, 8)}…{log.txHash.slice(-6)}
                                                    <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                                        <polyline points="15 3 21 3 21 9" />
                                                        <line x1="10" y1="14" x2="21" y2="3" />
                                                    </svg>
                                                </a>
                                            </div>
                                            <p className="text-sm font-semibold text-slate-200 truncate">{log.taskTitle}</p>
                                            <div className="flex items-center justify-between mt-2">
                                                <span className="text-xs text-slate-500">{log.employeeName}</span>
                                                <span className="text-[10px] text-slate-600">
                                                    {new Date(log.loggedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}
                        ── end Web3 block ── */}
                    </>
                ) : null}
            </main>
        </div>
    );
}
