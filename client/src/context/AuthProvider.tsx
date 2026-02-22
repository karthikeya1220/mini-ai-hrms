// AuthProvider.tsx — the React component that owns auth state.
// Kept in a separate file from AuthContext.tsx so fast-refresh works:
//   AuthContext.tsx  → exports only non-component values (context, hook, types)
//   AuthProvider.tsx → exports only the AuthProvider component
//
// Token lifecycle:
//   accessToken lives in api/client.ts module memory (_accessToken) only.
//   setToken() / clearToken() keep the Axios interceptor in sync.
//   React state holds user + org — everything components actually need.
//
//   On mount: POST /auth/refresh (withCredentials) to silently restore a
//   session from the httpOnly cookie.  On success, store the new token and
//   fetch /me.  On failure, start unauthenticated.

import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { apiLogin, apiRefresh, apiMe, apiLogout, setToken, clearToken } from '../api/auth';
import type { OrgInfo, UserInfo } from '../api/auth';
import { AuthContext } from './AuthContext';
import type { AuthContextValue } from './AuthContext';

interface AuthState {
    user: UserInfo | null;
    org: OrgInfo | null;
    isLoading: boolean;
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<AuthState>({
        user: null,
        org: null,
        isLoading: true,
    });

    // ── Silent refresh on mount ───────────────────────────────────────────────
    // POST /auth/refresh sends the httpOnly cookie via withCredentials.
    // On success: store token in Axios memory, then fetch /me for user + org.
    // On failure: start unauthenticated (isLoading → false, everything null).
    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const newToken = await apiRefresh();
                if (cancelled) return;

                setToken(newToken);                  // → Axios interceptor memory

                const { user, org } = await apiMe(); // uses the new token automatically
                if (cancelled) return;

                setState({ user, org, isLoading: false });
            } catch {
                if (cancelled) return;
                // No valid refresh cookie — start logged out silently.
                setState({ user: null, org: null, isLoading: false });
            }
        })();

        return () => { cancelled = true; };
    }, []);

    // ── login ─────────────────────────────────────────────────────────────────
    const login = useCallback(async (email: string, password: string) => {
        const { accessToken, user } = await apiLogin({ email, password });
        setToken(accessToken);                   // → Axios interceptor memory
        const { org } = await apiMe();           // fetch org via /me
        setState({ user, org, isLoading: false });
    }, []);

    // ── logout — revoke server-side + clear client state ─────────────────────
    const logout = useCallback(async () => {
        try {
            await apiLogout();   // POST /auth/logout — increments tokenVersion
        } catch {
            // Swallow — even if the server call fails, clear client state.
        } finally {
            clearToken();        // clear Axios interceptor memory
            setState({ user: null, org: null, isLoading: false });
        }
    }, []);

    // ── Derived flags ─────────────────────────────────────────────────────────
    const value: AuthContextValue = {
        user: state.user,
        org: state.org,
        isLoading: state.isLoading,
        isAuthenticated: state.user !== null,
        isAdmin: state.user !== null && state.user.role === 'ADMIN',
        isEmployee: state.user !== null && state.user.role === 'EMPLOYEE',
        login,
        logout,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}
