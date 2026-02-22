// =============================================================================
// pages/RegisterPage.tsx
//
// POST /api/auth/register → stores accessToken in AuthContext (memory)
// Redirect: /dashboard after successful registration
//
// Fields: org name, email, password, confirm password
// Validation: client-side before submit; server errors shown inline.
// =============================================================================

import { useState, useId } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { apiRegister } from '../api/auth';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { FloatingInput, LogoMark, Spinner, EyeIcon } from '../components/ui';

// ─── Validation ───────────────────────────────────────────────────────────────

interface FieldErrors {
    name?: string;
    email?: string;
    password?: string;
    confirm?: string;
}

function validate(name: string, email: string, password: string, confirm: string): FieldErrors {
    const e: FieldErrors = {};
    if (!name.trim()) e.name = 'Organization name is required';
    if (!email.trim()) e.email = 'Email is required';
    else if (!/^\S+@\S+\.\S+$/.test(email)) e.email = 'Enter a valid email address';
    if (!password) e.password = 'Password is required';
    else if (password.length < 8) e.password = 'Must be at least 8 characters';
    if (!confirm) e.confirm = 'Please confirm your password';
    else if (confirm !== password) e.confirm = 'Passwords do not match';
    return e;
}

// ─── Password strength meter ──────────────────────────────────────────────────

