// =============================================================================
// components/layout/AppNav.tsx
//
// Shared top navigation bar used by DashboardPage, EmployeesPage, and
// TaskBoardPage.
//
// Role-aware nav links:
//   ADMIN   — Dashboard · Employees · Tasks  (all three)
//   EMPLOYEE — Tasks only
//
// Role badge:
//   A small pill showing the current user's role is rendered next to the
//   org name so the user always knows which context they are in.
//
// Usage:
//   <AppNav currentPage="tasks" actions={<button>New task</button>} />
// =============================================================================

import { useAuth } from '../../context/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AppPage = 'dashboard' | 'employees' | 'tasks';

interface AppNavProps {
    /** Which nav link is currently active (rendered as non-anchor highlight). */
    currentPage: AppPage;
    /**
     * Slot for page-specific right-side action buttons (e.g. "New task",
     * "Refresh", "Add employee").  Rendered between the right edge of the
     * nav and the Sign out button.
     */
    actions?: React.ReactNode;
}

// ─── SVG helpers ─────────────────────────────────────────────────────────────

const LogoIcon = () => (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        className="w-4 h-4 text-white"
    >
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
        <path d="M8 12h8M12 8v8" />
    </svg>
);

const LogoutIcon = () => (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-4 h-4"
    >
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
);

// ─── Role pill ────────────────────────────────────────────────────────────────

function RolePill({ role }: { role: 'ADMIN' | 'EMPLOYEE' }) {
    const isAdmin = role === 'ADMIN';
    return (
        <span
            className={`
                inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold
                tracking-wide border select-none
                ${isAdmin
                    ? 'bg-brand-500/15 border-brand-500/30 text-brand-300'
                    : 'bg-slate-700/50 border-slate-600/50 text-slate-400'}
            `}
        >
            {isAdmin ? (
                /* shield icon */
                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
            ) : (
                /* person icon */
                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                </svg>
            )}
            {role}
        </span>
    );
}

// ─── NavLink ──────────────────────────────────────────────────────────────────

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
    if (active) {
        return (
            <span className="text-slate-200 font-semibold px-3 py-1.5 bg-slate-800 rounded-lg shadow-sm">
                {label}
            </span>
        );
    }
    return (
        <a
            href={href}
            className="text-slate-500 hover:text-slate-300 transition-colors px-3 py-1.5 rounded-lg hover:bg-slate-800 font-medium"
        >
            {label}
        </a>
    );
}

// ─── AppNav ───────────────────────────────────────────────────────────────────

export function AppNav({ currentPage, actions }: AppNavProps) {
    const { user, org, isAdmin, logout } = useAuth();

    return (
        <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md">
            <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">

                {/* ── Left: brand + nav ─────────────────────────────────────── */}
                <div className="flex items-center gap-4">

                    {/* Brand */}
                    <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 shadow-sm flex items-center justify-center flex-shrink-0">
                            <LogoIcon />
                        </div>
                        <div className="hidden md:block">
                            <div className="flex items-center gap-2 leading-none">
                                <p className="text-xs font-bold text-white">{org?.name ?? 'Workspace'}</p>
                                {user?.role && <RolePill role={user.role} />}
                            </div>
                            <p className="text-[10px] text-slate-500 mt-0.5">
                                {user?.name ? user.name : user?.email}
                            </p>
                        </div>
                    </div>

                    {/* Nav — role-gated */}
                    <nav
                        className="flex items-center gap-1 text-sm bg-slate-900/50 p-1 rounded-xl border border-slate-800/50"
                        aria-label="Main navigation"
                    >
                        {/* Dashboard and Employees — ADMIN only */}
                        {isAdmin && (
                            <NavLink
                                href="/dashboard"
                                label="Dashboard"
                                active={currentPage === 'dashboard'}
                            />
                        )}
                        {isAdmin && (
                            <NavLink
                                href="/employees"
                                label="Employees"
                                active={currentPage === 'employees'}
                            />
                        )}
                        {/* Tasks — everyone */}
                        <NavLink
                            href="/tasks"
                            label="Tasks"
                            active={currentPage === 'tasks'}
                        />
                    </nav>
                </div>

                {/* ── Right: action slot + sign out ─────────────────────────── */}
                <div className="flex items-center gap-2">
                    {actions}
                    <button
                        onClick={logout}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 text-xs text-slate-400 hover:border-red-500/50 hover:text-red-400 transition-all"
                        title="Sign out"
                    >
                        <LogoutIcon />
                        <span className="hidden sm:inline">Sign out</span>
                    </button>
                </div>
            </div>
        </header>
    );
}
