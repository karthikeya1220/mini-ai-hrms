// =============================================================================
// Task controller — HTTP layer for /api/tasks/* routes.
//
// Responsibility boundary:
//   - Extract orgId from req.user.orgId (JWT-derived, never req.body)
//   - Validate body / query params with Zod
//   - Call task service
//   - Strip orgId from response via toResponse()
//   - Forward errors to global errorHandler via next(err)
//
// Routes handled:
//   GET    /api/tasks             → listTasksHandler       (admin: all; employee: own)
//   POST   /api/tasks             → createTaskHandler      (admin only)
//   GET    /api/tasks/:id         → getTaskHandler         (all authenticated)
//   PUT    /api/tasks/:id         → updateTaskHandler      (admin only)
//   PUT    /api/tasks/:id/status  → updateStatusHandler    (admin OR assigned employee)
// =============================================================================

import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { sendSuccess, sendError } from '../utils/response';
import {
    createTask,
    listTasks,
    getTaskById,
    updateTask,
    deleteTask,
    updateTaskStatus,
    toResponse,
} from '../services/task.service';

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const PriorityEnum = z.enum(['low', 'medium', 'high']);
const StatusEnum = z.enum(['ASSIGNED', 'IN_PROGRESS', 'COMPLETED']);

const CreateTaskSchema = z.object({
    title: z.string().min(1, 'Title is required').max(255),
    description: z.string().max(5000).optional(),
    priority: PriorityEnum.default('medium'),
    complexityScore: z.number().int().min(1).max(5).default(3),
    requiredSkills: z.array(z.string().min(1)).default([]),
    assignedTo: z.string().uuid('assignedTo must be a valid employee UUID').optional(),
    dueDate: z.string().datetime({ message: 'dueDate must be an ISO 8601 datetime' }).optional(),
    // orgId intentionally absent — NEVER accepted from client
});

const UpdateTaskSchema = z.object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().max(5000).optional(),
    priority: PriorityEnum.optional(),
    complexityScore: z.number().int().min(1).max(5).optional(),
    requiredSkills: z.array(z.string().min(1)).optional(),
    assignedTo: z.string().uuid('assignedTo must be a valid employee UUID').nullable().optional(),
    dueDate: z.string().datetime({ message: 'dueDate must be an ISO 8601 datetime' }).nullable().optional(),
    // status intentionally absent — status transitions go through PUT /:id/status
    // orgId intentionally absent — NEVER accepted from client
});

const UpdateStatusSchema = z.object({
    status: StatusEnum,
    // completedAt intentionally absent — stamped by server on completion
});

const ListQuerySchema = z.object({
    status: StatusEnum.optional(),
    assignedTo: z.string().uuid().optional(),
    priority: PriorityEnum.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().uuid('cursor must be a UUID').optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireOrgId(req: AuthRequest): string {
    return req.user!.orgId; // guaranteed by authMiddleware
}

// ─── POST /api/tasks ──────────────────────────────────────────────────────────
// Admin only — role gate enforced in routes/tasks.ts.

export async function createTaskHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId = requireOrgId(req);
        const input = CreateTaskSchema.parse(req.body);

        const task = await createTask(orgId, input);
        sendSuccess(res, toResponse(task), 201);
    } catch (err) {
        next(err);
    }
}

// ─── GET /api/tasks ───────────────────────────────────────────────────────────
// ADMIN → all tasks in org, honours all query filters.
// EMPLOYEE → only tasks assigned to their employee profile; assignedTo filter
//            is forced to their employeeId and cannot be overridden by query params.

export async function listTasksHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId  = requireOrgId(req);
        const user   = req.user!;
        const query  = ListQuerySchema.parse(req.query);

        // EMPLOYEE: scope to their own tasks unconditionally.
        // The client-supplied assignedTo param is silently ignored — an employee
        // must not be able to list another employee's tasks by passing their UUID.
        const assignedTo =
            user.role === 'EMPLOYEE'
                ? (user.employeeId ?? undefined)  // null employeeId → no results (no filter match)
                : query.assignedTo;               // ADMIN: honour the query param as-is

        const result = await listTasks({
            orgId,
            status:      query.status,
            assignedTo,
            priority:    query.priority,
            limit:       query.limit,
            cursor:      query.cursor,
        });

        sendSuccess(res, {
            data:       result.data.map(toResponse),
            nextCursor: result.nextCursor,
            total:      result.total,
        });
    } catch (err) {
        next(err);
    }
}

// ─── GET /api/tasks/:id ───────────────────────────────────────────────────────
// All authenticated users — orgId scoping is applied inside getTaskById.

export async function getTaskHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId  = requireOrgId(req);
        const taskId = req.params.id;

        const task = await getTaskById(orgId, taskId);
        sendSuccess(res, toResponse(task));
    } catch (err) {
        next(err);
    }
}

// ─── PUT /api/tasks/:id ───────────────────────────────────────────────────────
// Admin only — full update of mutable fields.
// Status is NOT updated here; use PUT /:id/status for FSM-guarded transitions.

export async function updateTaskHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId  = requireOrgId(req);
        const taskId = req.params.id;
        const input  = UpdateTaskSchema.parse(req.body);

        const task = await updateTask(orgId, taskId, input);
        sendSuccess(res, toResponse(task));
    } catch (err) {
        next(err);
    }
}

// ─── PUT /api/tasks/:id/status ────────────────────────────────────────────────
// ADMIN: may transition any task in the org.
// EMPLOYEE: may only transition a task assigned to them.
//
// Ownership is enforced here — not in middleware — because the task's
// assignedTo field is in the DB, not in req.params.  The middleware layer
// cannot perform this check without a DB call; the service already fetches
// the task row, so we reuse that fetch via getTaskById before delegating.

export async function updateStatusHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId  = requireOrgId(req);
        const taskId = req.params.id;
        const user   = req.user!;
        const input  = UpdateStatusSchema.parse(req.body);

        // EMPLOYEE ownership check — must happen before updateTaskStatus so we
        // can reject without performing the FSM transition.
        if (user.role === 'EMPLOYEE') {
            const task = await getTaskById(orgId, taskId);

            // employeeId null → no linked profile → can never own a task.
            if (!user.employeeId || task.assignedTo !== user.employeeId) {
                sendError(
                    res,
                    403,
                    'FORBIDDEN',
                    'You can only update the status of tasks assigned to you.',
                );
                return;
            }
        }

        const { task, scoringDispatched } = await updateTaskStatus(orgId, taskId, input);

        sendSuccess(res, {
            ...toResponse(task),
            ...(scoringDispatched && { _meta: { scoringQueued: true } }),
        });
    } catch (err) {
        next(err);
    }
}

// ─── DELETE /api/tasks/:id ────────────────────────────────────────────────────
// Admin only — hard delete. Role gate enforced in routes/tasks.ts.

export async function deleteTaskHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId  = requireOrgId(req);
        const taskId = req.params.id;

        await deleteTask(orgId, taskId);
        sendSuccess(res, { id: taskId }, 200);
    } catch (err) {
        next(err);
    }
}
