// =============================================================================
// Shared TypeScript types — used across routes, controllers, middleware.
// These reflect the SPEC.md API contracts exactly.
// =============================================================================

import { Request } from 'express';

// ─── Authenticated Request ────────────────────────────────────────────────────
// After authMiddleware runs, every request carries this on req.org.
// The orgId is extracted from the JWT — never accepted from the request body.
export interface AuthenticatedOrg {
    id: string;    // UUID
    email: string;
}

export interface AuthRequest extends Request {
    org?: AuthenticatedOrg;
}

// ─── Standard API Response ───────────────────────────────────────────────────
// SPEC § 2.4: All errors return { success, error, message, statusCode }
export interface ApiSuccess<T = unknown> {
    success: true;
    data: T;
}

export interface ApiError {
    success: false;
    error: string;       // machine-readable error code e.g. "VALIDATION_ERROR"
    message: string;     // human-readable explanation
    statusCode: number;
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;

// ─── Task Status ─────────────────────────────────────────────────────────────
// SPEC § 2.3: status enum values
export type TaskStatus = 'assigned' | 'in_progress' | 'completed';

// ─── Task Priority ───────────────────────────────────────────────────────────
export type TaskPriority = 'low' | 'medium' | 'high';

// ─── Employee ─────────────────────────────────────────────────────────────────
// Mirrors the Prisma Employee model — used in service return types and
// controller response shapes. orgId is intentionally included in the internal
// type but stripped before sending to the client (see employee.service.ts).
export interface EmployeeRow {
    id: string;
    orgId: string;   // NOT sent to client — internal use only
    name: string;
    email: string;
    role: string | null;
    department: string | null;
    skills: string[];
    walletAddress: string | null;
    isActive: boolean;
    createdAt: Date;
}

// Shape returned to API consumers — orgId excluded (never exposed from server)
export type EmployeeResponse = Omit<EmployeeRow, 'orgId'>;

// ─── Pagination ───────────────────────────────────────────────────────────────
// SPEC § Day 1, Hour 4–7: cursor-based pagination (not offset — degrades at scale)
export interface PaginatedResponse<T> {
    data: T[];
    nextCursor: string | null;  // UUID of the last record returned; null = no more pages
    total: number;              // total count matching the filter (for UI display)
}

// ─── Task ─────────────────────────────────────────────────────────────────────
// Mirrors the Prisma Task model — orgId included internally, excluded from API.
export interface TaskRow {
    id: string;
    orgId: string;        // NOT sent to client — internal only
    assignedTo: string | null;
    title: string;
    description: string | null;
    priority: TaskPriority;
    status: TaskStatus;
    complexityScore: number;
    requiredSkills: string[];
    dueDate: Date | null;
    completedAt: Date | null;
    createdAt: Date;
}

// Shape returned to API consumers — orgId excluded
export interface TaskResponse extends Omit<TaskRow, 'orgId'> {
    txHash?: string | null;
}

// ─── Status FSM ───────────────────────────────────────────────────────────────
// SPEC § 2.3: assigned → in_progress → completed (forward-only)
// Defined in types so both task service and future AI scoring share the guard.
export const VALID_TRANSITIONS: Readonly<Record<TaskStatus, TaskStatus[]>> = {
    assigned: ['in_progress'],
    in_progress: ['completed'],
    completed: [],             // terminal — no further transitions allowed
};
