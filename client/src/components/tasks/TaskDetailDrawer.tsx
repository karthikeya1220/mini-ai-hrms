// components/tasks/TaskDetailDrawer.tsx
// Single right-side drawer that shows full task detail.
//
// Contains:
//  • Full task info (title, description, skills, complexity, due date)
//  • Assignee info
//  • Status controls (forward-FSM only)
//  • Blockchain verification status
//  • AI Recommendation section (ADMIN only) — loaded on demand, inline
//
// Overlay rule: this is the ONLY overlay that can be open at once.
// Opening it from the board closes any previously open panel.

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Task, TaskStatus } from '../../api/tasks';
import { NEXT_STATUS } from '../../api/tasks';
import { useAuth } from '../../context/AuthContext';
import { Spinner } from '../ui';
import type { Employee } from '../../api/employees';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_META: Record<string, { dot: string; label: string }> = {
    low:    { dot: 'bg-slate-500',  label: 'Low'    },
    medium: { dot: 'bg-amber-500',  label: 'Medium' },
    high:   { dot: 'bg-red-500',    label: 'High'   },
};

const STATUS_LABELS: Record<TaskStatus, string> = {
    ASSIGNED:    'Assigned',
    IN_PROGRESS: 'In Progress',
    COMPLETED:   'Completed',
};

const COMPLEXITY_LABELS: Record<number, string> = {
    1: 'Trivial', 2: 'Simple', 3: 'Medium', 4: 'Complex', 5: 'Expert',
};

function dueDateStyle(iso: string | null): string {
    if (!iso) return 'text-slate-500';
    const diff = new Date(iso).getTime() - Date.now();
    if (diff < 0)              return 'text-red-400';
    if (diff < 86_400_000 * 2) return 'text-amber-400';
    return 'text-slate-400';
}

function dueDateLabel(iso: string | null): string {
    if (!iso) return 'No due date';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function MiniAvatar({ name }: { name?: string }) {
    if (!name) return null;
    const initials = name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
    const hue = (name.charCodeAt(0) * 37) % 360;
    return (
        <span
            className="inline-flex w-7 h-7 rounded-full items-center justify-center text-xs font-bold text-white flex-shrink-0"
            style={{ background: `hsl(${hue},55%,32%)` }}
            aria-hidden="true"
        >
            {initials}
        </span>
    );
}

function ComplexityDots({ score }: { score: number }) {
    return (
        <span className="flex gap-1" aria-label={`Complexity ${score} of 5`}>
            {Array.from({ length: 5 }, (_, i) => (
                <span
                    key={i}
                    className={`inline-block w-2 h-2 rounded-full ${i < score ? 'bg-lime-400' : 'bg-white/10'}`}
                />
            ))}
        </span>
    );
}

// ─── Status control inside drawer ─────────────────────────────────────────────

interface StatusControlProps {
    task: Task;
    onMove: (id: string, status: TaskStatus) => Promise<void> | void;
    moving: boolean;
}

function StatusControl({ task, onMove, moving }: StatusControlProps) {
    const next = NEXT_STATUS[task.status];
    if (!next) {
        // Completed — no more transitions
        return (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                Completed
            </span>
        );
    }

    const nextLabel = STATUS_LABELS[next];

    return (
        <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-slate-500">
                Current: <span className="text-slate-300 font-medium">{STATUS_LABELS[task.status]}</span>
            </span>
            <button
                onClick={() => onMove(task.id, next)}
                disabled={moving}
                className="
                    flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                    border border-white/10 text-xs font-medium text-slate-300
                    hover:border-lime-400/60 hover:text-lime-400 hover:bg-lime-400/5
                    disabled:opacity-40 disabled:cursor-not-allowed
                    transition-colors
                "
                aria-label={`Move to ${nextLabel}`}
            >
                {moving ? <Spinner className="w-3 h-3" /> : null}
                Move to {nextLabel} →
            </button>
        </div>
    );
}

// ─── Section heading ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 mb-1.5">
            {children}
        </p>
    );
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

export interface TaskDetailDrawerProps {
    task: Task;
    assignee: Employee | undefined;
    onClose: () => void;
    onMove: (id: string, status: TaskStatus) => Promise<void> | void;
    moving: boolean;
}

