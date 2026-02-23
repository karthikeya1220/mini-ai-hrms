import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useWeb3Context } from '../../context/Web3Context';

interface SidebarProps {
    role: 'ADMIN' | 'EMPLOYEE';
}

// ─── Icons ────────────────────────────────────────────────────────────────────
function MenuIcon({ open }: { open: boolean }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
            {open ? (
                <>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                </>
            ) : (
                <>
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                </>
            )}
        </svg>
    );
}

// Icon-only versions for the tablet rail
const NAV_ICONS: Record<string, React.ReactNode> = {
    '/dashboard': (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
        </svg>
    ),
    '/employees': (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
        </svg>
    ),
    '/tasks': (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
            <polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
    ),
    '/insights': (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
    ),
    '/my': (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
        </svg>
    ),
};

export function Sidebar({ role }: SidebarProps) {
    const { logout, user, org } = useAuth();
    const { account, connect } = useWeb3Context();
    const location = useLocation();
    const isAdmin = role === 'ADMIN';

    const [open, setOpen] = useState(false);

    useEffect(() => {
        const id = setTimeout(() => setOpen(false), 0);
        return () => clearTimeout(id);
    }, [location.pathname]);

    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open]);

    const links = isAdmin
        ? [
            { to: '/dashboard', label: 'Dashboard' },
            { to: '/employees', label: 'Employees' },
            { to: '/tasks',     label: 'Tasks'      },
            { to: '/insights',  label: 'Insights'   },
        ]
        : [{ to: '/my', label: 'My Home' }];

    const initials = user?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';

    // ─── Full sidebar panel (used in mobile drawer + desktop) ─────────────────
    const fullPanel = (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Logo + org */}
            <div className="p-5 pb-4 flex-shrink-0">
                <div className="flex items-center gap-3 mb-7">
                    <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center flex-shrink-0">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 text-white">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                            <path d="M8 12h8M12 8v8" />
                        </svg>
                    </div>
                    <div className="min-w-0">
                        <p className="text-xs font-bold text-white leading-none truncate">{org?.name ?? 'Workspace'}</p>
                        <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider">{role}</p>
                    </div>
                </div>
                <nav className="space-y-0.5">
                    {links.map(link => (
                        <NavLink key={link.to} to={link.to}
                            className={({ isActive }) =>
                                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150
                                ${isActive
                                    ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 border border-transparent'}`
                            }
                        >
                            <span className="flex-shrink-0">{NAV_ICONS[link.to]}</span>
                            <span>{link.label}</span>
                        </NavLink>
                    ))}
                </nav>
            </div>

            {/* Footer */}
            <div className="mt-auto p-5 border-t border-slate-800 space-y-3 flex-shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold text-white border border-slate-700 flex-shrink-0">
                        {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-200 truncate">{user?.name ?? user?.email}</p>
                        <p className="text-[10px] text-slate-500 truncate">{user?.email}</p>
                    </div>
                </div>
                {!isAdmin && (
                    account ? (
                        <div className="px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/40">
                            <p className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">Wallet</p>
                            <p className="text-[10px] font-mono text-emerald-400 truncate">{account.slice(0, 6)}…{account.slice(-4)}</p>
                        </div>
                    ) : (
                        <button onClick={connect} className="w-full px-3 py-2 rounded-lg border border-slate-700 text-[10px] text-slate-500 hover:text-slate-300 hover:border-slate-600 transition-colors text-left">
                            🔗 Connect Wallet
                        </button>
                    )
                )}
                <button onClick={logout}
                    className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-red-400 hover:bg-red-500/5 transition-all border border-transparent hover:border-red-500/10">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 flex-shrink-0">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    Sign out
                </button>
            </div>
        </div>
    );

    // ─── Tablet icon-rail ──────────────────────────────────────────────────────
    const railPanel = (
        <div className="flex flex-col items-center h-full py-4 gap-1">
            {/* Logo mark */}
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center flex-shrink-0 mb-4">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 text-white">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                    <path d="M8 12h8M12 8v8" />
                </svg>
            </div>
            {/* Nav icons */}
            {links.map(link => (
                <NavLink key={link.to} to={link.to}
                    title={link.label}
                    className={({ isActive }) =>
                        `w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-150
                        ${isActive
                            ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/25'
                            : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800 border border-transparent'}`
                    }
                >
                    {NAV_ICONS[link.to]}
                </NavLink>
            ))}
            {/* Spacer + logout at bottom */}
            <div className="mt-auto flex flex-col items-center gap-3">
                {/* Avatar */}
                <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold text-white border border-slate-700" title={user?.name ?? user?.email}>
                    {initials}
                </div>
                <button onClick={logout} title="Sign out"
                    className="w-10 h-10 flex items-center justify-center rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-500/5 transition-all border border-transparent">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                </button>
            </div>
        </div>
    );

    return (
        <>
            {/* ── Desktop full sidebar (lg+) ──────────────────────────────── */}
            <aside className="hidden lg:flex w-60 xl:w-64 flex-col bg-slate-900 border-r border-slate-800 h-screen sticky top-0 flex-shrink-0">
                {fullPanel}
            </aside>

            {/* ── Tablet icon rail (md–lg) ────────────────────────────────── */}
            <aside className="hidden md:flex lg:hidden w-16 flex-col bg-slate-900 border-r border-slate-800 h-screen sticky top-0 flex-shrink-0">
                {railPanel}
            </aside>

            {/* ── Mobile top bar (< md) ───────────────────────────────────── */}
            <div className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-14 bg-slate-950/90 border-b border-slate-800 backdrop-blur-md">
                <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center flex-shrink-0">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5 text-white">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                            <path d="M8 12h8M12 8v8" />
                        </svg>
                    </div>
                    <span className="text-sm font-bold text-white truncate max-w-[140px]">{org?.name ?? 'Workspace'}</span>
                </div>
                <button onClick={() => setOpen(v => !v)}
                    className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
                    aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
                    <MenuIcon open={open} />
                </button>
            </div>

            {/* ── Mobile drawer backdrop ──────────────────────────────────── */}
            {open && (
                <div className="md:hidden fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm"
                    onClick={() => setOpen(false)} aria-hidden="true" />
            )}

            {/* ── Mobile drawer panel ─────────────────────────────────────── */}
            <aside
                className={`md:hidden fixed top-0 left-0 bottom-0 z-50 w-72 bg-slate-900 border-r border-slate-800 transform transition-transform duration-300 ease-out
                    ${open ? 'translate-x-0' : '-translate-x-full'}`}
                aria-label="Navigation"
            >
                <div className="flex items-center justify-between px-5 h-14 border-b border-slate-800 flex-shrink-0">
                    <span className="text-sm font-bold text-white truncate">{org?.name ?? 'Workspace'}</span>
                    <button onClick={() => setOpen(false)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
                        aria-label="Close menu">
                        <MenuIcon open={true} />
                    </button>
                </div>
                {fullPanel}
            </aside>
        </>
    );
}
