// =============================================================================
// Task service — all database operations for the Task module.
//
// Multi-tenancy invariant:
//   orgId is passed in from req.org.id (JWT) at every call site.
//   It is NEVER read from input objects or request bodies.
//
// SPEC constraints:
//   - Status FSM: ASSIGNED → IN_PROGRESS → COMPLETED (forward-only)
//     Source of truth: VALID_TRANSITIONS in types/index.ts
//     Values are Prisma TaskStatus enum (SCREAMING_SNAKE_CASE).
//   - completedAt stamped by the server when status → COMPLETED
//   - Cursor-based pagination for task list
//   - Cross-tenant guard on get/update: findFirst({ id, orgId })
//   - assignedTo employee must belong to the same org (validated before create)
//
// Soft-delete contract:
//   Tasks are never hard-deleted. DELETE /tasks/:id sets isActive = false.
//   Every read query (list, getById, status transition, update) filters
//   isActive = true so deleted tasks are invisible to the application while
//   their blockchain_logs / scoring data are preserved for audit purposes.
//
// Background job contract:
//   updateTaskStatus() fires the productivity scoring job via enqueueScoringJob()
//   and returns a typed StatusUpdateResult that tells the controller whether a
//   job was queued — without the controller knowing how or where it is scheduled.
// =============================================================================

import prisma from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import {
    TaskRow,
    TaskResponse,
    TaskStatus,
    TaskPriority,
    PaginatedResponse,
    VALID_TRANSITIONS,
} from '../types';
import { enqueueScoringJob } from '../lib/scoringQueue';
import { invalidateDashboardCache } from './dashboard.service';

// ─── Select clause ────────────────────────────────────────────────────────────
// isActive is intentionally excluded from the response shape — clients never
// need to know the soft-delete flag; they simply stop receiving the task.
const TASK_SELECT = {
    id: true,
    orgId: true,
    assignedTo: true,
    title: true,
    description: true,
    priority: true,
    status: true,
    complexityScore: true,
    requiredSkills: true,
    dueDate: true,
    completedAt: true,
    createdAt: true,
    blockchainLogs: {
        select: { txHash: true },
        take: 1,
    },
} as const;

/** Strip orgId before sending to client and flatten txHash. */
export function toResponse(row: any): TaskResponse {
    const { orgId: _stripped, blockchainLogs, ...safe } = row;
    void _stripped;
    return {
        ...safe,
        txHash: blockchainLogs?.[0]?.txHash ?? null,
    };
}

// ─── CREATE ───────────────────────────────────────────────────────────────────

export interface CreateTaskInput {
    title: string;
    description?: string;
    priority?: TaskPriority;
    complexityScore?: number;
    requiredSkills?: string[];
    assignedTo?: string;   // employee UUID — validated to belong to same org
    dueDate?: string;   // ISO 8601 string from request body
}

/**
 * Create a new task scoped to orgId.
 *
 * If assignedTo is provided, we verify the employee exists within this org
 * before writing — prevents cross-tenant employee assignment (SPEC Risk R1).
 */
export async function createTask(
    orgId: string,
    input: CreateTaskInput,
): Promise<TaskRow> {
    // ── Validate assignedTo belongs to this org ─────────────────────────────
    if (input.assignedTo) {
        const employee = await prisma.employee.findFirst({
            where: { id: input.assignedTo, orgId, isActive: true },
            select: { id: true },
        });
        if (!employee) {
            throw new AppError(
                404,
                'EMPLOYEE_NOT_FOUND',
                'Assigned employee not found or is inactive in this organisation',
            );
        }
    }

    const task = await prisma.task.create({
        data: {
            orgId,                                           // ← from JWT
            title: input.title,
            description: input.description ?? null,
            priority: input.priority ?? 'medium',
            status: 'ASSIGNED',                     // ← always starts at ASSIGNED
            complexityScore: input.complexityScore ?? 3,
            requiredSkills: input.requiredSkills ?? [],
            assignedTo: input.assignedTo ?? null,
            dueDate: input.dueDate ? new Date(input.dueDate) : null,
        },
        select: TASK_SELECT,
    });

    return task as unknown as TaskRow;
}

// ─── LIST (paginated, filtered) ───────────────────────────────────────────────

export interface ListTasksInput {
    orgId: string;
    status?: TaskStatus;
    assignedTo?: string;       // filter by employee UUID
    priority?: TaskPriority;
    limit?: number;
    cursor?: string;
}

