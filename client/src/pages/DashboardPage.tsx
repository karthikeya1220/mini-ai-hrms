// pages/DashboardPage.tsx — main dashboard view.
//
// Layout:
//  ┌─ Header (org name + refresh + logout) ──────────────────────┐
//  ├─ Stat cards (4 KPI tiles) ──────────────────────────────────┤
//  ├─ Chart card (completion bar chart) ─────────────────────────┤
//  └─ Employee table (name, role, tasks, score badge, active) ───┘

import { useAuth } from '../context/AuthContext';
import { useDashboard } from '../hooks/useDashboard';
import { StatCard } from '../components/dashboard/StatCard';
import { CompletionChart } from '../components/dashboard/CompletionChart';
import { ScoreBadge } from '../components/dashboard/ScoreBadge';

// ─── SVG icon helpers ────────────────────────────────────────────────────────

const icons = {
    users: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
    ),
    activeUsers: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
            <polyline points="16 11 18 13 22 9" />
        </svg>
    ),
    tasks: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
    ),
    check: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
            <polyline points="9 11 12 14 22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
    ),
    refresh: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
    ),
    logout: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
    ),
    logo: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-white">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
            <path d="M8 12h8M12 8v8" />
        </svg>
    ),
};

// ─── Skeleton loader ─────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
    return (
        <div className={`rounded-xl bg-slate-800/60 animate-pulse ${className}`} />
    );
}

function DashboardSkeleton() {
    return (
        <div className="space-y-8">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-36" />)}
            </div>
            <Skeleton className="h-80" />
            <Skeleton className="h-64" />
        </div>
    );
}

// ─── Error state ─────────────────────────────────────────────────────────────

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 flex flex-col items-center gap-4 text-center">
            <svg className="w-10 h-10 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
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
                className="px-5 py-2 rounded-xl border border-slate-700 text-sm text-slate-300 hover:border-brand-500 hover:text-brand-300 transition-all"
            >
                Try again
            </button>
        </div>
    );
}

// ─── Mini progress bar ───────────────────────────────────────────────────────

