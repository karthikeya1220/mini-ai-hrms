// components/tasks/TaskModal.tsx
// Add-task slide-in drawer.
// Fields: title*, description, priority (low/medium/high), complexity (1-5),
//         required skills (tag input), assigned employee (select), due date.

import { useEffect, useRef, useState, useId } from 'react';
import type { FormEvent } from 'react';
import type { CreateTaskInput, TaskPriority } from '../../api/tasks';
import type { Employee } from '../../api/employees';
import { Spinner } from '../ui';

// ─── Skill tag input (re-uses same UX as EmployeeModal) ──────────────────────

function SkillsInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
    const [draft, setDraft] = useState('');
    const uid = useId();
    function add() {
        const t = draft.trim().toLowerCase();
        if (t && !value.includes(t)) onChange([...value, t]);
        setDraft('');
    }
    function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
        if (e.key === 'Backspace' && !draft) onChange(value.slice(0, -1));
    }
    return (
        <div>
            <label htmlFor={uid} className="field-label">Required skills</label>
            <div className="flex flex-wrap gap-1.5 min-h-[44px] rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20 transition-all">
                {value.map(s => (
                    <span key={s} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-brand-500/15 border border-brand-500/30 text-xs text-brand-300">
                        {s}
                        <button type="button" onClick={() => onChange(value.filter(x => x !== s))} className="ml-1 text-brand-400 hover:text-brand-200">×</button>
                    </span>
                ))}
                <input
                    id={uid}
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={onKey}
                    onBlur={add}
                    placeholder={value.length === 0 ? 'Type skill, press Enter…' : ''}
                    className="flex-1 min-w-[120px] bg-transparent text-sm text-slate-100 placeholder-slate-600 outline-none"
                />
            </div>
            <p className="mt-1 text-xs text-slate-600">Enter or comma to add</p>
        </div>
    );
}

// ─── Complexity picker ────────────────────────────────────────────────────────

function ComplexityPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
    const labels = ['', 'Trivial', 'Simple', 'Medium', 'Complex', 'Expert'];
    return (
        <div>
            <label className="field-label">
                Complexity <span className="text-slate-600 normal-case font-normal">— {labels[value]}</span>
            </label>
            <div className="flex gap-2 mt-1">
                {[1, 2, 3, 4, 5].map(n => (
                    <button
                        key={n}
                        type="button"
                        onClick={() => onChange(n)}
                        className={`
              flex-1 py-2 rounded-lg border text-sm font-bold transition-all
              ${value === n
                                ? 'border-brand-500 bg-brand-500/20 text-brand-300'
                                : 'border-slate-700 text-slate-600 hover:border-slate-600 hover:text-slate-400'
                            }
            `}
                    >
                        {n}
                    </button>
                ))}
            </div>
        </div>
    );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface Props {
    onSave: (data: CreateTaskInput) => Promise<void>;
    onClose: () => void;
    employees: Employee[];
}

