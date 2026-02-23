// api/tasks.ts — typed wrappers for /api/tasks/*
//
// All calls use the shared Axios client (api/client.ts).
// Authorization header and TOKEN_EXPIRED refresh are handled automatically.
// Token is no longer a parameter on any function.

import { client } from './client';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus = 'assigned' | 'in_progress' | 'completed';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface Task {
    id: string;
    assignedTo: string | null;     // employee UUID
    title: string;
    description: string | null;
    priority: TaskPriority;
    status: TaskStatus;
    complexityScore: number;           // 1–5
    requiredSkills: string[];
    dueDate: string | null;     // ISO
    completedAt: string | null;     // ISO
    createdAt: string;            // ISO
    txHash?: string | null;
}

export interface PaginatedTasks {
    data: Task[];
    nextCursor: string | null;
    total: number;
}

export interface CreateTaskInput {
    title: string;
    description?: string;
    priority?: TaskPriority;
    complexityScore?: number;
    requiredSkills?: string[];
    assignedTo?: string;
    dueDate?: string;            // ISO 8601
}

export interface ListTaskParams {
    status?: TaskStatus;
    assignedTo?: string;
    priority?: TaskPriority;
    limit?: number;
    cursor?: string;
}

// FSM — forward-only transitions (mirrors server VALID_TRANSITIONS)
export const NEXT_STATUS: Record<TaskStatus, TaskStatus | null> = {
    assigned: 'in_progress',
    in_progress: 'completed',
    completed: null,
};

// ─── API calls ────────────────────────────────────────────────────────────────

export async function listTasks(params: ListTaskParams = {}): Promise<PaginatedTasks> {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.assignedTo) qs.set('assignedTo', params.assignedTo);
    if (params.priority) qs.set('priority', params.priority);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.cursor) qs.set('cursor', params.cursor);
    const res = await client.get<{ success: true; data: PaginatedTasks }>(`/tasks${qs.toString() ? '?' + qs : ''}`);
    return res.data.data;
}

export async function createTask(data: CreateTaskInput): Promise<Task> {
    const res = await client.post<{ success: true; data: Task }>('/tasks', data);
    return res.data.data;
}

export async function getTask(id: string): Promise<Task> {
    const res = await client.get<{ success: true; data: Task }>(`/tasks/${id}`);
    return res.data.data;
}

/** PUT /api/tasks/:id/status — FSM-guarded; only forward transitions accepted. */
export async function updateTaskStatus(id: string, status: TaskStatus): Promise<Task> {
    const res = await client.put<{ success: true; data: Task }>(`/tasks/${id}/status`, { status });
    return res.data.data;
}

// ─── AI recommendations ───────────────────────────────────────────────────────

export interface Recommendation {
    rank: number;
    score: number;
    employee: {
        id: string;
        name: string;
        role: string | null;
        department: string | null;
        skills: string[];
    };
    reasoning: {
        skillOverlap: number;
        activeCount: number;
        perfScore: number;
    };
}

/** GET /api/ai/recommend/:taskId */
export async function recommendEmployees(taskId: string): Promise<Recommendation[]> {
    const res = await client.get<{ success: true; data: { recommendations: Recommendation[] } }>(`/ai/recommend/${taskId}`);
    return res.data.data.recommendations;
}
