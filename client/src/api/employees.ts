// api/employees.ts — typed wrappers for /api/employees/* and /api/ai/score/:id

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

// ─── Shared helper ────────────────────────────────────────────────────────────

async function authFetch<T>(
    method: string,
    path: string,
    token: string,
    body?: unknown,
): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
        method,
        credentials: 'include',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
        const msg = (json as { message?: string }).message ?? `Request failed (${res.status})`;
        throw new Error(msg);
    }

    return (json as { success: true; data: T }).data;
}

// ─── Employee types ───────────────────────────────────────────────────────────

export interface Employee {
    id: string;
    name: string;
    email: string;
    role: string | null;
    department: string | null;
    skills: string[];
    isActive: boolean;
    walletAddress: string | null;
    joinedAt: string;   // ISO
}

export interface PaginatedEmployees {
    data: Employee[];
    nextCursor: string | null;
    total: number;
}

export interface EmployeeInput {
    name: string;
    email: string;
    role?: string;
    department?: string;
    skills?: string[];
    walletAddress?: string;
}

// ─── AI score types ───────────────────────────────────────────────────────────

export interface ScoreBreakdown {
    taskCompletionRate: number;   // 0–1
    onTimeRate: number;
    avgComplexity: number;
    skillBonus: number;
    taskCount: number;
}

export interface ProductivityScore {
    employeeId: string;
    score: number;      // 0–100
    grade: string;      // A+/A/B/C/D
    breakdown: ScoreBreakdown;
    trend: number;      // positive = improving
    computedAt: string;      // ISO
}

// ─── Employee CRUD ────────────────────────────────────────────────────────────

export interface ListParams {
    department?: string;
    role?: string;
    isActive?: 'true' | 'false';
    limit?: number;
    cursor?: string;
}

export function listEmployees(token: string, params: ListParams = {}): Promise<PaginatedEmployees> {
    const qs = new URLSearchParams();
    if (params.department) qs.set('department', params.department);
    if (params.role) qs.set('role', params.role);
    if (params.isActive) qs.set('isActive', params.isActive);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.cursor) qs.set('cursor', params.cursor);
    const query = qs.toString() ? `?${qs}` : '';
    return authFetch<PaginatedEmployees>('GET', `/employees${query}`, token);
}

export function createEmployee(token: string, data: EmployeeInput): Promise<Employee> {
    return authFetch<Employee>('POST', '/employees', token, data);
}

export function updateEmployee(
    token: string,
    id: string,
    data: Partial<EmployeeInput>,
): Promise<Employee> {
    return authFetch<Employee>('PUT', `/employees/${id}`, token, data);
}

/** Soft-delete — sets isActive = false, returns updated employee */
export function deactivateEmployee(token: string, id: string): Promise<Employee> {
    return authFetch<Employee>('DELETE', `/employees/${id}`, token);
}

// ─── AI score ─────────────────────────────────────────────────────────────────

/** GET /api/ai/score/:employeeId */
export function getEmployeeScore(token: string, employeeId: string): Promise<ProductivityScore> {
    return authFetch<ProductivityScore>('GET', `/ai/score/${employeeId}`, token);
}
