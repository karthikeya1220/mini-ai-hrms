// =============================================================================
// api/auth.ts — typed API wrappers for /api/auth/* endpoints.
//
// Security model (mirrors server contract exactly):
//   - accessToken  → returned in JSON body → stored in React context (memory)
//   - refreshToken → set by server as httpOnly cookie → never touched in JS
//
// All fetch calls set credentials: 'include' so the browser automatically
// sends / receives the httpOnly cookie on auth routes.
// =============================================================================

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

// ─── Response types ───────────────────────────────────────────────────────────

export interface OrgInfo {
  id:    string;
  name:  string;
  email: string;
}

export interface AuthResponse {
  accessToken: string;
  org:         OrgInfo;
}

export interface ApiError {
  success:    false;
  error:      string;   // machine-readable code
  message:    string;   // human-readable
  statusCode: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method:      'POST',
    credentials: 'include',    // sends/receives the httpOnly refresh cookie
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify(body),
  });

  const json = await res.json();

  if (!res.ok) {
    // Surface the server's error shape so callers can show exact messages
    const err = json as ApiError;
    throw new Error(err.message ?? `Request failed (${res.status})`);
  }

  // Server wraps all success responses in { success: true, data: … }
  return (json as { success: true; data: T }).data;
}

// ─── Auth endpoints ───────────────────────────────────────────────────────────

export interface RegisterInput {
  name:     string;
  email:    string;
  password: string;
}

/** POST /api/auth/register — creates org + returns accessToken + org info */
export async function apiRegister(input: RegisterInput): Promise<AuthResponse> {
  return post<AuthResponse>('/auth/register', input);
}

export interface LoginInput {
  email:    string;
  password: string;
}

/** POST /api/auth/login — authenticates org + returns accessToken + org info */
export async function apiLogin(input: LoginInput): Promise<AuthResponse> {
  return post<AuthResponse>('/auth/login', input);
}

/** POST /api/auth/logout — revokes refresh token cookie server-side */
export async function apiLogout(accessToken: string): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, {
    method:      'POST',
    credentials: 'include',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
  });
}

/** POST /api/auth/refresh — issues new accessToken using httpOnly cookie */
export async function apiRefresh(): Promise<string> {
  const data = await post<{ accessToken: string }>('/auth/refresh', {});
  return data.accessToken;
}
