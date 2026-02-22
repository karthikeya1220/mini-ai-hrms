// =============================================================================
// context/AuthContext.tsx — global auth state shape and hook.
//
// accessToken is intentionally NOT in the context value — it lives in
// api/client.ts module memory and is attached to every request automatically
// by the Axios interceptor.  Components never need the raw token.
//
// The refreshToken lives in an httpOnly cookie managed by the browser.
// =============================================================================

import { createContext, useContext } from 'react';
import type { OrgInfo, UserInfo } from '../api/auth';

// Re-export so callers can import types from one place.
export type { OrgInfo, UserInfo };

// ─── Context value ─────────────────────────────────────────────────────────────

export interface AuthContextValue {
    // State
    user: UserInfo | null;
    org: OrgInfo | null;
    isLoading: boolean;

    // Derived flags — computed in AuthProvider, never stored in React state
    isAuthenticated: boolean;   // user !== null
    isAdmin: boolean;           // user?.role === 'ADMIN'
    isEmployee: boolean;        // user?.role === 'EMPLOYEE'

    // Actions
    login: (email: string, password: string) => Promise<void>;
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