export async function listTasks(
    input: ListTasksInput,
): Promise<PaginatedResponse<TaskRow>> {
    const limit = Math.min(input.limit ?? 20, 100);

    const where = {
        orgId: input.orgId,                               // ← tenant boundary first
        isActive: true,                                   // ← soft-delete filter
        ...(input.status && { status: input.status }),
        ...(input.assignedTo && { assignedTo: input.assignedTo }),
        ...(input.priority && { priority: input.priority }),
        ...(input.cursor && { id: { gt: input.cursor } }),
    };

    // Count uses same filters minus cursor (for accurate total across all pages)
    const countWhere = {
        orgId: input.orgId,
        isActive: true,                                   // ← soft-delete filter
        ...(input.status && { status: input.status }),
        ...(input.assignedTo && { assignedTo: input.assignedTo }),
        ...(input.priority && { priority: input.priority }),
    };

    const [total, rows] = await Promise.all([
        prisma.task.count({ where: countWhere }),
        prisma.task.findMany({
            where,
            select: TASK_SELECT,
            orderBy: { createdAt: 'asc' },
            take: limit + 1,
        }),
    ]);

    const hasMore = rows.length > limit;
    const data = (hasMore ? rows.slice(0, limit) : rows) as unknown as TaskRow[];
    const nextCursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;

    return { data, nextCursor, total };
}

// ─── GET ONE ──────────────────────────────────────────────────────────────────

export async function getTaskById(
    orgId: string,
    taskId: string,
): Promise<TaskRow> {
    const task = await prisma.task.findFirst({
        where: { id: taskId, orgId, isActive: true },    // orgId + soft-delete guard
        select: TASK_SELECT,
    });

    if (!task) {
        throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }

    return task as unknown as TaskRow;
}

// ─── DELETE (soft-delete, admin only) ────────────────────────────────────────

/**
 * Soft-delete a task by setting isActive = false.
 *
 * Hard deletion is intentionally avoided: tasks that are completed may have
 * blockchain_logs and performance_logs attached — destroying the row would
 * break those audit references.  Setting isActive = false makes the task
 * invisible to all application queries while preserving all relational data.
 *
 * Guards:
 *   1. Task must exist and be active in this org — getTaskById throws 404 if not.
 */
export async function deleteTask(
    orgId: string,
    taskId: string,
): Promise<void> {
    // Org + active guard — throws 404 TASK_NOT_FOUND if not found, wrong org,
    // or already soft-deleted (idempotent from the caller's perspective).
    await getTaskById(orgId, taskId);

    await prisma.task.update({
        where: { id: taskId },
        data: { isActive: false },
    });

    // Invalidate dashboard cache — soft-deletion changes org-level task counts.
    void invalidateDashboardCache(orgId);
}

// ─── UPDATE (full, admin only) ────────────────────────────────────────────────

export interface UpdateTaskInput {
    title?: string;
    description?: string;
    priority?: TaskPriority;
    complexityScore?: number;
    requiredSkills?: string[];
    assignedTo?: string | null;  // null = unassign
    dueDate?: string | null;     // null = clear due date
}

/**
 * Full update of mutable task fields — admin only.
 *
 * Guards:
 *   1. Task must exist in this org (orgId cross-tenant guard).
 *   2. If assignedTo is provided (and not null), employee must be active
 *      and belong to the same org — same guard as createTask.
 *
 * Does NOT modify status or completedAt — those are FSM-guarded by
 * updateTaskStatus().
 */
export async function updateTask(
    orgId: string,
    taskId: string,
    input: UpdateTaskInput,
): Promise<TaskRow> {
    // ── 1. Existence + org guard ─────────────────────────────────────────────
    await getTaskById(orgId, taskId); // throws 404 if not found or wrong org

    // ── 2. Validate new assignedTo belongs to this org ───────────────────────
    if (input.assignedTo != null) {
        const employee = await prisma.employee.findFirst({
            where: { id: input.assignedTo, orgId, isActive: true },
            select: { id: true },
        });
        if (!employee) {
            throw new AppError(
                404,
                'EMPLOYEE_NOT_FOUND',
                'Assigned employee not found or is inactive in this organisation',
            );
        }
    }

    const updated = await prisma.task.update({
        where: { id: taskId },   // safe: org verified in step 1
        data: {
            ...(input.title !== undefined      && { title: input.title }),
            ...(input.description !== undefined && { description: input.description }),
            ...(input.priority !== undefined    && { priority: input.priority }),
            ...(input.complexityScore !== undefined && { complexityScore: input.complexityScore }),
            ...(input.requiredSkills !== undefined  && { requiredSkills: input.requiredSkills }),
            // assignedTo: null unassigns; omitted field → no change
            ...('assignedTo' in input && { assignedTo: input.assignedTo ?? null }),
            // dueDate: null clears; omitted field → no change
            ...('dueDate' in input && {
                dueDate: input.dueDate ? new Date(input.dueDate) : null,
            }),
        },
        select: TASK_SELECT,
    }) as unknown as TaskRow;

    return updated;
}

// ─── UPDATE STATUS ────────────────────────────────────────────────────────────

export interface UpdateTaskStatusInput {
    status: TaskStatus;
}

/**
 * Result returned to the controller after a status transition.
 *
 * scoringDispatched signals that a background job was *queued* — not that it
 * completed. The controller uses this to set _meta.scoringQueued in the
 * response, so the client knows without having to poll.
 */
export interface StatusUpdateResult {
    task: TaskRow;
    scoringDispatched: boolean;   // true iff scoring job was enqueued
}