export function TaskDetailDrawer({
    task, assignee, onClose, onMove, moving,
}: TaskDetailDrawerProps) {
    const { isAdmin } = useAuth();
    const navigate = useNavigate();
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const p = PRIORITY_META[task.priority] ?? PRIORITY_META.medium;

    // Focus the close button on mount
    useEffect(() => {
        const t = setTimeout(() => closeButtonRef.current?.focus(), 60);
        return () => clearTimeout(t);
    }, []);

    // Escape key closes
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose();
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden="true"
            />

            {/* Drawer panel — bottom sheet on mobile, right panel on md+ */}
            <aside
                role="dialog"
                aria-modal
                aria-label={`Task detail: ${task.title}`}
                className="
                    fixed z-50 flex flex-col bg-[#0a0a0a] shadow-2xl
                    inset-x-0 bottom-0 rounded-t-2xl border-t border-white/8 h-[90dvh]
                    md:inset-y-0 md:right-0 md:left-auto md:bottom-auto
                    md:h-full md:w-full md:max-w-md
                    md:border-l md:border-t-0 md:rounded-none
                "
                style={{ animation: 'slideInRight 0.22s ease both' }}
            >
                {/* ── Header ── */}
                <header className="flex items-center justify-between px-5 py-4 border-b border-white/8 flex-shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className={`flex-shrink-0 w-2.5 h-2.5 rounded-full ${p.dot}`} title={p.label} aria-label={`Priority: ${p.label}`} />
                        <h2 className="text-sm font-semibold text-white truncate">{task.title}</h2>
                    </div>
                    <button
                        ref={closeButtonRef}
                        onClick={onClose}
                        className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors ml-2"
                        aria-label="Close task detail"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </header>

                {/* ── Scrollable body ── */}
                <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">

                    {/* Description */}
                    {task.description && (
                        <div>
                            <SectionLabel>Description</SectionLabel>
                            <p className="text-sm text-slate-300 leading-relaxed">{task.description}</p>
                        </div>
                    )}

                    {/* Status control */}
                    <div>
                        <SectionLabel>Status</SectionLabel>
                        <StatusControl task={task} onMove={onMove} moving={moving} />
                    </div>

                    {/* Meta grid */}
                    <div className="grid grid-cols-2 gap-4">
                        {/* Priority */}
                        <div>
                            <SectionLabel>Priority</SectionLabel>
                            <span className="flex items-center gap-1.5 text-xs text-slate-300">
                                <span className={`w-2 h-2 rounded-full ${p.dot}`} />
                                {p.label}
                            </span>
                        </div>

                        {/* Due date */}
                        <div>
                            <SectionLabel>Due Date</SectionLabel>
                            <span className={`text-xs font-medium ${dueDateStyle(task.dueDate)}`}>
                                {dueDateLabel(task.dueDate)}
                            </span>
                        </div>

                        {/* Complexity */}
                        <div>
                            <SectionLabel>Complexity</SectionLabel>
                            <div className="flex items-center gap-2">
                                <ComplexityDots score={task.complexityScore} />
                                <span className="text-xs text-slate-500">
                                    {COMPLEXITY_LABELS[task.complexityScore] ?? task.complexityScore}
                                </span>
                            </div>
                        </div>

                        {/* Created */}
                        <div>
                            <SectionLabel>Created</SectionLabel>
                            <span className="text-xs text-slate-500">
                                {new Date(task.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                        </div>
                    </div>

                    {/* Required skills */}
                    {task.requiredSkills.length > 0 && (
                        <div>
                            <SectionLabel>Required Skills</SectionLabel>
                            <div className="flex flex-wrap gap-1.5">
                                {task.requiredSkills.map(s => (
                                    <span
                                        key={s}
                                        className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-lime-400/10 border border-lime-400/20 text-lime-400"
                                    >
                                        {s}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Assignee */}
                    <div>
                        <SectionLabel>Assignee</SectionLabel>
                        {assignee ? (
                            <div className="flex items-center gap-2">
                                <MiniAvatar name={assignee.name} />
                                <div>
                                    <p className="text-xs font-semibold text-slate-200">{assignee.name}</p>
                                    <p className="text-[10px] text-slate-500">{assignee.jobTitle ?? 'Employee'}{assignee.department ? ` · ${assignee.department}` : ''}</p>
                                </div>
                            </div>
                        ) : (
                            <p className="text-xs text-slate-600">Unassigned</p>
                        )}
                    </div>

                    {/* Blockchain verification */}
                    <div>
                        <SectionLabel>Blockchain Verification</SectionLabel>
                        {task.txHash ? (
                            <div className="flex items-center gap-2 flex-wrap">
                                {/* Verified badge */}
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                    Verified
                                </span>
                                {/* PolygonScan link */}
                                <a
                                    href={`https://amoy.polygonscan.com/tx/${task.txHash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-[10px] tabular-nums text-slate-500 hover:text-lime-400 border border-white/8 hover:border-lime-400/40 rounded px-1.5 py-0.5 transition-colors"
                                    aria-label="View transaction on PolygonScan"
                                >
                                    {task.txHash.slice(0, 8)}…{task.txHash.slice(-6)}
                                    <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                        <polyline points="15 3 21 3 21 9" />
                                        <line x1="10" y1="14" x2="21" y2="3" />
                                    </svg>
                                </a>
                            </div>
                        ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-white/5 border border-white/10 text-slate-500">
                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="12" y1="8" x2="12" y2="12" />
                                    <line x1="12" y1="16" x2="12.01" y2="16" />
                                </svg>
                                Not Verified
                            </span>
                        )}
                    </div>

                    {/* AI Recommendation — Admin only: navigate to Insights */}
                    {isAdmin && task.status !== 'COMPLETED' && (
                        <div>
                            <SectionLabel>AI Recommendation</SectionLabel>
                            <button
                                onClick={() => {
                                    onClose();
                                    navigate(`/insights?taskId=${task.id}`);
                                }}
                                className="
                                    flex items-center gap-1.5 text-xs font-medium
                                    text-lime-400 hover:text-lime-300
                                    border border-lime-400/20 bg-lime-400/5
                                    hover:bg-lime-400/10 hover:border-lime-400/40
                                    px-3 py-1.5 rounded-lg transition-colors duration-150
                                "
                            >
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                                </svg>
                                View in Insights →
                            </button>
                        </div>
                    )}
                </div>
            </aside>

            <style>{`
                @keyframes slideInRight {
                    from { transform: translateX(100%); opacity: 0.7; }
                    to   { transform: translateX(0);    opacity: 1;   }
                }
            `}</style>
        </>
    );
}
