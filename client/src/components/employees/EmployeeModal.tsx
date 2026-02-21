// components/employees/EmployeeModal.tsx
// Slide-in modal for Add and Edit operations.
// Renders on a backdrop with focus-trap (Escape to close).

import { useEffect, useRef, useState, useId } from 'react';
import type { FormEvent } from 'react';
import type { Employee, EmployeeInput } from '../../api/employees';
import { Spinner } from '../ui';

// ─── Skills input ─────────────────────────────────────────────────────────────

function SkillsInput({
    value,
    onChange,
}: {
    value: string[];
    onChange: (v: string[]) => void;
}) {
    const [draft, setDraft] = useState('');
    const uid = useId();

    function add() {
        const trimmed = draft.trim().toLowerCase();
        if (trimmed && !value.includes(trimmed)) {
            onChange([...value, trimmed]);
        }
        setDraft('');
    }

    function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
        if (e.key === 'Backspace' && !draft) onChange(value.slice(0, -1));
    }

    return (
        <div>
            <label htmlFor={uid} className="field-label">Skills</label>
            <div className="flex flex-wrap gap-1.5 min-h-[44px] rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20 transition-all">
                {value.map(s => (
                    <span key={s} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-brand-500/15 border border-brand-500/30 text-xs text-brand-300">
                        {s}
                        <button
                            type="button"
                            onClick={() => onChange(value.filter(x => x !== s))}
                            className="ml-1 text-brand-400 hover:text-brand-200 transition-colors leading-none"
                            aria-label={`Remove ${s}`}
                        >
                            ×
                        </button>
                    </span>
                ))}
                <input
                    id={uid}
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={handleKey}
                    onBlur={add}
                    placeholder={value.length === 0 ? 'Type skill, press Enter…' : ''}
                    className="flex-1 min-w-[120px] bg-transparent text-sm text-slate-100 placeholder-slate-600 outline-none"
                />
            </div>
            <p className="mt-1 text-xs text-slate-600">Enter or comma to add · Backspace to remove</p>
        </div>
    );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface Props {
    mode: 'add' | 'edit';
    initial?: Employee | null;
    onSave: (data: EmployeeInput) => Promise<void>;
    onClose: () => void;
}