/**
 * Transition task status following the FSM: ASSIGNED → IN_PROGRESS → COMPLETED.
 *
 * Guards:
 *   1. Existence + org scope: task must exist in this org (SPEC Risk R1).
 *   2. Double-completion guard: explicit reject if status is already COMPLETED
 *      inside the transaction, before the FSM check, so concurrent requests
 *      racing through the same transition both see the DB-authoritative state.
 *   3. Forward-only FSM: invalid transitions throw 422 INVALID_TRANSITION.
 *   4. completedAt is stamped by the server — never accepted from the client.
 *   5. On COMPLETED: async productivity scoring dispatched once via
 *      enqueueScoringJob(). The HTTP response does NOT wait for the job.
 *
 * Concurrency contract:
 *   The read (findFirst) and write (update) are wrapped in prisma.$transaction.
 *   Prisma uses SERIALIZABLE isolation by default for interactive transactions,
 *   which prevents two concurrent requests from both reading status=IN_PROGRESS
 *   and both writing status=COMPLETED.  Only one wins; the other receives a
 *   transaction serialization failure, which Prisma surfaces as a P2034 error
 *   that propagates to the global errorHandler as a 500 (acceptable — the
 *   client can retry, and the task is already COMPLETED by then).
 *
 * Layer contract:
 *   This service knows WHAT job to run (computeProductivityScore) and WHEN
 *   (on completed transition). It does NOT know HOW the job is scheduled —
 *   that is enqueueScoringJob's responsibility. The controller knows WHETHER
 *   a job was dispatched — it does NOT know what the job does.
 */
export async function updateTaskStatus(
    orgId: string,
    taskId: string,
    input: UpdateTaskStatusInput,
): Promise<StatusUpdateResult> {
    // ── Steps 1–4 inside a serializable transaction ───────────────────────────
    // All reads and the write are atomic. A concurrent request racing to mark
    // the same task COMPLETED will either:
    //   a) be serialized after this transaction and see status=COMPLETED → 422, or
    //   b) trigger a Prisma P2034 serialization conflict → 500 (safe to retry).
    const updated = await prisma.$transaction(async (tx) => {
        // ── 1. Existence + org guard (re-read inside tx) ──────────────────────
        const task = await tx.task.findFirst({
            where: { id: taskId, orgId },
            select: {
                status: true,
                completedAt: true,
                assignedTo: true,
            },
        });
        if (!task) {
            throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
        }

        // Prisma returns status as string from a narrow select; cast to the
        // branded enum type so VALID_TRANSITIONS indexing is type-safe.
        const currentStatus = task.status as TaskStatus;

        // ── 2. Double-completion guard ────────────────────────────────────────
        // Explicit check before FSM so the error message is unambiguous.
        // VALID_TRANSITIONS['COMPLETED'] === [] would also catch this, but a
        // dedicated guard makes the intent clear and the error message precise.
        if (currentStatus === 'COMPLETED') {
            throw new AppError(
                422,
                'ALREADY_COMPLETED',
                'Task is already completed. No further status transitions are allowed.',
            );
        }

        // ── 3. Forward-only FSM guard ─────────────────────────────────────────
        const allowedNext = VALID_TRANSITIONS[currentStatus];
        if (!allowedNext.includes(input.status)) {
            throw new AppError(
                422,
                'INVALID_TRANSITION',
                `Cannot transition task from '${currentStatus}' to '${input.status}'. ` +
                `Allowed: ${allowedNext.length ? allowedNext.join(', ') : 'none (terminal state)'}`,
            );
        }

        // ── 4. Server-stamp completedAt + persist ─────────────────────────────
        // completedAt is NEVER accepted from the request body — the client
        // cannot manipulate when a task was marked complete.
        const completedAt = input.status === 'COMPLETED' ? new Date() : task.completedAt;

        return tx.task.update({
            where: { id: taskId },   // safe: existence + org verified above
            data: { status: input.status, completedAt },
            select: TASK_SELECT,
        }) as unknown as Promise<TaskRow>;
    }) as unknown as TaskRow;

    // ── 5. Invalidate dashboard cache ─────────────────────────────────────────
    // Any status change alters org-level counters on the dashboard.
    // Fire-and-forget — Redis errors are swallowed inside invalidateDashboardCache.
    void invalidateDashboardCache(orgId);

    // ── 6. Enqueue background scoring job (fires at most once per completion) ─
    // Conditions:
    //   a) New status is COMPLETED  — guaranteed: ALREADY_COMPLETED guard above
    //      ensures this branch is only ever reached once per task lifetime.
    //   b) Task has an assigned employee — unassigned tasks cannot be scored.
    //
    // enqueueScoringJob() is fire-and-forget at the call site — it does NOT
    // block the HTTP response.
    let scoringDispatched = false;

    if (input.status === 'COMPLETED' && updated.assignedTo) {
        enqueueScoringJob({
            orgId,
            taskId,
            employeeId: updated.assignedTo,
        });
        scoringDispatched = true;
    }

    return { task: updated, scoringDispatched };
}
