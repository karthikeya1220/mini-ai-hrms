import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useWeb3Context } from '../../context/Web3Context';

interface SidebarProps {
    role: 'ADMIN' | 'EMPLOYEE';
}

export function Sidebar({ role }: SidebarProps) {
    const { logout, user, org } = useAuth();
    const { account, connect } = useWeb3Context();
    const isAdmin = role === 'ADMIN';

    const links = isAdmin
        ? [
            { to: '/dashboard', label: 'Dashboard', icon: '📊' },
            { to: '/employees', label: 'Employees', icon: '👤' },
            { to: '/tasks', label: 'Tasks', icon: '✅' },
            { to: '/insights', label: 'Insights', icon: '🧠' },
        ]
        : [
            { to: '/my', label: 'My Home', icon: '🏠' },
        ];

    return (
        <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col h-screen sticky top-0">
            <div className="p-6">
                <div className="flex items-center gap-3 mb-8">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 text-white">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                            <path d="M8 12h8M12 8v8" />
                        </svg>
                    </div>
                    <div>
                        <p className="text-xs font-bold text-white leading-none">{org?.name ?? 'Workspace'}</p>
                        <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider">{role}</p>
                    </div>
                </div>

                <nav className="space-y-1">
                    {links.map((link) => (
                        <NavLink
                            key={link.to}
                            to={link.to}
                            className={({ isActive }) => `
                flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all
                ${isActive
                                    ? 'bg-brand-500/10 text-brand-400 border border-brand-500/20'
                                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-transparent'}
              `}
                        >
                            <span className="text-lg">{link.icon}</span>
                            {link.label}
                        </NavLink>
                    ))}
                </nav>
            </div>

            <div className="mt-auto p-6 border-t border-slate-800">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold text-white border border-slate-700">
                        {user?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-200 truncate">{user?.name ?? user?.email}</p>
                        <p className="text-[10px] text-slate-500 truncate">{user?.email}</p>
                    </div>
                </div>

                {/* Wallet — shown for employees when MetaMask is available */}
                {!isAdmin && (
                    <div className="mb-3">
                        {account ? (
                            <div className="px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/40">
                                <p className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">Wallet</p>
                                <p className="text-[10px] font-mono text-emerald-400 truncate">
                                    {account.slice(0, 6)}…{account.slice(-4)}
                                </p>
                            </div>
                        ) : (
                            <button
                                onClick={connect}
                                className="w-full px-3 py-2 rounded-lg border border-slate-700 text-[10px] text-slate-500 hover:text-slate-300 hover:border-slate-600 transition-colors text-left"
                            >
                                🔗 Connect Wallet
                            </button>
                        )}
                    </div>
                )}

                <button
                    onClick={logout}
                    className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-red-400 hover:bg-neutral-800 transition-all border border-transparent"
                >
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
                    Sign out
                </button>
            </div>
        </aside>
    );
}
