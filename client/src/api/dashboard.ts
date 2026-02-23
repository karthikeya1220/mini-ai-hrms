// api/dashboard.ts — typed wrapper for GET /api/dashboard.
//
// All calls use the shared Axios client (api/client.ts).
// Authorization header and TOKEN_EXPIRED refresh are handled automatically.

import { client } from './client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmployeeStat {
    employeeId: string;
    name: string;
    /** Free-text job title — NOT the RBAC role (see User.role = ADMIN | EMPLOYEE). */
    jobTitle: string | null;
    department: string | null;
    isActive: boolean;
    tasksAssigned: number;
    tasksCompleted: number;
    completionRate: number;
    productivityScore: number | null;
    verifiedTasks: number;
}

export interface RecentBlockchainLog {
    taskId: string;
    taskTitle: string;
    employeeName: string;
    txHash: string;
    loggedAt: string;
}

export interface DashboardData {
    totalEmployees: number;
    activeEmployees: number;
    tasksAssigned: number;
    tasksCompleted: number;
    completionRate: number;
    employeeStats: EmployeeStat[];
    recentLogs: RecentBlockchainLog[];
    generatedAt: string;
}


// ─── Fetch ────────────────────────────────────────────────────────────────────

export async function fetchDashboard(): Promise<DashboardData> {
    const res = await client.get<{ success: true; data: DashboardData }>('/dashboard');
    return res.data.data;
}
