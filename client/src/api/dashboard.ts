// api/dashboard.ts — typed wrapper for GET /api/dashboard.
//
// Response mirrors DashboardStats from services/dashboard.service.ts exactly.

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmployeeStat {
    employeeId: string;
    name: string;
    role: string | null;
    department: string | null;
    isActive: boolean;
    tasksAssigned: number;
    tasksCompleted: number;
    completionRate: number;  // 0–1, 3 d.p.
}

export interface DashboardData {
    totalEmployees: number;
    activeEmployees: number;
    tasksAssigned: number;
    tasksCompleted: number;
    completionRate: number;  // org-level 0–1
    employeeStats: EmployeeStat[];
    generatedAt: string;  // ISO string from server
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

export async function fetchDashboard(accessToken: string): Promise<DashboardData> {
    const res = await fetch(`${API_BASE}/dashboard`, {
        credentials: 'include',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
    });

    if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { message?: string }).message ?? `Dashboard fetch failed (${res.status})`);
    }

    const json = await res.json() as { success: true; data: DashboardData };
    return json.data;
}
