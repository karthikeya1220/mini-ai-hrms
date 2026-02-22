// =============================================================================
// context/AuthContext.tsx — global auth state.
//
// Stores:
//   - accessToken  in React state (memory only — never localStorage / sessionStorage)
//   - org          in React state (id, name, email)
//
// The refreshToken lives in an httpOnly cookie managed entirely by the
// browser — JS never reads or writes it.
//
// On mount, the context attempts a silent token refresh via the cookie so
// users don't have to re-login after a page reload (as long as their 7-day
// refresh token is still valid).
// =============================================================================

import { createContext, useContext } from 'react';
import type { OrgInfo, UserInfo } from '../api/auth';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthState {
    accessToken: string | null;
    user: UserInfo | null;
    org: OrgInfo | null;
    isLoading: boolean;       // true while the initial silent refresh is running
}

export interface AuthContextValue extends AuthState {
    /** Call after a successful login or register to store the session. */
    setSession: (accessToken: string, user: UserInfo, org: OrgInfo) => void;
    /** Logs out — clears state + revokes cookie server-side. */
    logout: () => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

export const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
    return ctx;
}
