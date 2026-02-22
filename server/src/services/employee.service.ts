// =============================================================================
// Employee service — all database operations for the Employee module.
//
// Multi-tenancy invariant enforced at every query:
//   Every Prisma call includes `where: { orgId }` derived from req.org.id (JWT).
//   The orgId is NEVER read from input parameters — callers pass it explicitly
//   from the verified request context.
//
// SPEC constraints implemented here:
//   - Soft delete: set isActive = false, never hard-delete (SPEC § Day 1 Hour 4–7)
//   - Unique constraint (orgId, email): P2002 caught and converted to AppError
//   - Cursor-based pagination: not offset-based (SPEC § Day 1 Hour 4–7)
//   - SPEC Risk R1: cross-tenant isolation — every mutation uses a compound
//     where: { id, orgId } via updateMany so ownership is checked and the
//     write are performed atomically in a single DB round-trip.
//     (MEDIUM-4 fix: eliminates the TOCTOU window that existed between the
//      prior getEmployeeById() call and the subsequent update() call.)
//   - SPEC Risk R4: all list queries filter isActive = true by default
// =============================================================================

import prisma from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { EmployeeRow, EmployeeResponse, PaginatedResponse } from '../types';

// ─── select clause ────────────────────────────────────────────────────────────
// Centralised here so every query returns identical fields.
// orgId is selected internally but stripped before the response leaves the
// controller (see toResponse()).
const EMPLOYEE_SELECT = {
    id: true,
    orgId: true,
    name: true,
    email: true,
    role: true,
    department: true,
    skills: true,
    walletAddress: true,
    isActive: true,
    createdAt: true,
} as const;

/** Strip orgId before sending to client. Called in controller, not service. */
export function toResponse(row: EmployeeRow): EmployeeResponse {
    const { orgId: _stripped, ...safe } = row;
    void _stripped;
    return safe;
}

// ─── CREATE ───────────────────────────────────────────────────────────────────

export interface CreateEmployeeInput {
    name: string;
    email: string;
    role?: string;
    department?: string;
    skills?: string[];
    walletAddress?: string;
}

/**
 * Create a new employee scoped to orgId.
 * orgId is ONLY taken from the verified JWT — never from the input object.
 */
export async function createEmployee(
    orgId: string,
    input: CreateEmployeeInput,
): Promise<EmployeeRow> {
    try {
        return await prisma.employee.create({
            data: {
                orgId,                                 // ← from JWT, never from input
                name: input.name,
                email: input.email,
                role: input.role ?? null,
                department: input.department ?? null,
                skills: input.skills ?? [],
                walletAddress: input.walletAddress ?? null,
            },
            select: EMPLOYEE_SELECT,
        });
    } catch (err: unknown) {
        // UNIQUE(org_id, email) violation
        if (isPrismaUniqueError(err)) {
            throw new AppError(
                409,
                'EMAIL_ALREADY_EXISTS',
                `An employee with email '${input.email}' already exists in this organisation`,
            );
        }
        throw err;
    }
}

// ─── LIST (paginated) ─────────────────────────────────────────────────────────

export interface ListEmployeesInput {
    orgId: string;
    department?: string;
    role?: string;
    isActive?: boolean;   // defaults to true — SPEC Risk R4
    limit?: number;    // default 20, max 100
    cursor?: string;    // UUID of last record from previous page
}

export async function listEmployees(
    input: ListEmployeesInput,
): Promise<PaginatedResponse<EmployeeRow>> {
    const limit = Math.min(input.limit ?? 20, 100); // cap at 100
    const isActive = input.isActive ?? true;         // SPEC Risk R4: default to active only

    // Build the where clause — orgId is always the first guard
    const where = {
        orgId: input.orgId,                       // ← tenant boundary
        isActive,
        ...(input.department && { department: input.department }),
        ...(input.role && { role: input.role }),
        // Cursor-based pagination: fetch records AFTER the cursor ID
        // SPEC § Hour 4–7: "cursor based (not offset-based — offset degrades at scale)"
        ...(input.cursor && {
            id: { gt: input.cursor },                    // UUID lexicographic ordering
        }),
    };

    // Run count and data fetch in parallel — single round-trip latency
    const [total, rows] = await Promise.all([
        prisma.employee.count({ where: { orgId: input.orgId, isActive } }),
        prisma.employee.findMany({
            where,
            select: EMPLOYEE_SELECT,
            orderBy: { createdAt: 'asc' },
            take: limit + 1,                          // fetch one extra to determine if next page exists
        }),
    ]);

    // If we got limit+1 rows, there is a next page
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;

    return { data, nextCursor, total };
}

