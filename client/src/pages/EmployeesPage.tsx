// pages/EmployeesPage.tsx — full employee management UI.
//
// Layout:
//  ┌─ Sidebar nav ────────────────────────────────────────────────────────────────┐
//  │  (reused AppShell from Nav) — handled by the parent layout in App.tsx        │
//  └──────────────────────────────────────────────────────────────────────────────┘
//  ┌─ Page header: title + search + filter pill + Add button ─────────────────────┐
//  ├─ Employee table (name/avatar, email, role/dept, skills, active, score, ···) ─┤
//  ├─ Pagination (cursor-based, Load more) ───────────────────────────────────────┤
//  └─ Modals: EmployeeModal (add/edit) · ScorePanel · Deactivate confirm ──────────┘

import { useState, useDeferredValue } from 'react';
import { useAuth } from '../context/AuthContext';
import { useEmployees } from '../hooks/useEmployees';
import type { Employee } from '../api/employees';
import { EmployeeModal } from '../components/employees/EmployeeModal';
import { useNavigate } from 'react-router-dom';



// ─── Helpers ─────────────────────────────────────────────────────────────────

function avatar(name: string) {
    const initials = name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
    const hue = (name.charCodeAt(0) * 37) % 360;
    return { initials, bg: `hsl(${hue},55%,32%)` };
}

function joinedLabel(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
    return (
        <tr className="border-b border-slate-800/40 animate-pulse">
            {[44, 120, 100, 80, 80, 60, 36].map((w, i) => (
                <td key={i} className="px-4 py-4">
                    <div className="h-3 rounded-full bg-slate-800" style={{ width: w }} />
                </td>
            ))}
        </tr>
    );
}

// ─── Confirm deactivate dialog ────────────────────────────────────────────────

function ConfirmDialog({
    name,
    onConfirm,
    onCancel,
    loading,
}: {
    name: string;
    onConfirm: () => void;
    onCancel: () => void;
    loading: boolean;
}) {
    return (
        <>
            <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" onClick={onCancel} aria-hidden />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4 animate-fade-in">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-red-500/15 border border-red-500/30 flex-shrink-0">
                            <svg className="w-5 h-5 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                        </div>
                        <div>
                            <p className="font-semibold text-white">Deactivate employee?</p>
                            <p className="text-sm text-slate-500 mt-0.5">
                                <span className="text-slate-300">{name}</span> will be marked inactive.
                            </p>
                        </div>
                    </div>
                    <p className="text-xs text-slate-600">This is a soft delete — the record is preserved and can be reactivated.</p>
                    <div className="flex gap-3">
                        <button
                            onClick={onCancel}
                            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-700 text-sm text-slate-400 hover:border-slate-600 hover:text-slate-200 transition-all"
                            disabled={loading}
                        >
                            Cancel
                        </button>
                        <button
                            id="btn-emp-deactivate-confirm"
                            onClick={onConfirm}
                            className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-sm text-white font-medium transition-all disabled:opacity-50"
                            disabled={loading}
                        >
                            {loading ? 'Deactivating…' : 'Deactivate'}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ onAdd, filtered }: { onAdd: () => void; filtered: boolean }) {
    return (
        <tr>
            <td colSpan={8} className="py-20 text-center">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-14 h-14 rounded-2xl bg-slate-800/60 flex items-center justify-center">
                        <svg className="w-7 h-7 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                    </div>
                    <p className="text-slate-400 font-medium">
                        {filtered ? 'No employees match your search' : 'No employees yet'}
                    </p>
                    {!filtered && (
                        <button onClick={onAdd} className="btn-primary text-sm px-4 py-2">
                            Add your first employee
                        </button>
                    )}
                </div>
            </td>
        </tr>
    );
}

// ─── Filter bar ──────────────────────────────────────────────────────────────

type ActiveFilter = 'all' | 'active' | 'inactive';

