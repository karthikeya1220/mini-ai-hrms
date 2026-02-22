// =============================================================================
// api/client.ts — singleton Axios instance with JWT lifecycle management.
//
// Token storage contract:
//   accessToken  → module-level variable (JS heap only, never localStorage /
//                  sessionStorage / cookie).  Survives React re-renders,
//                  cleared on page reload (forcing silent-refresh on mount).
//   refreshToken → httpOnly cookie, managed by the browser.  JS never reads,
//                  writes, or even knows its value.
//
// Request flow:
//   Every request → request interceptor attaches Authorization: Bearer <token>
//   (if a token is held in memory).  Auth-specific routes (register, login,
//   refresh, logout) work without a token in memory — the interceptor is a
//   no-op when the variable is null.
//
// 401 / TOKEN_EXPIRED flow:
//   1. Response interceptor detects error.code === 'TOKEN_EXPIRED'.
//   2. POST /auth/refresh with withCredentials — browser sends the httpOnly
//      refresh cookie automatically.
//   3. On success: store new accessToken, retry the original request once.
//   4. On failure (expired / revoked refresh token): clear in-memory token,
//      redirect to /login.  The redirect is a hard navigation (window.location)
//      because React Router is not available at this layer.
//
// Retry guard:
//   A custom flag (_retried) is set on the AxiosRequestConfig after the first
//   retry attempt.  Any subsequent 401 skips the refresh and goes straight to
//   the /login redirect — prevents infinite refresh loops.
//
// Concurrency:
//   A single refresh promise is shared across all concurrent 401s via
//   refreshPromise.  If three requests expire simultaneously, only one
//   POST /auth/refresh is sent; all three await the same promise and retry
//   with the new token.
// =============================================================================

import axios from 'axios';
import type { AxiosInstance, AxiosRequestConfig, AxiosError, InternalAxiosRequestConfig } from 'axios';

// ─── In-memory token store ────────────────────────────────────────────────────
// Never touches localStorage, sessionStorage, or any cookie from JS.

let _accessToken: string | null = null;

/** Read the current in-memory access token. */
export function getToken(): string | null {
    return _accessToken;
}

/** Store a new access token in memory (called by AuthProvider on login/refresh). */
export function setToken(token: string): void {
    _accessToken = token;
}

/** Clear the in-memory access token (called on logout or failed refresh). */
export function clearToken(): void {
    _accessToken = null;
}

// ─── Axios instance ───────────────────────────────────────────────────────────

const API_BASE = (import.meta.env.VITE_API_URL ?? '/api') as string;

export const client: AxiosInstance = axios.create({
    baseURL: API_BASE,
    withCredentials: true,   // always send the httpOnly refresh cookie
    headers: {
        'Content-Type': 'application/json',
    },
});

// ─── Request interceptor — attach Authorization header ────────────────────────

client.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
        const token = getToken();
        if (token) {
            config.headers.set('Authorization', `Bearer ${token}`);
        }
        return config;
    },
    (error) => Promise.reject(error),
);

// ─── Refresh state — single shared promise, cleared after settlement ──────────
// Ensures concurrent 401s share one refresh round-trip rather than each
// independently calling POST /auth/refresh.

let refreshPromise: Promise<string> | null = null;

async function doRefresh(): Promise<string> {
    // Reuse an in-flight refresh if one is already pending.
    if (refreshPromise) return refreshPromise;

    refreshPromise = client
        .post<{ success: true; data: { accessToken: string } }>('/auth/refresh')
        .then((res) => {
            const newToken = res.data.data.accessToken;
            setToken(newToken);
            return newToken;
        })
        .finally(() => {
            // Always clear so the next expiry starts a fresh refresh.
            refreshPromise = null;
        });

    return refreshPromise;
}

// ─── Extended config type — carries the retry flag ────────────────────────────

interface RetryableConfig extends InternalAxiosRequestConfig {
    _retried?: boolean;
}

// ─── Response interceptor — TOKEN_EXPIRED → refresh → retry ──────────────────

client.interceptors.response.use(
    // Pass through all successful responses unchanged.
    (response) => response,

    async (error: AxiosError<{ error?: string }>) => {
        const originalConfig = error.config as RetryableConfig | undefined;

        // Only handle responses — not network errors with no response.
        if (!error.response || !originalConfig) {
            return Promise.reject(error);
        }

        const { status, data } = error.response;
        const errorCode = data?.error;

        // ── TOKEN_EXPIRED → attempt silent refresh ────────────────────────────
        if (status === 401 && errorCode === 'TOKEN_EXPIRED' && !originalConfig._retried) {
            originalConfig._retried = true;   // prevent retry loop

            try {
                const newToken = await doRefresh();

                // Update the Authorization header on the retried request.
                originalConfig.headers.set('Authorization', `Bearer ${newToken}`);

                // Retry the original request with the new token.
                return client(originalConfig as AxiosRequestConfig);
            } catch {
                // Refresh failed — session is fully expired or revoked.
                clearToken();
                window.location.href = '/login';
                return Promise.reject(error);
            }
        }

        // ── Any other 401 (TOKEN_INVALID, UNAUTHORIZED, already retried) ─────
        // Don't redirect here — let the component decide how to handle it.
        // Only redirect for TOKEN_EXPIRED after a failed refresh (handled above).
        return Promise.reject(error);
    },
);
