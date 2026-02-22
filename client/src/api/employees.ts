// api/employees.ts — typed wrappers for /api/employees/* and /api/ai/*
//
// All calls use the shared Axios client (api/client.ts).
// Authorization header and TOKEN_EXPIRED refresh are handled automatically.
// Token is no longer a parameter on any function — it is read from memory
// by the request interceptor on every call.

import { client } from './client';

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

export async function listEmployees(params: ListParams = {}): Promise<PaginatedEmployees> {
    const qs = new URLSearchParams();
    if (params.department) qs.set('department', params.department);
    if (params.role) qs.set('role', params.role);
    if (params.isActive) qs.set('isActive', params.isActive);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.cursor) qs.set('cursor', params.cursor);
    const query = qs.toString() ? `?${qs}` : '';
    const res = await client.get<{ success: true; data: PaginatedEmployees }>(`/employees${query}`);
    return res.data.data;
}

export async function createEmployee(data: EmployeeInput): Promise<Employee> {
    const res = await client.post<{ success: true; data: Employee }>('/employees', data);
    return res.data.data;
}

export async function updateEmployee(id: string, data: Partial<EmployeeInput>): Promise<Employee> {
    const res = await client.put<{ success: true; data: Employee }>(`/employees/${id}`, data);
    return res.data.data;
}

/** Soft-delete — sets isActive = false, returns updated employee */
export async function deactivateEmployee(id: string): Promise<Employee> {
    const res = await client.delete<{ success: true; data: Employee }>(`/employees/${id}`);
    return res.data.data;
}

// ─── AI score ─────────────────────────────────────────────────────────────────

/** GET /api/ai/score/:employeeId */
export async function getEmployeeScore(employeeId: string): Promise<ProductivityScore> {
    const res = await client.get<{ success: true; data: ProductivityScore }>(`/ai/score/${employeeId}`);
    return res.data.data;
}
