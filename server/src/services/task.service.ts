// =============================================================================
// Task service — all database operations for the Task module.
//
// Multi-tenancy invariant:
//   orgId is passed in from req.org.id (JWT) at every call site.
//   It is NEVER read from input objects or request bodies.
//
// SPEC constraints:
//   - Status FSM: assigned → in_progress → completed (forward-only)
//     Source of truth: VALID_TRANSITIONS in types/index.ts
//   - completedAt stamped by the server when status → completed
//   - Cursor-based pagination for task list
//   - Cross-tenant guard on get/update: findFirst({ id, orgId })
//   - assignedTo employee must belong to the same org (validated before create)
//
// Background job contract:
//   updateTaskStatus() fires the productivity scoring job via dispatchJob()
//   and returns a typed StatusUpdateResult that tells the controller whether
//   a job was queued — without the controller knowing how the job was dispatched.
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
import { dispatchJob } from '../lib/jobQueue';
import { computeProductivityScore } from './ai.service';

// ─── Select clause ────────────────────────────────────────────────────────────
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
} as const;

/** Strip orgId before sending to client. */
export function toResponse(row: TaskRow): TaskResponse {
    const { orgId: _stripped, ...safe } = row;
    void _stripped;
    return safe;
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
            status: 'assigned',                     // ← always starts at assigned
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
        ...(input.status && { status: input.status }),
        ...(input.assignedTo && { assignedTo: input.assignedTo }),
        ...(input.priority && { priority: input.priority }),
        ...(input.cursor && { id: { gt: input.cursor } }),
    };

    // Count uses same filters minus cursor (for accurate total across all pages)
    const countWhere = {
        orgId: input.orgId,
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
        where: { id: taskId, orgId },    // orgId guard — SPEC Risk R1
        select: TASK_SELECT,
    });

    if (!task) {
        throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }

    return task as unknown as TaskRow;
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
 * Transition task status following the FSM: assigned → in_progress → completed.
 *
 * Guards:
 *   1. Ownership: task must exist in this org (SPEC Risk R1).
 *   2. Forward-only FSM: invalid transitions throw 422 INVALID_TRANSITION.
 *   3. completedAt is stamped by the server — never accepted from the client.
 *   4. On completion: async productivity scoring dispatched via dispatchJob().
 *      The HTTP response does NOT wait for the job.
 *
 * Layer contract:
 *   This service knows WHAT job to run (computeProductivityScore) and WHEN
 *   (on completed transition). It does NOT know HOW the job is scheduled —
 *   that is dispatchJob's responsibility. The controller knows WHETHER a job
 *   was dispatched — it does NOT know what the job does.
 */
export async function updateTaskStatus(
    orgId: string,
    taskId: string,
    input: UpdateTaskStatusInput,
): Promise<StatusUpdateResult> {
    // ── 1. Ownership check ───────────────────────────────────────────────────
    const task = await getTaskById(orgId, taskId);

    // ── 2. FSM transition guard ───────────────────────────────────────────────
    const allowedNext = VALID_TRANSITIONS[task.status];
    if (!allowedNext.includes(input.status)) {
        throw new AppError(
            422,
            'INVALID_TRANSITION',
            `Cannot transition task from '${task.status}' to '${input.status}'. ` +
            `Allowed: ${allowedNext.length ? allowedNext.join(', ') : 'none (terminal state)'}`,
        );
    }

    // ── 3. Server-stamp completedAt ───────────────────────────────────────────
    // completedAt is NEVER accepted from the request body — the client cannot
    // manipulate when a task was marked complete.
    const completedAt = input.status === 'completed' ? new Date() : task.completedAt;

    // ── 4. Persist transition ─────────────────────────────────────────────────
    const updated = await prisma.task.update({
        where: { id: taskId },            // safe: ownership verified in step 1
        data: { status: input.status, completedAt },
        select: TASK_SELECT,
    }) as unknown as TaskRow;

    // ── 5. Dispatch background scoring job ────────────────────────────────────
    // Conditions:
    //   a) New status is 'completed'
    //   b) Task has an assigned employee (unassigned tasks cannot be scored)
    //
    // dispatchJob() queues fn() with setImmediate() and returns synchronously.
    // The HTTP response is sent BEFORE the job runs — zero latency added here.
    // Errors inside the job are caught and logged by dispatchJob — they CANNOT
    // propagate back to this function or to the HTTP response.
    let scoringDispatched = false;

    if (input.status === 'completed' && updated.assignedTo) {
        const employeeId = updated.assignedTo; // captured before closure

        dispatchJob(`computeProductivityScore:task=${taskId}`, () =>
            computeProductivityScore({
                orgId,
                taskId,
                employeeId,
            }),
        );

        scoringDispatched = true;
    }

    return { task: updated, scoringDispatched };
}