function MiniBar({ rate }: { rate: number }) {
    const pct = Math.round(rate * 100);
    const color =
        pct >= 90 ? 'bg-emerald-500' :
            pct >= 80 ? 'bg-blue-500' :
                pct >= 70 ? 'bg-brand-500' :
                    pct >= 60 ? 'bg-amber-500' : 'bg-red-500';

    return (
        <div className="flex items-center gap-2 w-28">
            <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                    className={`h-full rounded-full ${color} transition-all duration-700`}
                    style={{ width: `${pct}%` }}
                />
            </div>
            <span className="text-xs tabular-nums text-slate-500 w-7 text-right">{pct}%</span>
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
    const { user, org, logout } = useAuth();
    const { data, loading, error, refetch } = useDashboard();

    const updatedAt = data?.generatedAt
        ? new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : null;

    return (
        <div className="min-h-dvh bg-slate-950 text-slate-100">
            {/* ── Top nav ──────────────────────────────────────────────────────────── */}
            <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-6">
                        {/* Brand */}
                        <div className="flex items-center gap-3">
                            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 shadow-sm shadow-brand-500/30">
                                {icons.logo}
                            </div>
                            <div className="hidden sm:block">
                                <p className="text-sm font-bold text-white leading-none">{org?.name ?? 'Workspace'}</p>
                                <p className="text-xs text-slate-500 leading-none mt-0.5">{user?.email}</p>
                            </div>
                        </div>

                        <nav className="flex items-center gap-1 text-sm bg-slate-900/50 p-1 rounded-xl border border-slate-800/50">
                            <span className="text-slate-200 font-semibold px-3 py-1.5 bg-slate-800 rounded-lg shadow-sm">Dashboard</span>
                            <a href="/employees" className="text-slate-500 hover:text-slate-300 transition-colors px-3 py-1.5 rounded-lg hover:bg-slate-800 font-medium">
                                Employees
                            </a>
                            <a href="/tasks" className="text-slate-500 hover:text-slate-300 transition-colors px-3 py-1.5 rounded-lg hover:bg-slate-800 font-medium">
                                Tasks
                            </a>
                        </nav>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                        {updatedAt && (
                            <span className="hidden sm:inline text-xs text-slate-600 mr-2">
                                Updated {updatedAt}
                            </span>
                        )}
                        <button
                            id="btn-dashboard-refresh"
                            onClick={refetch}
                            disabled={loading}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 text-xs text-slate-400 hover:border-slate-700 hover:text-slate-200 transition-all disabled:opacity-40"
                            title="Refresh dashboard"
                        >
                            <span className={loading ? 'animate-spin' : ''}>{icons.refresh}</span>
                            <span className="hidden sm:inline">Refresh</span>
                        </button>
                        <button
                            id="btn-dashboard-logout"
                            onClick={logout}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 text-xs text-slate-400 hover:border-red-500/50 hover:text-red-400 transition-all"
                        >
                            {icons.logout}
                            <span className="hidden sm:inline">Sign out</span>
                        </button>
                    </div>
                </div>
            </header>

            {/* ── Main ─────────────────────────────────────────────────────────────── */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">

                {/* Page heading */}
                <div>
                    <h1 className="text-2xl font-bold text-white tracking-tight">Dashboard</h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Organisation overview · {data?.totalEmployees ?? '—'} employees · real-time summary
                    </p>
                </div>

                {/* ── Content ─────────────────────────────────────────────────────── */}
                {loading && !data ? (
                    <DashboardSkeleton />
                ) : error ? (
                    <ErrorBanner message={error} onRetry={refetch} />
                ) : data ? (
                    <>
                        {/* ── KPI cards ──────────────────────────────────────────────── */}
                        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Key performance indicators">
                            <StatCard
                                label="Total employees"
                                value={data.totalEmployees}
                                icon={icons.users}
                                accent="from-brand-500 to-brand-700"
                                delay={0}
                            />
                            <StatCard
                                label="Active employees"
                                value={data.activeEmployees}
                                icon={icons.activeUsers}
                                accent="from-emerald-500 to-emerald-700"
                                footnote={`${data.totalEmployees - data.activeEmployees} inactive`}
                                delay={80}
                            />
                            <StatCard
                                label="Tasks assigned"
                                value={data.tasksAssigned}
                                icon={icons.tasks}
                                accent="from-blue-500 to-blue-700"
                                delay={160}
                            />
                            <StatCard
                                label="Tasks completed"
                                value={data.tasksCompleted}
                                icon={icons.check}
                                accent={data.completionRate >= 0.7 ? 'from-emerald-500 to-emerald-700' : 'from-amber-500 to-amber-700'}
                                footnote={`${Math.round(data.completionRate * 100)}% completion rate`}
                                delay={240}
                            />
                        </section>

                        {/* ── Bar chart ──────────────────────────────────────────────── */}
                        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 backdrop-blur-sm p-6">
                            <div className="flex items-center justify-between mb-6">
                                <div>
                                    <h2 className="text-base font-semibold text-white">Completion by employee</h2>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        Dashed line = org average ({Math.round(data.completionRate * 100)}%)
                                    </p>
                                </div>
                                {/* Legend */}
                                <div className="hidden sm:flex items-center gap-3 text-xs text-slate-500">
                                    {[
                                        { color: 'bg-emerald-500', label: 'A+ ≥90%' },
                                        { color: 'bg-blue-500', label: 'A ≥80%' },
                                        { color: 'bg-brand-500', label: 'B ≥70%' },
                                        { color: 'bg-amber-500', label: 'C ≥60%' },
                                        { color: 'bg-red-500', label: 'D <60%' },
                                    ].map(l => (
                                        <span key={l.label} className="flex items-center gap-1">
                                            <span className={`w-2 h-2 rounded-full ${l.color}`} />
                                            {l.label}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            <CompletionChart
                                stats={data.employeeStats}
                                orgAvgRate={data.completionRate}
                            />
                        </section>

                        {/* ── Employee table ─────────────────────────────────────────── */}
                        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 backdrop-blur-sm overflow-hidden">
                            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
                                <h2 className="text-base font-semibold text-white">Employee performance</h2>
                                <span className="text-xs text-slate-600">{data.employeeStats.length} employees</span>
                            </div>

                            {data.employeeStats.length === 0 ? (
                                <div className="px-6 py-12 text-center text-slate-600 text-sm">
                                    No employees found for this organisation.
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-slate-800/60">
                                                {['Employee', 'Role / Dept', 'Tasks', 'On-chain', 'Progress', 'Score', 'Status'].map(h => (
                                                    <th key={h} className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-widest text-slate-600 first:pl-6">
                                                        {h}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data.employeeStats.map((emp, idx) => (
                                                <tr
                                                    key={emp.employeeId}
                                                    className={`
                            border-b border-slate-800/40 last:border-0
                            transition-colors duration-150 hover:bg-slate-800/30
                            ${idx % 2 === 0 ? '' : 'bg-slate-900/20'}
                          `}
                                                >
                                                    {/* Name */}
                                                    <td className="px-6 py-3.5">
                                                        <div className="flex items-center gap-3">
                                                            {/* Initials avatar */}
                                                            <div
                                                                className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                                                                style={{ background: `hsl(${(emp.name.charCodeAt(0) * 37) % 360}, 55%, 35%)` }}
                                                            >
                                                                {emp.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}
                                                            </div>
                                                            <span className="font-medium text-slate-200 whitespace-nowrap">{emp.name}</span>
                                                        </div>
                                                    </td>

                                                    {/* Role / dept */}
                                                    <td className="px-6 py-3.5">
                                                        <p className="text-slate-300">{emp.role ?? '—'}</p>
                                                        {emp.department && (
                                                            <p className="text-xs text-slate-600 mt-0.5">{emp.department}</p>
                                                        )}
                                                    </td>

                                                    {/* Tasks */}
                                                    <td className="px-6 py-3.5 tabular-nums text-slate-400">
                                                        <span className="text-slate-200 font-medium">{emp.tasksCompleted}</span>
                                                        <span className="text-slate-600"> / {emp.tasksAssigned}</span>
                                                    </td>

                                                    {/* On-chain verified indicator */}
                                                    <td className="px-6 py-3.5">
                                                        {emp.verifiedTasks > 0 ? (
                                                            <div className="flex items-center gap-1.5 text-violet-400 font-medium text-xs">
                                                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                                                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                                                                    <line x1="12" y1="22.08" x2="12" y2="12" />
                                                                </svg>
                                                                <span>{emp.verifiedTasks} log{emp.verifiedTasks !== 1 ? 's' : ''}</span>
                                                            </div>
                                                        ) : (
                                                            <span className="text-slate-700 text-xs">—</span>
                                                        )}
                                                    </td>

                                                    {/* Progress bar */}
                                                    <td className="px-6 py-3.5">
                                                        <MiniBar rate={emp.completionRate} />
                                                    </td>

                                                    {/* Score badge (uses AI productivity score) */}
                                                    <td className="px-6 py-3.5">
                                                        <ScoreBadge rate={(emp.productivityScore ?? 0) / 100} size="sm" />
                                                    </td>

                                                    {/* Active indicator */}
                                                    <td className="px-6 py-3.5">
                                                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${emp.isActive ? 'text-emerald-400' : 'text-slate-600'}`}>
                                                            <span className={`w-1.5 h-1.5 rounded-full ${emp.isActive ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                                                            {emp.isActive ? 'Active' : 'Inactive'}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </section>

                        {/* ── Recent Verified Tasks (Blockchain Log) ──────────────────── */}
                        <section className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h2 className="text-base font-semibold text-white">Recent on-chain activity</h2>
                                <span className="text-xs text-slate-500">Polygon Amoy Network</span>
                            </div>

                            {data.recentLogs.length === 0 ? (
                                <div className="rounded-2xl border border-dashed border-slate-800 p-8 text-center bg-slate-900/40">
                                    <svg className="w-8 h-8 text-slate-800 mx-auto mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                    </svg>
                                    <p className="text-slate-600 text-sm italic">No on-chain events recorded yet.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {data.recentLogs.map(log => (
                                        <div
                                            key={log.txHash}
                                            className="group p-4 rounded-2xl border border-slate-800 bg-slate-900/60 hover:border-violet-500/30 transition-all hover:translate-y-[-2px]"
                                        >
                                            <div className="flex justify-between items-start mb-2">
                                                <div className="p-1.5 rounded-lg bg-violet-500/10 text-violet-400 group-hover:bg-violet-500/20 transition-colors">
                                                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                                        <polyline points="22 4 12 14.01 9 11.01" />
                                                    </svg>
                                                </div>
                                                <a
                                                    href={`https://amoy.polygonscan.com/tx/${log.txHash}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-[10px] tabular-nums text-slate-500 hover:text-violet-400 border border-slate-800 rounded-md px-1.5 py-0.5 flex items-center gap-1 group-hover:border-violet-500/20"
                                                >
                                                    {log.txHash.slice(0, 8)}...{log.txHash.slice(-6)}
                                                    <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                                        <polyline points="15 3 21 3 21 9" />
                                                        <line x1="10" y1="14" x2="21" y2="3" />
                                                    </svg>
                                                </a>
                                            </div>
                                            <p className="text-sm font-bold text-slate-200 line-clamp-1 group-hover:text-white transition-colors">
                                                {log.taskTitle}
                                            </p>
                                            <div className="flex items-center justify-between mt-3">
                                                <span className="text-xs text-slate-500 font-medium">{log.employeeName}</span>
                                                <span className="text-[10px] text-slate-600">
                                                    {new Date(log.loggedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    </>
                ) : null}
            </main>
        </div>
    );
}