function strengthOf(pwd: string): { score: number; label: string; color: string } {
    if (!pwd) return { score: 0, label: '', color: 'bg-slate-800' };
    let s = 0;
    if (pwd.length >= 8) s++;
    if (/[A-Z]/.test(pwd)) s++;
    if (/[0-9]/.test(pwd)) s++;
    if (/[^A-Za-z0-9]/.test(pwd)) s++;
    const map = [
        { score: 0, label: '', color: 'bg-slate-800' },
        { score: 1, label: 'Weak', color: 'bg-red-500' },
        { score: 2, label: 'Fair', color: 'bg-amber-500' },
        { score: 3, label: 'Good', color: 'bg-emerald-500' },
        { score: 4, label: 'Strong', color: 'bg-brand-500' },
    ];
    return map[s] ?? map[0];
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RegisterPage() {
    const { setSession } = useAuth();
    const navigate = useNavigate();
    const uid = useId();

    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [showPwd, setShowPwd] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
    const [apiError, setApiError] = useState('');
    const [loading, setLoading] = useState(false);

    const strength = strengthOf(password);

    function clearField(key: keyof FieldErrors) {
        setFieldErrors(f => ({ ...f, [key]: undefined }));
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setApiError('');

        const errors = validate(name, email, password, confirm);
        if (Object.keys(errors).length > 0) { setFieldErrors(errors); return; }
        setFieldErrors({});

        setLoading(true);
        try {
            const data = await apiRegister({ name, email, password });

            // Set session in Supabase SDK for future auto-refresh
            await supabase.auth.setSession({
                access_token: data.accessToken,
                refresh_token: data.refreshToken,
            });

            setSession(data.accessToken, data.user, data.org);
            toast.success(`Welcome to mini-AI HRMS, ${data.user.name}! 🎉`, { duration: 4000 });
            navigate('/dashboard', { replace: true });
        } catch (err: unknown) {
            setApiError(err instanceof Error ? err.message : 'Registration failed. Please try again.');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="min-h-dvh flex items-center justify-center px-4 py-16 relative overflow-hidden">
            {/* Background glows */}
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute -top-60 -right-40 w-[600px] h-[600px] rounded-full bg-brand-700/10 blur-3xl" />
                <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full bg-brand-900/10 blur-3xl" />
            </div>

            <div className="auth-card animate-slide-up relative z-10">
                {/* Header */}
                <LogoMark />
                <h1 className="text-2xl font-bold tracking-tight text-white mb-1">
                    Create your workspace
                </h1>
                <p className="text-sm text-slate-400 mb-8">
                    Already have an account?{' '}
                    <Link to="/login" className="btn-ghost">Sign in</Link>
                </p>

                {/* API-level error banner */}
                {apiError && (
                    <div
                        role="alert"
                        className="mb-5 flex items-start gap-3 rounded-xl border border-red-500/30
                       bg-red-500/10 px-4 py-3 text-sm text-red-300 animate-fade-in"
                    >
                        <svg className="w-4 h-4 mt-0.5 shrink-0 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        {apiError}
                    </div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} noValidate className="space-y-5">
                    <FloatingInput
                        id={`${uid}-name`}
                        label="Organisation name"
                        type="text"
                        autoComplete="organization"
                        placeholder="Acme Corp"
                        value={name}
                        onChange={e => { setName(e.target.value); clearField('name'); }}
                        error={fieldErrors.name}
                        disabled={loading}
                    />

                    <FloatingInput
                        id={`${uid}-email`}
                        label="Work email"
                        type="email"
                        autoComplete="email"
                        placeholder="you@company.com"
                        value={email}
                        onChange={e => { setEmail(e.target.value); clearField('email'); }}
                        error={fieldErrors.email}
                        disabled={loading}
                    />

                    {/* Password + strength meter */}
                    <div>
                        <label htmlFor={`${uid}-password`} className="field-label">Password</label>
                        <div className="relative">
                            <input
                                id={`${uid}-password`}
                                type={showPwd ? 'text' : 'password'}
                                autoComplete="new-password"
                                placeholder="Min 8 characters"
                                className={`input pr-11 ${fieldErrors.password ? 'input-error' : ''}`}
                                value={password}
                                onChange={e => { setPassword(e.target.value); clearField('password'); }}
                                aria-invalid={!!fieldErrors.password}
                                disabled={loading}
                            />
                            <button
                                type="button"
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                                onClick={() => setShowPwd(v => !v)}
                                aria-label={showPwd ? 'Hide password' : 'Show password'}
                            >
                                <EyeIcon open={showPwd} />
                            </button>
                        </div>

                        {/* Strength bar */}
                        {password.length > 0 && (
                            <div className="mt-2 space-y-1">
                                <div className="flex gap-1">
                                    {[1, 2, 3, 4].map(i => (
                                        <div
                                            key={i}
                                            className={`h-1 flex-1 rounded-full transition-all duration-300
                        ${i <= strength.score ? strength.color : 'bg-slate-800'}`}
                                        />
                                    ))}
                                </div>
                                {strength.label && (
                                    <p className="text-xs text-slate-500">
                                        Strength: <span className="font-medium text-slate-300">{strength.label}</span>
                                    </p>
                                )}
                            </div>
                        )}

                        {fieldErrors.password && (
                            <p className="field-error mt-2" role="alert">
                                <svg className="w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm.75 4.25a.75.75 0 0 0-1.5 0v3.5a.75.75 0 0 0 1.5 0v-3.5zM8 11a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
                                </svg>
                                {fieldErrors.password}
                            </p>
                        )}
                    </div>

                    {/* Confirm password */}
                    <div>
                        <label htmlFor={`${uid}-confirm`} className="field-label">Confirm password</label>
                        <div className="relative">
                            <input
                                id={`${uid}-confirm`}
                                type={showConfirm ? 'text' : 'password'}
                                autoComplete="new-password"
                                placeholder="Re-enter your password"
                                className={`input pr-11 ${fieldErrors.confirm ? 'input-error' : ''}`}
                                value={confirm}
                                onChange={e => { setConfirm(e.target.value); clearField('confirm'); }}
                                aria-invalid={!!fieldErrors.confirm}
                                disabled={loading}
                            />
                            <button
                                type="button"
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                                onClick={() => setShowConfirm(v => !v)}
                                aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
                            >
                                <EyeIcon open={showConfirm} />
                            </button>
                        </div>
                        {fieldErrors.confirm && (
                            <p className="field-error mt-1.5" role="alert">
                                <svg className="w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm.75 4.25a.75.75 0 0 0-1.5 0v3.5a.75.75 0 0 0 1.5 0v-3.5zM8 11a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
                                </svg>
                                {fieldErrors.confirm}
                            </p>
                        )}
                    </div>

                    <button
                        id="btn-register-submit"
                        type="submit"
                        className="btn-primary mt-2"
                        disabled={loading}
                    >
                        {loading ? (
                            <span className="flex items-center justify-center gap-2">
                                <Spinner className="w-4 h-4" /> Creating workspace…
                            </span>
                        ) : (
                            'Create workspace'
                        )}
                    </button>
                </form>

                {/* Terms */}
                <p className="mt-6 text-center text-xs text-slate-600 leading-relaxed">
                    By creating an account you agree to our{' '}
                    <span className="text-slate-500">Terms of Service</span> and{' '}
                    <span className="text-slate-500">Privacy Policy</span>.
                </p>
            </div>
        </div>
    );
}
