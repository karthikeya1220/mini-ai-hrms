// components/dashboard/EmployeeCard.tsx
// Decision-centered employee card — score ring is the primary visual anchor.
//
// Card anatomy (top → bottom):
//  ┌─ HEADER:   Avatar · Name · Role/Dept · Active dot ──────────┐
//  ├─ PRIMARY:  Large score ring (72 px) centred + grade label ───┤
//  ├─ SECONDARY: Active task count · completion fraction ──────────┤
//  ├─ SKILLS:   Top 2 skill tags only ───────────────────────────┤
//  └─ ACTIONS:  Assign Task (ghost-indigo) · View Details (ghost) ┘

import type { EmployeeStat } from '../../api/dashboard';

// ─── Score colour map (unified palette) ──────────────────────────────────────

function scoreToMeta(score: number | null) {
    if (score === null) return { color: '#475569', textColor: 'text-slate-500', track: '#1e293b', grade: '—',  label: 'No data'   };
    if (score >= 90)    return { color: '#10b981', textColor: 'text-emerald-400', track: '#064e3b', grade: 'A+', label: 'Excellent' };
    if (score >= 80)    return { color: '#8b5cf6', textColor: 'text-violet-400',  track: '#2e1065', grade: 'A',  label: 'Great'     };
    if (score >= 70)    return { color: '#38bdf8', textColor: 'text-sky-400',     track: '#0c4a6e', grade: 'B',  label: 'Good'      };
    if (score >= 60)    return { color: '#f59e0b', textColor: 'text-amber-400',   track: '#451a03', grade: 'C',  label: 'Fair'      };
    return                     { color: '#ef4444', textColor: 'text-red-400',     track: '#450a0a', grade: 'D',  label: 'Low'       };
}

// ─── Score Ring — 72 px, centred, primary visual anchor ───────────────────