function FilterPill({
    label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${active
                ? 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-300'
                : 'border border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-300'
                }`}
        >
            {label}
        </button>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EmployeesPage() {
    useAuth();  // keep context subscription so ProtectedRoute re-renders on logout

    // ── Filters ────────────────────────────────────────────────────────────────
    const [search, setSearch] = useState('');
    const [activeFilter, setActiveFilter] = useState<ActiveFilter>('active');
    const deferredSearch = useDeferredValue(search);

    const apiParams = {
        isActive: activeFilter === 'all' ? undefined : (activeFilter === 'active' ? 'true' as const : 'false' as const),
        limit: 50,
    };

    const { employees, total, loading, error, refetch, addEmployee, editEmployee, removeEmployee } =
        useEmployees(apiParams);

    const [modal, setModal] = useState<'add' | 'edit' | null>(null);
    const [selected, setSelected] = useState<Employee | null>(null);
    const [deactTarget, setDeactTarget] = useState<Employee | null>(null);
    const [deactLoading, setDeactLoading] = useState(false);
    const navigate = useNavigate();

    // ── Client-side search filter ──────────────────────────────────────────────
    const filtered = deferredSearch
        ? employees.filter(e => {
            const q = deferredSearch.toLowerCase();
            return (
                e.name.toLowerCase().includes(q) ||
                e.email.toLowerCase().includes(q) ||
                (e.jobTitle?.toLowerCase().includes(q)) ||
                (e.department?.toLowerCase().includes(q)) ||
                e.skills.some(s => s.toLowerCase().includes(q))
            );
        })
        : employees;

    // ── Action handlers ────────────────────────────────────────────────────────

    async function handleSave(data: Parameters<typeof addEmployee>[0]) {
        if (modal === 'add') {
            await addEmployee(data);
        } else if (modal === 'edit' && selected) {
            await editEmployee(selected.id, data);
        }
    }

    async function handleDeactivate() {
        if (!deactTarget) return;
        setDeactLoading(true);
        try {
            await removeEmployee(deactTarget.id);
            setDeactTarget(null);
        } catch {
            // removeEmployee throws — the ConfirmDialog will re-render; user can retry
        } finally {
            setDeactLoading(false);
        }
    }

    const COLS = ['Employee', 'Email', 'Role', 'Department', 'Skills', 'Joined', 'Status', ''];

    return (
        <div className="min-h-dvh bg-slate-950 text-slate-100">
            {/* ── Page Header ────────────────────────────────────────────────────────── */}
            <header className="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
                    <h1 className="text-base sm:text-xl font-semibold text-white truncate">Employees</h1>
                    <button
                        id="btn-add-employee"
                        onClick={() => { setSelected(null); setModal('add'); }}
                        className="btn-primary text-xs sm:text-sm gap-1.5 flex-shrink-0"
                    >
                        <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        <span className="hidden xs:inline">Add employee</span>
                        <span className="xs:hidden">Add</span>
                    </button>
                </div>
            </header>

            {/* ── Main ─────────────────────────────────────────────────────────────── */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-5 sm:space-y-6 pb-10">
                {/* Page heading */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-xl sm:text-2xl font-semibold text-white tracking-tight">Employees</h1>
                        <p className="text-sm text-slate-500 mt-1">
                            {total} total · {employees.filter(e => e.isActive).length} active
                        </p>
                    </div>

                    {/* Search + filters */}
                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Search */}
                        <div className="relative">
                            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                            <input
                                id="emp-search"
                                type="search"
                                placeholder="Search name, role, skills…"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="pl-9 pr-4 py-2 rounded-xl border border-slate-800 bg-slate-900/70 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 w-60 transition-all"
                            />
                        </div>

                        {/* Active filter pills */}
                        <div className="flex gap-1.5">
                            {(['active', 'inactive', 'all'] as ActiveFilter[]).map(f => (
                                <FilterPill
                                    key={f}
                                    label={f.charAt(0).toUpperCase() + f.slice(1)}
                                    active={activeFilter === f}
                                    onClick={() => setActiveFilter(f)}
                                />
                            ))}
                        </div>

                        {/* Refresh */}
                        <button
                            onClick={refetch}
                            disabled={loading}
                            className="p-2 rounded-lg border border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700 transition-all disabled:opacity-40"
                            title="Refresh"
                        >
                            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* ── Error ──────────────────────────────────────────────────────────── */}
                {error && (
                    <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300 flex items-center justify-between">
                        <span>{error}</span>
                        <button onClick={refetch} className="text-xs text-red-400 hover:text-red-200 underline">Retry</button>
                    </div>
                )}

                {/* ── Table card ─────────────────────────────────────────────────────── */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 backdrop-blur-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm min-w-[780px]">
                            <thead>
                                <tr className="border-b border-slate-800">
                                    {COLS.map(h => (
                                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-slate-600 first:pl-6 last:pr-6">
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>

                            <tbody>
                                {loading ? (
                                    [0, 1, 2, 3, 4].map(i => <SkeletonRow key={i} />)
                                ) : filtered.length === 0 ? (
                                    <EmptyState onAdd={() => setModal('add')} filtered={!!deferredSearch} />
                                ) : (
                                    filtered.map((emp, idx) => {
                                        const { initials, bg } = avatar(emp.name);
                                        return (
                                            <tr
                                                key={emp.id}
                                                className={`
                          border-b border-slate-800/40 last:border-0 transition-colors duration-150
                          hover:bg-slate-800/30 ${idx % 2 !== 0 ? 'bg-slate-900/20' : ''}
                          ${!emp.isActive ? 'opacity-60' : ''}
                        `}
                                            >
                                                {/* Employee */}
                                                <td className="px-4 py-3.5 pl-6">
                                                    <div className="flex items-center gap-3">
                                                        <div
                                                            className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                                                            style={{ background: bg }}
                                                        >
                                                            {initials}
                                                        </div>
                                                        <div>
                                                            <p className="font-medium text-slate-200 whitespace-nowrap leading-none">{emp.name}</p>
                                                            {emp.walletAddress && (
                                                                <p className="text-xs text-slate-700 font-mono mt-0.5 truncate max-w-[120px]" title={emp.walletAddress}>
                                                                    {emp.walletAddress}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* Email */}
                                                <td className="px-4 py-3.5 text-slate-400 truncate max-w-[180px]">
                                                    <a href={`mailto:${emp.email}`} className="hover:text-indigo-300 transition-colors">
                                                        {emp.email}
                                                    </a>
                                                </td>

                                {/* Job title */}
                                <td className="px-4 py-3.5 text-slate-300 whitespace-nowrap">
                                    {emp.jobTitle ?? <span className="text-slate-700">—</span>}
                                </td>                                                {/* Department */}
                                                <td className="px-4 py-3.5">
                                                    {emp.department ? (
                                                        <span className="inline-flex text-xs px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300">
                                                            {emp.department}
                                                        </span>
                                                    ) : <span className="text-slate-700">—</span>}
                                                </td>

                                                {/* Skills */}
                                                <td className="px-4 py-3.5">
                                                    <div className="flex flex-wrap gap-1 max-w-[160px]">
                                                        {emp.skills.slice(0, 3).map(s => (
                                                            <span key={s} className="text-xs px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                                                                {s}
                                                            </span>
                                                        ))}
                                                        {emp.skills.length > 3 && (
                                                            <span className="text-xs px-2 py-0.5 rounded-md bg-slate-800 text-slate-600">
                                                                +{emp.skills.length - 3}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* Joined */}
                                                <td className="px-4 py-3.5 text-xs text-slate-600 whitespace-nowrap">
                                                    {joinedLabel(emp.createdAt)}
                                                </td>

                                                {/* Status */}
                                                <td className="px-4 py-3.5">
                                                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${emp.isActive ? 'text-emerald-400' : 'text-slate-600'}`}>
                                                        <span className={`w-1.5 h-1.5 rounded-full ${emp.isActive ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                                                        {emp.isActive ? 'Active' : 'Inactive'}
                                                    </span>
                                                </td>

                                                {/* Actions */}
                                                <td className="px-4 py-3.5 pr-6">
                                                    <div className="flex items-center gap-1 justify-end">
                                                {/* Insights */}
                                                        <button
                                                            id={`btn-score-${emp.id}`}
                                                            onClick={() => navigate(`/insights?employeeId=${emp.id}`)}
                                                            className="p-1.5 rounded-lg text-slate-600 hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors duration-150"
                                                            title="View AI insights"
                                                        >
                                                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                                                            </svg>
                                                        </button>

                                                        {/* Edit */}
                                                        <button
                                                            id={`btn-edit-${emp.id}`}
                                                            onClick={() => { setSelected(emp); setModal('edit'); }}
                                                            className="p-1.5 rounded-lg text-slate-600 hover:text-slate-200 hover:bg-slate-800 transition-all"
                                                            title="Edit employee"
                                                        >
                                                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                                            </svg>
                                                        </button>

                                                        {/* Deactivate */}
                                                        {emp.isActive && (
                                                            <button
                                                                id={`btn-deactivate-${emp.id}`}
                                                                onClick={() => setDeactTarget(emp)}
                                                                className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
                                                                title="Deactivate employee"
                                                            >
                                                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                    <circle cx="12" cy="12" r="10" />
                                                                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                                                                </svg>
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Load-more footer */}
                    {!loading && filtered.length > 0 && (
                        <div className="px-6 py-3 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-600">
                            <span>Showing {filtered.length} of {total}</span>
                            {filtered.length < total && (
                                <button
                                    onClick={() => refetch()}
                                    className="text-indigo-400 hover:text-indigo-300 transition-colors"
                                >
                                    Load more
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </main>

            {/* ── Modals / Panels ──────────────────────────────────────────────────── */}

            {(modal === 'add' || modal === 'edit') && (
                <EmployeeModal
                    mode={modal}
                    initial={modal === 'edit' ? selected : null}
                    onSave={handleSave}
                    onClose={() => { setModal(null); setSelected(null); }}
                />
            )}

            {deactTarget && (
                <ConfirmDialog
                    name={deactTarget.name}
                    onConfirm={handleDeactivate}
                    onCancel={() => setDeactTarget(null)}
                    loading={deactLoading}
                />
            )}
        </div>
    );
}
