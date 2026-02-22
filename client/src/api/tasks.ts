// api/tasks.ts — typed wrappers for /api/tasks/*

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

// ─── Shared ───────────────────────────────────────────────────────────────────

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
    if (!res.ok) throw new Error((json as { message?: string }).message ?? `Request failed (${res.status})`);
    return (json as { success: true; data: T }).data;
}

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

export function listTasks(token: string, params: ListTaskParams = {}): Promise<PaginatedTasks> {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.assignedTo) qs.set('assignedTo', params.assignedTo);
    if (params.priority) qs.set('priority', params.priority);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.cursor) qs.set('cursor', params.cursor);
    return authFetch<PaginatedTasks>('GET', `/tasks${qs.toString() ? '?' + qs : ''}`, token);
}

export function createTask(token: string, data: CreateTaskInput): Promise<Task> {
    return authFetch<Task>('POST', '/tasks', token, data);
}

export function getTask(token: string, id: string): Promise<Task> {
    return authFetch<Task>('GET', `/tasks/${id}`, token);
}

/** PUT /api/tasks/:id/status — FSM-guarded; only forward transitions accepted. */
export function updateTaskStatus(token: string, id: string, status: TaskStatus): Promise<Task> {
    return authFetch<Task>('PUT', `/tasks/${id}/status`, token, { status });
}
