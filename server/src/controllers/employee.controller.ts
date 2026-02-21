// =============================================================================
// Employee controller — HTTP layer for /api/employees/* routes.
//
// Responsibility boundary:
//   - Extract orgId from req.org.id (JWT-derived, never req.body)
//   - Parse and validate request body / query params with Zod
//   - Call the employee service
//   - Strip orgId from response via toResponse()
//   - Forward errors to the global errorHandler via next(err)
//
// SPEC § 2.4 Employee Routes:
//   GET  /api/employees           → listEmployeesHandler
//   POST /api/employees           → createEmployeeHandler
//   GET  /api/employees/:id       → getEmployeeHandler
//   PUT  /api/employees/:id       → updateEmployeeHandler
//   DELETE /api/employees/:id     → deactivateEmployeeHandler (soft delete)
// =============================================================================

import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { sendSuccess } from '../utils/response';
import {
    createEmployee,
    listEmployees,
    getEmployeeById,
    updateEmployee,
    deactivateEmployee,
    toResponse,
} from '../services/employee.service';

// ─── Zod schemas ──────────────────────────────────────────────────────────────
// SPEC § 5.2: "All inputs validated with Zod schemas before touching the database"

// EVM wallet address: optional, must be 42 chars starting with 0x
const WalletAddressSchema = z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'walletAddress must be a valid EVM address (0x + 40 hex chars)')
    .optional();

const CreateEmployeeSchema = z.object({
    name: z.string().min(1, 'Name is required').max(255),
    email: z.string().email('Invalid email').max(255),
    role: z.string().max(100).optional(),
    department: z.string().max(100).optional(),
    skills: z.array(z.string().min(1)).default([]),
    walletAddress: WalletAddressSchema,
    // orgId intentionally absent — it is NEVER accepted from the request body
});

const UpdateEmployeeSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    email: z.string().email('Invalid email').max(255).optional(),
    role: z.string().max(100).optional(),
    department: z.string().max(100).optional(),
    skills: z.array(z.string().min(1)).optional(),
    walletAddress: WalletAddressSchema,
}).refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one field must be provided for update' },
);

const ListQuerySchema = z.object({
    department: z.string().optional(),
    role: z.string().optional(),
    // isActive: defaults to true (active only) — can be overridden to 'false' for admin views
    isActive: z.enum(['true', 'false']).optional().transform((v) => v !== 'false'),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().uuid('cursor must be a UUID').optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Read orgId exclusively from the verified JWT payload on req.org. */
function requireOrgId(req: AuthRequest): string {
    // req.org is guaranteed by authMiddleware — non-null assertion is correct here.
    return req.org!.id;
}

// ─── POST /api/employees ──────────────────────────────────────────────────────

export async function createEmployeeHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId = requireOrgId(req);
        const input = CreateEmployeeSchema.parse(req.body);

        const employee = await createEmployee(orgId, input);

        sendSuccess(res, toResponse(employee), 201);
    } catch (err) {
        next(err);
    }
}

// ─── GET /api/employees ───────────────────────────────────────────────────────

export async function listEmployeesHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId = requireOrgId(req);
        const query = ListQuerySchema.parse(req.query);

        const result = await listEmployees({
            orgId,
            department: query.department,
            role: query.role,
            isActive: query.isActive,
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

// ─── GET /api/employees/:id ───────────────────────────────────────────────────

export async function getEmployeeHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId = requireOrgId(req);
        const employeeId = req.params.id;

        const employee = await getEmployeeById(orgId, employeeId);

        sendSuccess(res, toResponse(employee));
    } catch (err) {
        next(err);
    }
}

// ─── PUT /api/employees/:id ───────────────────────────────────────────────────

export async function updateEmployeeHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId = requireOrgId(req);
        const employeeId = req.params.id;
        const input = UpdateEmployeeSchema.parse(req.body);

        const employee = await updateEmployee(orgId, employeeId, input);

        sendSuccess(res, toResponse(employee));
    } catch (err) {
        next(err);
    }
}

// ─── DELETE /api/employees/:id (soft deactivate) ─────────────────────────────

export async function deactivateEmployeeHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId = requireOrgId(req);
        const employeeId = req.params.id;

        const employee = await deactivateEmployee(orgId, employeeId);

        // Return the updated record so the client can immediately update local state
        sendSuccess(res, toResponse(employee));
    } catch (err) {
        next(err);
    }
}
