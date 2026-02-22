// AuthProvider.tsx — the React component that owns auth state.
// Kept in a separate file from AuthContext.tsx so fast-refresh works:
//   AuthContext.tsx  → exports only non-component values (context, hook, types)
//   AuthProvider.tsx → exports only the AuthProvider component

import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { apiMe } from '../api/auth';
import type { OrgInfo, UserInfo } from '../api/auth';
import { AuthContext } from './AuthContext';
import type { AuthContextValue } from './AuthContext';

interface AuthState {
    accessToken: string | null;
    user: UserInfo | null;
    org: OrgInfo | null;
    isLoading: boolean;
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<AuthState>({
        accessToken: null,
        user: null,
        org: null,
        isLoading: true,
    });

    const handleSession = useCallback(async (token: string) => {
        try {
            const data = await apiMe(token);
            setState({
                accessToken: token,
                user: data.user,
                org: data.org,
                isLoading: false,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : '';

            // Supabase account exists but no linked local Employee/Org record.
            // This is an orphaned state — clear the session so the user can re-register.
            if (msg.includes('not linked') || msg.includes('USER_NOT_SYNCED') || msg.includes('not linked to any organization')) {
                console.warn('[Auth] Orphaned Supabase session — signing out so user can re-register.');
                await supabase.auth.signOut();
                // onAuthStateChange fires with null → state resets automatically
                return;
            }

            console.error('[Auth] Failed to sync session with backend:', err);
            setState(s => ({ ...s, isLoading: false }));
        }
    }, []);

    useEffect(() => {
        // 1. Check current session
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session) {
                handleSession(session.access_token);
            } else {
                setState(s => ({ ...s, isLoading: false }));
            }
        });

        // 2. Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            if (session) {
                handleSession(session.access_token);
            } else {
                setState({ accessToken: null, user: null, org: null, isLoading: false });
            }
        });

        return () => {
            subscription.unsubscribe();
        };
    }, [handleSession]);

    const setSession = useCallback((accessToken: string, user: UserInfo, org: OrgInfo) => {
        setState({ accessToken, user, org, isLoading: false });
    }, []);

    const logout = useCallback(async () => {
        await supabase.auth.signOut();
        setState({ accessToken: null, user: null, org: null, isLoading: false });
    }, []);

    const value: AuthContextValue = { ...state, setSession, logout };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}