function ScoreRing({ score }: { score: number | null }) {
    const SIZE   = 72;
    const STROKE = 6;
    const R      = (SIZE - STROKE) / 2;
    const CIRC   = 2 * Math.PI * R;
    const pct    = score !== null ? Math.min(Math.max(score, 0), 100) : 0;
    const dash   = (pct / 100) * CIRC;
    const meta   = scoreToMeta(score);

    return (
        <div className="relative flex-shrink-0" style={{ width: SIZE, height: SIZE }}>
            <svg
                width={SIZE} height={SIZE}
                viewBox={`0 0 ${SIZE} ${SIZE}`}
                className="-rotate-90"
                aria-hidden="true"
            >
                <circle cx={SIZE / 2} cy={SIZE / 2} r={R}
                    fill="none" stroke={meta.track} strokeWidth={STROKE} />
                <circle cx={SIZE / 2} cy={SIZE / 2} r={R}
                    fill="none" stroke={meta.color} strokeWidth={STROKE}
                    strokeLinecap="round"
                    strokeDasharray={`${dash} ${CIRC}`}
                    style={{ transition: 'stroke-dasharray 0.7s cubic-bezier(0.4,0,0.2,1)' }}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center leading-none gap-0.5">
                <span className={`text-lg font-extrabold tabular-nums ${meta.textColor}`}>
                    {score !== null ? Math.round(score) : '—'}
                </span>
                <span className={`text-[9px] font-bold uppercase tracking-wider ${meta.textColor} opacity-70`}>
                    {meta.grade}
                </span>
            </div>
        </div>
    );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nameHue(name: string) { return (name.charCodeAt(0) * 37) % 360; }

function initials(name: string) {
    return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

// ─── EmployeeCard ─────────────────────────────────────────────────────────────

export interface EmployeeCardProps {
    emp: EmployeeStat & { skills?: string[] };
    onAssignTask: () => void;
    onViewDetails: () => void;
}

export function EmployeeCard({ emp, onAssignTask, onViewDetails }: EmployeeCardProps) {
    const hue         = nameHue(emp.name);
    const activeTasks = emp.tasksAssigned - emp.tasksCompleted;
    const skills      = (emp.skills ?? []).slice(0, 2); // top 2 only
    const meta        = scoreToMeta(emp.productivityScore);

    return (
        <article
            className="flex flex-col rounded-xl border border-slate-800 bg-slate-900 overflow-hidden hover:border-slate-700 transition-colors duration-150"
            aria-label={`Employee card for ${emp.name}`}
        >
            {/* ── HEADER ────────────────────────────────────────────────── */}
            <div className="flex items-center gap-3 px-4 pt-4 pb-0">
                {/* Avatar */}
                <div
                    className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    style={{ background: `hsl(${hue},50%,30%)` }}
                    aria-hidden="true"
                >
                    {initials(emp.name)}
                </div>

                {/* Identity */}
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-100 leading-tight truncate">
                        {emp.name}
                    </p>
                    <p className="text-[11px] text-slate-500 leading-tight truncate mt-0.5">
                        {emp.jobTitle ?? 'No role'}
                        {emp.department ? ` · ${emp.department}` : ''}
                    </p>
                </div>

                {/* Active status */}
                <span
                    className={`flex-shrink-0 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider ${emp.isActive ? 'text-emerald-500' : 'text-slate-600'}`}
                    title={emp.isActive ? 'Active' : 'Inactive'}
                >
                    <span className={`w-1.5 h-1.5 rounded-full ${emp.isActive ? 'bg-emerald-500' : 'bg-slate-700'}`} />
                    {emp.isActive ? 'Active' : 'Off'}
                </span>
            </div>

            {/* ── PRIMARY METRIC — score ring ────────────────────────────── */}
            <div className="flex flex-col items-center gap-1 pt-5 pb-2">
                <ScoreRing score={emp.productivityScore} />
                <span className={`text-[10px] font-medium ${meta.textColor} mt-1`}>
                    {meta.label}
                </span>
            </div>

            {/* ── SECONDARY INFO ────────────────────────────────────────── */}
            <div className="mx-4 mt-2 mb-3 grid grid-cols-2 gap-2">
                <div className="flex flex-col items-center rounded-lg border border-slate-800 bg-slate-800/40 py-2">
                    <span className="text-base font-bold text-slate-100 tabular-nums">{activeTasks}</span>
                    <span className="text-[9px] text-slate-500 uppercase tracking-wider mt-0.5">Active tasks</span>
                </div>
                <div className="flex flex-col items-center rounded-lg border border-slate-800 bg-slate-800/40 py-2">
                    <span className="text-base font-bold text-slate-100 tabular-nums">
                        {Math.round(emp.completionRate * 100)}%
                    </span>
                    <span className="text-[9px] text-slate-500 uppercase tracking-wider mt-0.5">Completion</span>
                </div>
            </div>

            {/* ── SKILLS ────────────────────────────────────────────────── */}
            <div className="flex flex-wrap gap-1.5 px-4 mb-4 min-h-[22px]">
                {skills.length > 0 ? (
                    skills.map(skill => (
                        <span
                            key={skill}
                            className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700/60"
                        >
                            {skill}
                        </span>
                    ))
                ) : (
                    <span className="px-2 py-0.5 rounded-md text-[10px] text-slate-700 border border-dashed border-slate-800">
                        No skills recorded
                    </span>
                )}
            </div>

            {/* ── ACTIONS ───────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 border-t border-slate-800">
                <button
                    type="button"
                    onClick={onAssignTask}
                    className="py-2.5 text-xs font-medium text-slate-400 hover:text-indigo-300 hover:bg-indigo-500/5 border-r border-slate-800 transition-colors duration-150"
                    aria-label={`Assign task to ${emp.name}`}
                >
                    Assign Task
                </button>
                <button
                    type="button"
                    onClick={onViewDetails}
                    className="py-2.5 text-xs font-medium text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors duration-150"
                    aria-label={`View details for ${emp.name}`}
                >
                    View Details
                </button>
            </div>
        </article>
    );
}
