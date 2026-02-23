// =============================================================================
// pages/LoginPage.tsx
//
// Calls login() from AuthContext which runs apiLogin → setToken → apiMe.
// Redirect: /dashboard (or the ?from= page) after successful login.
// =============================================================================

import { useState, useId } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { FloatingInput, LogoMark, Spinner, EyeIcon } from '../components/ui';

// ─── Role-aware default landing page ─────────────────────────────────────────
// Admins land on /dashboard; employees land on /tasks.
// The `from` state (set by ProtectedRoute when redirecting to /login) is still
// respected so a deep-link like /employees that an admin bookmarked works fine.
function defaultLanding(role: 'ADMIN' | 'EMPLOYEE' | undefined): string {
  return role === 'EMPLOYEE' ? '/my' : '/dashboard';
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validate(email: string, password: string) {
  const errors: { email?: string; password?: string } = {};
  if (!email.trim()) errors.email = 'Email is required';
  else if (!/^\S+@\S+\.\S+$/.test(email)) errors.email = 'Enter a valid email address';
  if (!password) errors.password = 'Password is required';
  return errors;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Respect an explicit `from` path set by ProtectedRoute (e.g. user tried to open
  // /employees directly while logged out).  When there's no explicit destination,
  // resolve the landing page from the user's role after login resolves:
  //   ADMIN    → /dashboard
  //   EMPLOYEE → /tasks
  const explicitFrom = (location.state as { from?: string } | null)?.from;

  const uid = useId();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError('');

    const errors = validate(email, password);
    if (Object.keys(errors).length > 0) { setFieldErrors(errors); return; }
    setFieldErrors({});

    setLoading(true);
    try {
      const loggedInUser = await login(email, password);
      toast.success('Welcome back! 👋', { duration: 3000 });
      // Role-aware redirect: explicit deep-link > role default
      const destination = explicitFrom ?? defaultLanding(loggedInUser.role);
      navigate(destination, { replace: true });
    } catch (err: unknown) {
      setApiError(err instanceof Error ? err.message : 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-4 py-16 relative overflow-hidden">
      {/* Background glows */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-brand-600/10 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] rounded-full bg-brand-800/10 blur-3xl" />
      </div>

      <div className="auth-card animate-slide-up relative z-10">
        {/* Header */}
        <LogoMark />
        <h1 className="text-2xl font-bold tracking-tight text-white mb-1">
          Sign in to your workspace
        </h1>
        <p className="text-sm text-slate-400 mb-8">
          Don't have an account?{' '}
          <Link to="/register" className="btn-ghost">
            Create one free
          </Link>
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
            id={`${uid}-email`}
            label="Work email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={e => { setEmail(e.target.value); setFieldErrors(f => ({ ...f, email: undefined })); }}
            error={fieldErrors.email}
            disabled={loading}
          />

          <div>
            <label htmlFor={`${uid}-password`} className="field-label">Password</label>
            <div className="relative">
              <input
                id={`${uid}-password`}
                type={showPwd ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                className={`input pr-11 ${fieldErrors.password ? 'input-error' : ''}`}
                value={password}
                onChange={e => { setPassword(e.target.value); setFieldErrors(f => ({ ...f, password: undefined })); }}
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
            {fieldErrors.password && (
              <p className="field-error mt-2 flex items-center gap-1" role="alert">
                <svg className="w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm.75 4.25a.75.75 0 0 0-1.5 0v3.5a.75.75 0 0 0 1.5 0v-3.5zM8 11a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
                </svg>
                {fieldErrors.password}
              </p>
            )}
          </div>

          <button
            id="btn-login-submit"
            type="submit"
            className="btn-primary mt-2"
            disabled={loading}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Spinner className="w-4 h-4" /> Signing in…
              </span>
            ) : (
              'Sign in'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