export function TaskModal({ onSave, onClose, employees }: Props) {
    const uid = useId();

    const [title, setTitle] = useState('');
    const [desc, setDesc] = useState('');
    const [priority, setPriority] = useState<TaskPriority>('medium');
    const [complexity, setComplexity] = useState(3);
    const [skills, setSkills] = useState<string[]>([]);
    const [assignedTo, setAssignedTo] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [apiErr, setApiErr] = useState('');

    const firstRef = useRef<HTMLInputElement>(null);
    useEffect(() => { setTimeout(() => firstRef.current?.focus(), 80); }, []);
    useEffect(() => {
        const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [onClose]);

    function validate(): boolean {
        const e: Record<string, string> = {};
        if (!title.trim()) e.title = 'Title is required';
        setErrors(e);
        return Object.keys(e).length === 0;
    }

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        if (!validate()) return;
        setSaving(true);
        setApiErr('');
        try {
            const payload: CreateTaskInput = {
                title: title.trim(),
                priority,
                complexityScore: complexity,
                ...(desc.trim() && { description: desc.trim() }),
                ...(skills.length && { requiredSkills: skills }),
                ...(assignedTo && { assignedTo }),
                ...(dueDate && { dueDate: new Date(dueDate).toISOString() }),
            };
            await onSave(payload);
            onClose();
        } catch (err: unknown) {
            setApiErr(err instanceof Error ? err.message : 'Failed to create task.');
        } finally {
            setSaving(false);
        }
    }

    const PRIORITIES: { val: TaskPriority; label: string; dot: string }[] = [
        { val: 'low', label: 'Low', dot: 'bg-slate-500' },
        { val: 'medium', label: 'Medium', dot: 'bg-amber-500' },
        { val: 'high', label: 'High', dot: 'bg-red-500' },
    ];

    return (
        <>
            <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
            <aside
                role="dialog" aria-modal aria-label="Add task"
                className="fixed inset-y-0 right-0 z-50 w-full max-w-md flex flex-col bg-slate-900 border-l border-slate-800 shadow-2xl"
                style={{ animation: 'slideInRight 0.25s cubic-bezier(0.25,0.46,0.45,0.94)' }}
            >
                {/* Header */}
                <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
                    <h2 className="text-base font-semibold text-white">New task</h2>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-all" aria-label="Close">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </header>

                {apiErr && (
                    <div className="mx-6 mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{apiErr}</div>
                )}

                <form id="task-form" onSubmit={handleSubmit} noValidate className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                    {/* Title */}
                    <div>
                        <label htmlFor={`${uid}-title`} className="field-label">Title *</label>
                        <input
                            id={`${uid}-title`}
                            ref={firstRef}
                            className={`input ${errors.title ? 'input-error' : ''}`}
                            placeholder="Implement login screen"
                            value={title}
                            onChange={e => { setTitle(e.target.value); setErrors(x => ({ ...x, title: '' })); }}
                            disabled={saving}
                        />
                        {errors.title && <p className="field-error">{errors.title}</p>}
                    </div>

                    {/* Description */}
                    <div>
                        <label htmlFor={`${uid}-desc`} className="field-label">Description</label>
                        <textarea
                            id={`${uid}-desc`}
                            rows={3}
                            className="input resize-none"
                            placeholder="What needs to be done?"
                            value={desc}
                            onChange={e => setDesc(e.target.value)}
                            disabled={saving}
                        />
                    </div>

                    {/* Priority */}
                    <div>
                        <label className="field-label">Priority</label>
                        <div className="flex gap-2 mt-1">
                            {PRIORITIES.map(p => (
                                <button
                                    key={p.val}
                                    type="button"
                                    onClick={() => setPriority(p.val)}
                                    className={`
                    flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border text-sm transition-all
                    ${priority === p.val
                                            ? 'border-brand-500 bg-brand-500/20 text-brand-200 font-semibold'
                                            : 'border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300'
                                        }
                  `}
                                >
                                    <span className={`w-2 h-2 rounded-full ${p.dot}`} />
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Complexity */}
                    <ComplexityPicker value={complexity} onChange={setComplexity} />

                    {/* Skills */}
                    <SkillsInput value={skills} onChange={setSkills} />

                    {/* Assign to */}
                    <div>
                        <label htmlFor={`${uid}-assign`} className="field-label">Assign to</label>
                        <select
                            id={`${uid}-assign`}
                            value={assignedTo}
                            onChange={e => setAssignedTo(e.target.value)}
                            disabled={saving}
                            className="input"
                        >
                            <option value="">— Unassigned —</option>
                            {employees.filter(e => e.isActive).map(e => (
                                <option key={e.id} value={e.id}>{e.name} {e.role ? `(${e.role})` : ''}</option>
                            ))}
                        </select>
                    </div>

                    {/* Due date */}
                    <div>
                        <label htmlFor={`${uid}-due`} className="field-label">Due date</label>
                        <input
                            id={`${uid}-due`}
                            type="date"
                            className="input"
                            value={dueDate}
                            onChange={e => setDueDate(e.target.value)}
                            disabled={saving}
                            min={new Date().toISOString().split('T')[0]}
                        />
                    </div>
                </form>

                <footer className="px-6 py-4 border-t border-slate-800 flex gap-3">
                    <button
                        type="button" onClick={onClose}
                        className="flex-1 px-4 py-2.5 rounded-xl border border-slate-700 text-sm text-slate-400 hover:border-slate-600 hover:text-slate-200 transition-all"
                        disabled={saving}
                    >
                        Cancel
                    </button>
                    <button
                        id="btn-task-save"
                        form="task-form"
                        type="submit"
                        className="btn-primary flex-1"
                        disabled={saving}
                    >
                        {saving ? (
                            <span className="flex items-center justify-center gap-2">
                                <Spinner className="w-4 h-4" />Saving…
                            </span>
                        ) : 'Add task'}
                    </button>
                </footer>
            </aside>

            <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0.6; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
        </>
    );
}
