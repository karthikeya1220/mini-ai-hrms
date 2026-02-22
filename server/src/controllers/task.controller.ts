// =============================================================================
// Task controller — HTTP layer for /api/tasks/* routes.
//
// Responsibility boundary:
//   - Extract orgId from req.org.id (JWT-derived, never req.body)
//   - Validate body / query params with Zod
//   - Call task service
//   - Strip orgId from response via toResponse()
//   - Forward errors to global errorHandler via next(err)
//
// Routes handled:
//   GET  /api/tasks           → listTasksHandler
//   POST /api/tasks           → createTaskHandler
//   GET  /api/tasks/:id       → getTaskHandler
//   PUT  /api/tasks/:id/status → updateStatusHandler
// =============================================================================

import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { sendSuccess } from '../utils/response';
import {
    createTask,
    listTasks,
    getTaskById,
    updateTaskStatus,
    toResponse,
} from '../services/task.service';

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const PriorityEnum = z.enum(['low', 'medium', 'high']);
const StatusEnum = z.enum(['assigned', 'in_progress', 'completed']);

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

export async function listTasksHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId = requireOrgId(req);
        const query = ListQuerySchema.parse(req.query);

        const result = await listTasks({
            orgId,
            status: query.status,
            assignedTo: query.assignedTo,
            priority: query.priority,
            limit: query.limit,
            cursor: query.cursor,
        });

        sendSuccess(res, {
            data: result.data.map(toResponse),
            nextCursor: result.nextCursor,
            total: result.total,
        });
    } catch (err) {
        next(err);
    }
}

// ─── GET /api/tasks/my ────────────────────────────────────────────────────────

export async function listMyTasksHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId = requireOrgId(req);
        const userId = req.user!.id;
        const query = ListQuerySchema.parse(req.query);

        const result = await listTasks({
            orgId,
            status: query.status,
            assignedTo: userId, // Force assignedTo to current user ID
            priority: query.priority,
            limit: query.limit,
            cursor: query.cursor,
        });

        sendSuccess(res, {
            data: result.data.map(toResponse),
            nextCursor: result.nextCursor,
            total: result.total,
        });
    } catch (err) {
        next(err);
    }
}

// ─── GET /api/tasks/:id ───────────────────────────────────────────────────────

export async function getTaskHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId = requireOrgId(req);
        const taskId = req.params.id;

        const task = await getTaskById(orgId, taskId);
        sendSuccess(res, toResponse(task));
    } catch (err) {
        next(err);
    }
}

// ─── PUT /api/tasks/:id/status ────────────────────────────────────────────────

export async function updateStatusHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId = requireOrgId(req);
        const taskId = req.params.id;
        const input = UpdateStatusSchema.parse(req.body);

        // updateTaskStatus returns a typed result — the controller does NOT need to
        // re-inspect task.status or task.assignedTo to know whether scoring was dispatched.
        // That decision belongs in the service; the controller just reads the flag.
        const { task, scoringDispatched } = await updateTaskStatus(orgId, taskId, input);

        sendSuccess(res, {
            ...toResponse(task),
            // _meta is informational — not part of the core data contract.
            // scoringQueued = true means a background job was QUEUED, not completed.
            ...(scoringDispatched && { _meta: { scoringQueued: true } }),
        });
    } catch (err) {
        next(err);
    }
}
