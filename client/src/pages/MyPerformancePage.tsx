import { useAuth } from '../context/AuthContext';

export default function MyPerformancePage() {
    const { user } = useAuth();

    return (
        <div className="p-8">
            <header className="mb-8">
                <h1 className="text-2xl font-bold text-white tracking-tight">My Performance</h1>
                <p className="text-sm text-slate-500 mt-1">
                    Welcome back, {user?.name} · Personal productivity insights
                </p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Placeholder for employee-specific stats */}
                <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900 shadow-sm animate-pulse h-48 flex items-center justify-center text-slate-600 text-sm">
                    Productivity Score (Coming soon in Phase 2)
                </div>
                <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900 shadow-sm animate-pulse h-48 flex items-center justify-center text-slate-600 text-sm">
                    Recent Tasks (Coming soon in Phase 2)
                </div>
                <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900 shadow-sm animate-pulse h-48 flex items-center justify-center text-slate-600 text-sm">
                    Skill Analysis (Coming soon in Phase 2)
                </div>
            </div>
        </div>
    );
}