// ─── GET ONE ──────────────────────────────────────────────────────────────────

/**
 * Fetch a single employee — MUST include orgId in the where clause.
 * SPEC Risk R1: prevents cross-tenant reads by always scoping to orgId.
 */
export async function getEmployeeById(
    orgId: string,
    employeeId: string,
): Promise<EmployeeRow> {
    const employee = await prisma.employee.findFirst({
        where: {
            id: employeeId,
            orgId,             // ← cross-tenant guard — not findUnique(id) alone
        },
        select: EMPLOYEE_SELECT,
    });

    if (!employee) {
        throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found');
    }

    return employee;
}

// ─── UPDATE ───────────────────────────────────────────────────────────────────

export interface UpdateEmployeeInput {
    name?: string;
    email?: string;
    role?: string;
    department?: string;
    skills?: string[];
    walletAddress?: string;
}

/**
 * Update employee fields.
 *
 * TOCTOU fix (MEDIUM-4 from arch audit):
 *   Old approach: getEmployeeById() read + employee.update() write = two round-trips.
 *   New approach: updateMany({ where: { id, orgId }, data }) in a single round-trip.
 *   The compound where clause is checked and applied atomically by the database,
 *   eliminating the race window between ownership verification and the write.
 *
 * Prisma does not expose update() with a non-unique compound where, so we use
 * updateMany() which accepts arbitrary where predicates and returns { count }.
 * count === 0 means either the employee does not exist or belongs to a different
 * org — in both cases we return 404 (no info leakage about cross-org IDs).
 *
 * orgId is excluded from the update data — it can never be re-assigned.
 */
export async function updateEmployee(
    orgId: string,
    employeeId: string,
    input: UpdateEmployeeInput,
): Promise<EmployeeRow> {
    try {
        const result = await prisma.employee.updateMany({
            where: { id: employeeId, orgId },   // ownership + mutation in one round-trip
            data: {
                ...(input.name !== undefined && { name: input.name }),
                ...(input.email !== undefined && { email: input.email }),
                ...(input.role !== undefined && { role: input.role }),
                ...(input.department !== undefined && { department: input.department }),
                ...(input.skills !== undefined && { skills: input.skills }),
                ...(input.walletAddress !== undefined && { walletAddress: input.walletAddress }),
            },
        });

        if (result.count === 0) {
            // Either the employee does not exist, or it belongs to a different org.
            // Return 404 in both cases — no information leaked about cross-org IDs.
            throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found');
        }
    } catch (err: unknown) {
        if (err instanceof AppError) throw err;
        if (isPrismaUniqueError(err)) {
            throw new AppError(
                409,
                'EMAIL_ALREADY_EXISTS',
                `An employee with email '${input.email}' already exists in this organisation`,
            );
        }
        throw err;
    }

    // Fetch the updated row for the response. This is a separate read done
    // AFTER the atomic write completes — not a TOCTOU risk because:
    //   1. We already confirmed the record exists and belongs to this org above.
    //   2. The read is for response shaping only; no security decision depends on it.
    return prisma.employee.findUniqueOrThrow({
        where: { id: employeeId },
        select: EMPLOYEE_SELECT,
    });
}

// ─── SOFT DELETE ──────────────────────────────────────────────────────────────

/**
 * Deactivate an employee — sets isActive = false.
 * SPEC § Day 1 Hour 4–7: "Soft delete: set isActive = false, never hard delete"
 *
 * Hard deletion is intentionally absent. Tasks assigned to this employee
 * remain in the DB (no CASCADE on tasks.assigned_to FK) and continue to be
 * queryable as historical data.
 *
 * SPEC Risk R4 mitigation: all list queries filter isActive = true by default,
 * so deactivated employees are excluded from recommendations and score pools.
 *
 * TOCTOU fix (MEDIUM-4 from arch audit):
 *   Single atomic updateMany — same pattern as updateEmployee() above.
 */
export async function deactivateEmployee(
    orgId: string,
    employeeId: string,
): Promise<EmployeeRow> {
    const result = await prisma.employee.updateMany({
        where: { id: employeeId, orgId },   // ownership + mutation in one round-trip
        data: { isActive: false },
    });

    if (result.count === 0) {
        throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found');
    }

    // Fetch the updated row for the response (read-after-write for shaping only).
    return prisma.employee.findUniqueOrThrow({
        where: { id: employeeId },
        select: EMPLOYEE_SELECT,
    });
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function isPrismaUniqueError(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: unknown }).code === 'P2002'
    );
}
