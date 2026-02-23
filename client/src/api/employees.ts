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
    createdAt: string;   // ISO — server field name
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
    completionRate: number;        // 0–1  (server field name)
    onTimeRate: number;            // 0–1
    avgComplexity: number;         // 1–5
    totalTasksAssigned: number;
    totalCompleted: number;
    totalOnTime: number;
}

export interface ProductivityScore {
    employeeId: string;
    name: string;
    score: number | null;          // null when no tasks assigned
    grade: string | null;          // null when score is null
    breakdown: ScoreBreakdown | null;
    trend: 'improving' | 'declining' | 'stable' | 'insufficient_data';
    computedAt: string;            // ISO
}

export interface SkillGap {
    employeeId: string;
    name: string;
    currentSkills: string[];
    requiredSkills: string[];
    gapSkills: string[];
    coverageRate: number;     // 0-1
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
    const res = await client.post<{ success: true; data: { employee: Employee; temporaryPassword: string } }>('/employees', data);
    return res.data.data.employee;
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

/** GET /api/ai/skill-gap/:employeeId */
export async function getSkillGap(employeeId: string): Promise<SkillGap> {
    const res = await client.get<{ success: true; data: SkillGap }>(`/ai/skill-gap/${employeeId}`);
    return res.data.data;
}
