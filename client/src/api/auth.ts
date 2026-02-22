// =============================================================================
// api/auth.ts — typed wrappers for /api/auth/* and /api/me endpoints.
//
// All calls go through the shared Axios client (api/client.ts) which:
//   - Attaches Authorization: Bearer automatically from the in-memory token.
//   - Handles TOKEN_EXPIRED → silent refresh → retry transparently.
//
// setToken / clearToken are re-exported here so AuthProvider only imports
// from api/auth (single import point for auth concerns).
//
// withCredentials is set globally on the client instance — the browser sends
// and receives the httpOnly refresh cookie on every call automatically.
// =============================================================================

import { client, setToken, clearToken } from './client';

export { setToken, clearToken };

// ─── Response types ───────────────────────────────────────────────────────────

export interface OrgInfo {
    id: string;
    name: string;
}

export interface UserInfo {
    id: string;
    email: string;
    role: 'ADMIN' | 'EMPLOYEE';
    employeeId: string | null;
}

export interface AuthResponse {
    accessToken: string;
    user: UserInfo;
}

// ─── POST /auth/register ──────────────────────────────────────────────────────

export interface RegisterInput {
    orgName: string;
    email: string;
    password: string;
}

export async function apiRegister(input: RegisterInput): Promise<AuthResponse> {
    const res = await client.post<{ success: true; data: AuthResponse }>('/auth/register', input);
    return res.data.data;
}

// ─── POST /auth/login ─────────────────────────────────────────────────────────

export interface LoginInput {
    email: string;
    password: string;
}

export async function apiLogin(input: LoginInput): Promise<AuthResponse> {
    const res = await client.post<{ success: true; data: AuthResponse }>('/auth/login', input);
    return res.data.data;
}

// ─── POST /auth/refresh ───────────────────────────────────────────────────────
// Sends the httpOnly refresh cookie (withCredentials is global on the client).
// Returns the new accessToken string only — the refresh cookie is rotated
// server-side and set on the response automatically.
//
// Normal callers do NOT need to call this manually — the response interceptor
// in client.ts triggers it automatically on TOKEN_EXPIRED.  This export exists
// for AuthProvider's silent-refresh-on-mount use case.

export async function apiRefresh(): Promise<string> {
    const res = await client.post<{ success: true; data: { accessToken: string } }>('/auth/refresh');
    return res.data.data.accessToken;
}

// ─── POST /auth/logout ────────────────────────────────────────────────────────
// Server revokes the refresh token (increments tokenVersion).
// The Authorization header is attached automatically by the request interceptor.

export async function apiLogout(): Promise<void> {
    await client.post('/auth/logout');
}

// ─── GET /api/me ──────────────────────────────────────────────────────────────
// Returns the currently authenticated user + org info.
// Authorization header is attached automatically by the request interceptor.

export interface MeResponse {
    user: UserInfo;
    org: OrgInfo;
}

export async function apiMe(): Promise<MeResponse> {
    const res = await client.get<{ success: true; data: MeResponse }>('/me');
    return res.data.data;
}
