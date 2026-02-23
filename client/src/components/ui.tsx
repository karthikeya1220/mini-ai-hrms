// Shared UI atoms used across auth pages.

import { type InputHTMLAttributes, forwardRef } from 'react';

// ─── FloatingInput ────────────────────────────────────────────────────────────
// Accessible labelled input with inline error display.

interface FloatingInputProps extends InputHTMLAttributes<HTMLInputElement> {
    label: string;
    error?: string;
    id: string;
}

export const FloatingInput = forwardRef<HTMLInputElement, FloatingInputProps>(
    ({ label, error, id, className = '', ...rest }, ref) => (
        <div className="space-y-1">
            <label htmlFor={id} className="field-label">
                {label}
            </label>
            <input
                ref={ref}
                id={id}
                className={`input ${error ? 'input-error' : ''} ${className}`}
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-error` : undefined}
                {...rest}
            />
            {error && (
                <p id={`${id}-error`} className="field-error" role="alert">
                    <svg className="w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm.75 4.25a.75.75 0 0 0-1.5 0v3.5a.75.75 0 0 0 1.5 0v-3.5zM8 11a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
                    </svg>
                    {error}
                </p>
            )}
        </div>
    ),
);
FloatingInput.displayName = 'FloatingInput';

// ─── Spinner ──────────────────────────────────────────────────────────────────

export function Spinner({ className = 'w-5 h-5' }: { className?: string }) {
    return (
        <svg
            className={`animate-spin ${className}`}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
        >
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
            <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
        </svg>
    );
}

// ─── Logo mark ────────────────────────────────────────────────────────────────

export function LogoMark() {
    return (
        <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-600 mb-6">
            {/* Stylised HR / brain mark */}
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                <path d="M8 12h8M12 8v8" />
            </svg>
        </div>
    );
}

// ─── OrDivider ────────────────────────────────────────────────────────────────

export function OrDivider() {
    return (
        <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-slate-800" />
            <span className="text-xs text-slate-600 font-medium tracking-widest uppercase">or</span>
            <div className="flex-1 h-px bg-slate-800" />
        </div>
    );
}

// ─── PasswordEye toggle ───────────────────────────────────────────────────────

export function EyeIcon({ open }: { open: boolean }) {
    return open ? (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    ) : (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
    );
}
