// components/dashboard/EmployeeCard.tsx
// Decision-centered employee card for the dashboard grid.
//
// Shows: Avatar + Name + Role | Productivity Score Ring |
//        Active Task Count | Primary Skill Tags (max 3) |
//        Assign Task + View Details actions.

import type { EmployeeStat } from '../../api/dashboard';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Deterministic hue from first character of name */
function nameHue(name: string): number {
    return (name.charCodeAt(0) * 37) % 360;
}

function initials(name: string): string {
    return name
        .split(' ')
        .map(p => p[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();
}

/** Map a 0–100 productivity score to a label + colour token */
function scoreToMeta(score: number | null): {
    label: string;
    color: string;         // ring stroke colour (Tailwind arbitrary)
    textColor: string;     // number text colour
    trackColor: string;    // background ring colour
} {
    if (score === null) {
        return { label: 'No data', color: '#475569', textColor: 'text-slate-500', trackColor: '#1e293b' };
    }
    if (score >= 90) return { label: 'Excellent', color: '#10b981', textColor: 'text-emerald-400', trackColor: '#064e3b' };
    if (score >= 80) return { label: 'Great',     color: '#8b5cf6', textColor: 'text-violet-400',  trackColor: '#2e1065' };
    if (score >= 70) return { label: 'Good',      color: '#38bdf8', textColor: 'text-sky-400',     trackColor: '#0c4a6e' };
    if (score >= 60) return { label: 'Fair',      color: '#f59e0b', textColor: 'text-amber-400',   trackColor: '#451a03' };
    return             { label: 'Low',      color: '#ef4444', textColor: 'text-red-400',     trackColor: '#450a0a' };
}

// ─── Score Ring ──────────────────────────────────────────────────────────────

interface ScoreRingProps {
    score: number | null;   // 0–100 or null
}

function ScoreRing({ score }: ScoreRingProps) {
    const SIZE = 56;
    const STROKE = 5;
    const R = (SIZE - STROKE) / 2;
    const CIRC = 2 * Math.PI * R;
    const pct = score !== null ? Math.min(Math.max(score, 0), 100) : 0;
    const dash = (pct / 100) * CIRC;

    const meta = scoreToMeta(score);

    return (
        <div className="relative flex-shrink-0" style={{ width: SIZE, height: SIZE }}>
            <svg
                width={SIZE}
                height={SIZE}
                viewBox={`0 0 ${SIZE} ${SIZE}`}
                className="-rotate-90"
                aria-hidden="true"
            >
                {/* Track */}
                <circle
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={R}
                    fill="none"
                    stroke={meta.trackColor}
                    strokeWidth={STROKE}
                />
                {/* Progress */}
                <circle
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={R}
                    fill="none"
                    stroke={meta.color}
                    strokeWidth={STROKE}
                    strokeLinecap="round"
                    strokeDasharray={`${dash} ${CIRC}`}
                    style={{ transition: 'stroke-dasharray 0.6s ease' }}
                />
            </svg>
            {/* Centre text */}
            <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
                <span className={`text-xs font-bold tabular-nums ${meta.textColor}`}>
                    {score !== null ? score : '—'}
                </span>
                <span className="text-[8px] text-slate-600 mt-0.5">score</span>
            </div>
        </div>
    );
}

// ─── EmployeeCard ─────────────────────────────────────────────────────────────

export interface EmployeeCardProps {
    emp: EmployeeStat & { skills?: string[] };
    onAssignTask: () => void;
    onViewDetails: () => void;
}

export function EmployeeCard({ emp, onAssignTask, onViewDetails }: EmployeeCardProps) {
    const hue = nameHue(emp.name);
    const activeTasks = emp.tasksAssigned - emp.tasksCompleted;
    const skills = (emp.skills ?? []).slice(0, 3);
    const meta = scoreToMeta(emp.productivityScore);

    return (
        <article
            className="
                flex flex-col gap-4
                rounded-xl border border-slate-800
                bg-slate-900
                p-4
                hover:border-slate-700
                transition-colors duration-150
            "
            aria-label={`Employee card for ${emp.name}`}
        >
            {/* ── Top row: avatar + name + role + score ring ── */}
            <div className="flex items-start justify-between gap-3">
                {/* Left: avatar + identity */}
                <div className="flex items-center gap-3 min-w-0">
                    {/* Initials avatar */}
                    <div
                        className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
                        style={{ background: `hsl(${hue}, 50%, 32%)` }}
                        aria-hidden="true"
                    >
                        {initials(emp.name)}
                    </div>

                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-100 truncate leading-tight">
                            {emp.name}
                        </p>
                        <p className="text-xs text-slate-500 truncate mt-0.5">
                            {emp.role ?? 'No role'}
                            {emp.department ? ` · ${emp.department}` : ''}
                        </p>
                    </div>
                </div>

                {/* Right: score ring */}
                <div className="flex-shrink-0 flex flex-col items-center gap-0.5">
                    <ScoreRing score={emp.productivityScore} />
                    <span className={`text-[9px] font-medium ${meta.textColor}`}>{meta.label}</span>
                </div>
            </div>

            {/* ── Middle row: active task count + active indicator ── */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                    {/* Task icon */}
                    <svg
                        className="w-3.5 h-3.5 text-slate-500"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                    >
                        <rect x="3" y="4" width="18" height="18" rx="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    <span className="text-xs text-slate-400">
                        <span className="font-semibold text-slate-200">{activeTasks}</span>
                        {' '}active
                        {' · '}
                        <span className="text-slate-500">{emp.tasksCompleted}/{emp.tasksAssigned} done</span>
                    </span>
                </div>

                {/* Active dot */}
                <span
                    className={`flex items-center gap-1 text-[10px] font-medium ${emp.isActive ? 'text-emerald-400' : 'text-slate-600'}`}
                    title={emp.isActive ? 'Active employee' : 'Inactive employee'}
                >
                    <span className={`w-1.5 h-1.5 rounded-full ${emp.isActive ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                    {emp.isActive ? 'Active' : 'Inactive'}
                </span>
            </div>

            {/* ── Skill tags ── */}
            {skills.length > 0 ? (
                <div className="flex flex-wrap gap-1.5" aria-label="Primary skills">
                    {skills.map(skill => (
                        <span
                            key={skill}
                            className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700/60"
                        >
                            {skill}
                        </span>
                    ))}
                </div>
            ) : (
                <div className="flex flex-wrap gap-1.5">
                    <span className="px-2 py-0.5 rounded-md text-[10px] text-slate-700 border border-slate-800 border-dashed">
                        No skills recorded
                    </span>
                </div>
            )}

            {/* ── Action buttons ── */}
            <div className="flex gap-2 pt-1 border-t border-slate-800/60">
                <button
                    onClick={() => onAssignTask()}
                    className="
                        flex-1 py-1.5 rounded-lg
                        border border-slate-700
                        text-xs font-medium text-slate-300
                        hover:border-indigo-500/40 hover:text-indigo-300 hover:bg-indigo-500/5
                        transition-colors duration-150
                    "
                    aria-label={`Assign task to ${emp.name}`}
                >
                    Assign Task
                </button>
                <button
                    onClick={() => onViewDetails()}
                    className="
                        flex-1 py-1.5 rounded-lg
                        border border-slate-700
                        text-xs font-medium text-slate-300
                        hover:border-slate-500 hover:text-slate-100 hover:bg-slate-800
                        transition-colors duration-150
                    "
                    aria-label={`View details for ${emp.name}`}
                >
                    View Details
                </button>
            </div>
        </article>
    );
}
