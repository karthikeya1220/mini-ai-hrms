// AuthProvider.tsx — the React component that owns auth state.
// Kept in a separate file from AuthContext.tsx so fast-refresh works:
//   AuthContext.tsx  → exports only non-component values (context, hook, types)
//   AuthProvider.tsx → exports only the AuthProvider component

import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { apiLogout, apiRefresh } from '../api/auth';
import type { OrgInfo } from '../api/auth';
import { AuthContext, extractOrgFromToken } from './AuthContext';
import type { AuthContextValue } from './AuthContext';

interface AuthState {
    accessToken: string | null;
    org: OrgInfo | null;
    isLoading: boolean;
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<AuthState>({
        accessToken: null,
        org: null,
        isLoading: true,   // resolved once silent refresh completes or fails
    });

    // ── Silent refresh on mount ──────────────────────────────────────────────
    // Attempt to recover session from the httpOnly cookie.
    // Fails silently → user sees login page (expected when no cookie present).
    useEffect(() => {
        let cancelled = false;

        apiRefresh()
            .then(newToken => {
                if (!cancelled) {
                    const org = extractOrgFromToken(newToken);
                    setState({ accessToken: newToken, org, isLoading: false });
                }
            })
            .catch(() => {
                if (!cancelled) setState(s => ({ ...s, isLoading: false }));
            });

        return () => { cancelled = true; };
    }, []);

    const setSession = useCallback((accessToken: string, org: OrgInfo) => {
        setState({ accessToken, org, isLoading: false });
    }, []);

    const logout = useCallback(async () => {
        if (state.accessToken) {
            try { await apiLogout(state.accessToken); } catch { /* best effort */ }
        }
        setState({ accessToken: null, org: null, isLoading: false });
    }, [state.accessToken]);

    const value: AuthContextValue = { ...state, setSession, logout };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}