export function EmployeeModal({ mode, initial, onSave, onClose }: Props) {
    const uid = useId();

    const [name, setName] = useState(initial?.name ?? '');
    const [email, setEmail] = useState(initial?.email ?? '');
    const [role, setRole] = useState(initial?.role ?? '');
    const [dept, setDept] = useState(initial?.department ?? '');
    const [skills, setSkills] = useState<string[]>(initial?.skills ?? []);
    const [wallet, setWallet] = useState(initial?.walletAddress ?? '');
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [apiErr, setApiErr] = useState('');

    // Focus first input on open
    const firstRef = useRef<HTMLInputElement>(null);
    useEffect(() => { setTimeout(() => firstRef.current?.focus(), 80); }, []);

    // Escape to close
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    // ── Validation ──────────────────────────────────────────────────────────────
    function validate(): boolean {
        const e: Record<string, string> = {};
        if (!name.trim()) e.name = 'Name is required';
        if (!email.trim()) e.email = 'Email is required';
        else if (!/^\S+@\S+\.\S+$/.test(email)) e.email = 'Invalid email address';
        if (wallet.trim() && !/^0x[0-9a-fA-F]{40}$/.test(wallet.trim()))
            e.wallet = 'Must be a valid EVM address (0x + 40 hex chars)';
        setErrors(e);
        return Object.keys(e).length === 0;
    }

    // ── Submit ──────────────────────────────────────────────────────────────────
    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        if (!validate()) return;
        setSaving(true);
        setApiErr('');
        try {
            const payload: EmployeeInput = {
                name: name.trim(),
                email: email.trim().toLowerCase(),
                ...(role.trim() && { role: role.trim() }),
                ...(dept.trim() && { department: dept.trim() }),
                ...(skills.length && { skills }),
                ...(wallet.trim() && { walletAddress: wallet.trim() }),
            };
            await onSave(payload);
            onClose();
        } catch (err: unknown) {
            setApiErr(err instanceof Error ? err.message : 'Save failed. Please try again.');
        } finally {
            setSaving(false);
        }
    }

    const title = mode === 'add' ? 'Add employee' : 'Edit employee';

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm animate-fade-in"
                onClick={onClose}
                aria-hidden
            />

            {/* Panel */}
            <aside
                role="dialog"
                aria-modal
                aria-label={title}
                className="fixed inset-y-0 right-0 z-50 w-full max-w-md flex flex-col bg-slate-900 border-l border-slate-800 shadow-2xl animate-slide-up"
                style={{ animation: 'slideInRight 0.25s cubic-bezier(0.25,0.46,0.45,0.94)' }}
            >
                {/* Header */}
                <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
                    <h2 className="text-base font-semibold text-white">{title}</h2>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-all"
                        aria-label="Close"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </header>

                {/* API error */}
                {apiErr && (
                    <div className="mx-6 mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                        {apiErr}
                    </div>
                )}

                {/* Form */}
                <form id="emp-form" onSubmit={handleSubmit} noValidate className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                    {/* Name */}
                    <div>
                        <label htmlFor={`${uid}-name`} className="field-label">Full name *</label>
                        <input
                            id={`${uid}-name`}
                            ref={firstRef}
                            className={`input ${errors.name ? 'input-error' : ''}`}
                            placeholder="Priya Sharma"
                            value={name}
                            onChange={e => { setName(e.target.value); setErrors(x => ({ ...x, name: '' })); }}
                            disabled={saving}
                        />
                        {errors.name && <p className="field-error">{errors.name}</p>}
                    </div>

                    {/* Email */}
                    <div>
                        <label htmlFor={`${uid}-email`} className="field-label">Work email *</label>
                        <input
                            id={`${uid}-email`}
                            type="email"
                            className={`input ${errors.email ? 'input-error' : ''}`}
                            placeholder="priya@company.com"
                            value={email}
                            onChange={e => { setEmail(e.target.value); setErrors(x => ({ ...x, email: '' })); }}
                            disabled={saving}
                        />
                        {errors.email && <p className="field-error">{errors.email}</p>}
                    </div>

                    {/* Role / Department side-by-side */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label htmlFor={`${uid}-role`} className="field-label">Role</label>
                            <input
                                id={`${uid}-role`}
                                className="input"
                                placeholder="Frontend Engineer"
                                value={role}
                                onChange={e => setRole(e.target.value)}
                                disabled={saving}
                            />
                        </div>
                        <div>
                            <label htmlFor={`${uid}-dept`} className="field-label">Department</label>
                            <input
                                id={`${uid}-dept`}
                                className="input"
                                placeholder="Engineering"
                                value={dept}
                                onChange={e => setDept(e.target.value)}
                                disabled={saving}
                            />
                        </div>
                    </div>

                    {/* Skills */}
                    <SkillsInput value={skills} onChange={setSkills} />

                    {/* Wallet address */}
                    <div>
                        <label htmlFor={`${uid}-wallet`} className="field-label">
                            EVM wallet address <span className="text-slate-700 normal-case font-normal">(optional)</span>
                        </label>
                        <input
                            id={`${uid}-wallet`}
                            className={`input font-mono text-xs ${errors.wallet ? 'input-error' : ''}`}
                            placeholder="0x71C7656EC7ab88b098defB751B7401B5f6d8976F"
                            value={wallet}
                            onChange={e => { setWallet(e.target.value); setErrors(x => ({ ...x, wallet: '' })); }}
                            disabled={saving}
                            spellCheck={false}
                        />
                        {errors.wallet && <p className="field-error">{errors.wallet}</p>}
                    </div>
                </form>

                {/* Footer */}
                <footer className="px-6 py-4 border-t border-slate-800 flex gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 px-4 py-2.5 rounded-xl border border-slate-700 text-sm text-slate-400 hover:border-slate-600 hover:text-slate-200 transition-all"
                        disabled={saving}
                    >
                        Cancel
                    </button>
                    <button
                        id="btn-emp-save"
                        form="emp-form"
                        type="submit"
                        className="btn-primary flex-1"
                        disabled={saving}
                    >
                        {saving ? (
                            <span className="flex items-center justify-center gap-2">
                                <Spinner className="w-4 h-4" />
                                Saving…
                            </span>
                        ) : (
                            mode === 'add' ? 'Add employee' : 'Save changes'
                        )}
                    </button>
                </footer>
            </aside>

            {/* Slide-in keyframe — injected once */}
            <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0.6; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
        </>
    );
}
