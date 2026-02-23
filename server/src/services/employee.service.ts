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
import { hashPassword } from '../utils/hash';
import { EmployeeRow, EmployeeResponse, PaginatedResponse } from '../types';

// ─── Crypto — temporary password generation ───────────────────────────────────
import { randomBytes } from 'crypto';

/** Generate a cryptographically random temporary password (16 url-safe chars). */
function generateTempPassword(): string {
    return randomBytes(12).toString('base64url'); // 16-char url-safe string
}

// ─── select clause ────────────────────────────────────────────────────────────
// Centralised here so every query returns identical fields.
// orgId is selected internally but stripped before the response leaves the
// controller (see toResponse()).
const EMPLOYEE_SELECT = {
    id: true,
    orgId: true,
    name: true,
    email: true,
    jobTitle: true,
    department: true,
    skills: true,
    walletAddress: true,
    isActive: true,
    createdAt: true,
} as const;

/** Read type from Prisma effectively */
type PrismaEmployeeRow = {
    id: string;
    orgId: string;
    name: string;
    email: string;
    jobTitle: string | null;
    department: string | null;
    skills: string[];
    walletAddress: string | null;
    isActive: boolean;
    createdAt: Date;
};

function mapRow(row: PrismaEmployeeRow): EmployeeRow {
    return { ...row };
}

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
    jobTitle?: string;
    department?: string;
    skills?: string[];
    walletAddress?: string;
}

/**
 * Return shape for createEmployee — includes the employee record and the newly
 * created user account (passwordHash is always omitted before leaving the service).
 */
export interface CreateEmployeeResult {
    employee: EmployeeRow;
    user: {
        id: string;
        email: string;
        role: 'ADMIN' | 'EMPLOYEE';
        employeeId: string;
        createdAt: Date;
    };
    /** Plain-text temporary password — return to the admin once; never stored again. */
    temporaryPassword: string;
}

/**
 * Create a new employee + a corresponding User auth account inside a single
 * Prisma transaction.
 *
 * Flow:
 *   1. Generate a cryptographically random temporary password.
 *   2. Hash it with bcrypt (12 rounds).
 *   3. $transaction([
 *        a. prisma.employee.create  — inserts the Employee profile row.
 *        b. prisma.user.create      — inserts the User auth row, linking
 *                                     employeeId → the new employee's id.
 *      ])
 *   4. Return { employee, user (no passwordHash), temporaryPassword }.
 *
 * The admin receives temporaryPassword once in the API response so they can
 * communicate it to the new employee out-of-band.  It is never stored in
 * plain text and is not retrievable after this call.
 *
 * orgId is ONLY taken from the verified JWT — never from the input object.
 */
export async function createEmployee(
    orgId: string,
    input: CreateEmployeeInput,
): Promise<CreateEmployeeResult> {
    // 1. Generate + hash temporary password before opening the transaction
    //    so that the async bcrypt work does not hold the transaction open.
    const temporaryPassword = generateTempPassword();
    const passwordHash = await hashPassword(temporaryPassword);

    // Use an interactive transaction so we can reference the employee.id when
    // creating the User row in the same atomic operation.
    try {
        const result = await prisma.$transaction(async (tx) => {
            // Step A — Employee profile
            const employee = await tx.employee.create({
                data: {
                    orgId,
                    name:          input.name,
                    email:         input.email,
                    passwordHash,
                    jobTitle:      input.jobTitle ?? null,
                    department:    input.department  ?? null,
                    skills:        input.skills      ?? [],
                    walletAddress: input.walletAddress ?? null,
                },
                select: EMPLOYEE_SELECT,
            });

            // Step B — User auth account linked to the employee
            const user = await tx.user.create({
                data: {
                    orgId,
                    employeeId:   employee.id,   // FK → employees(id)
                    email:        input.email,
                    passwordHash,
                    role:         'EMPLOYEE',    // always EMPLOYEE for created staff
                    tokenVersion: 0,
                    isActive:     true,
                },
                select: {
                    id:         true,
                    email:      true,
                    role:       true,
                    employeeId: true,
                    createdAt:  true,
                    // passwordHash intentionally excluded
                },
            });

            return {
                employee: mapRow(employee),
                // employeeId is guaranteed non-null: we supplied employee.id above.
                // The Prisma column is nullable (String?) so we narrow here.
                user: { ...user, employeeId: user.employeeId! },
            };
        });

        return { ...result, temporaryPassword };
    } catch (err: unknown) {
        // UNIQUE(org_id, email) on Employee  OR  UNIQUE(email) on User
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

/**
 * Encode the last row of a page into an opaque cursor token.
 * Format (before base64): "<ISO-timestamp>|<uuid>"
 * Using both createdAt AND id gives a stable, globally-unique composite key:
 *   - createdAt alone is not unique (rows inserted in the same ms clash)
 *   - id alone has no defined insertion order (UUID v4 is random)
 */
function encodeCursor(createdAt: Date, id: string): string {
    return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(token: string): { createdAt: Date; id: string } {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const pipe = raw.lastIndexOf('|');
    if (pipe === -1) throw new AppError(400, 'BAD_CURSOR', 'Invalid pagination cursor');
    return {
        createdAt: new Date(raw.slice(0, pipe)),
        id:        raw.slice(pipe + 1),
    };
}

export interface ListEmployeesInput {
    orgId: string;
    department?: string;
    jobTitle?: string;
    isActive?: boolean;   // defaults to true — SPEC Risk R4
    limit?: number;    // default 20, max 100
    cursor?: string;    // opaque base64url token encoding (createdAt, id) of last row
}

export async function listEmployees(
    input: ListEmployeesInput,
): Promise<PaginatedResponse<EmployeeRow>> {
    const limit  = Math.min(input.limit ?? 20, 100); // cap at 100
    const isActive = input.isActive ?? true;          // SPEC Risk R4: default to active only

    // ── Composite-cursor WHERE clause ─────────────────────────────────────────
    // Ordering is (createdAt ASC, id ASC).  To continue from the last seen row
    // we want rows where:
    //   createdAt > cursorTs  OR  (createdAt = cursorTs AND id > cursorId)
    // This is the standard "seek method" / keyset pagination pattern; it is
    // stable even when rows share a createdAt timestamp.
    let cursorWhere: object = {};
    if (input.cursor) {
        const { createdAt: cursorTs, id: cursorId } = decodeCursor(input.cursor);
        cursorWhere = {
            OR: [
                { createdAt: { gt: cursorTs } },
                { createdAt: cursorTs, id: { gt: cursorId } },
            ],
        };
    }

    const baseWhere = {
        orgId: input.orgId,                       // ← tenant boundary — always first
        isActive,
        ...(input.department && { department: input.department }),
        ...(input.jobTitle   && { jobTitle:   input.jobTitle   }),
    };

    const where = { ...baseWhere, ...cursorWhere };

    // Run count and data fetch in parallel — single round-trip latency.
    // Count uses only baseWhere (cursor position must not shrink the total count).
    const [total, rows] = await Promise.all([
        prisma.employee.count({ where: baseWhere }),
        prisma.employee.findMany({
            where,
            select:  EMPLOYEE_SELECT,
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], // composite, stable ordering
            take:    limit + 1,                               // +1 to detect next page
        }),
    ]);

    // If we got limit+1 rows, there is a next page
    const hasMore  = rows.length > limit;
    const dataRaw  = hasMore ? rows.slice(0, limit) : rows;
    const data     = dataRaw.map((r) => mapRow(r));

    // Encode the composite cursor from the last returned row
    const lastRow   = dataRaw[dataRaw.length - 1];
    const nextCursor = hasMore && lastRow
        ? encodeCursor(lastRow.createdAt, lastRow.id)
        : null;

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

    return mapRow(employee);
}

// ─── UPDATE ───────────────────────────────────────────────────────────────────

export interface UpdateEmployeeInput {
    name?: string;
    email?: string;
    jobTitle?: string;
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
                ...(input.jobTitle !== undefined && { jobTitle: input.jobTitle }),
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

    // AFTER the atomic write completes — not a TOCTOU risk because:
    //   1. We already confirmed the record exists and belongs to this org above.
    //   2. The read is for response shaping only; no security decision depends on it.
    //   orgId included so a cross-tenant read is structurally impossible.
    const employee = await prisma.employee.findFirstOrThrow({
        where:  { id: employeeId, orgId },
        select: EMPLOYEE_SELECT,
    });
    return mapRow(employee);
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
    // Atomically disable the Employee row AND its linked User account so that
    // in-flight sessions are rejected by authMiddleware's isActive check.
    const [result] = await prisma.$transaction([
        prisma.employee.updateMany({
            where: { id: employeeId, orgId },   // ownership guard — org-scoped
            data:  { isActive: false },
        }),
        prisma.user.updateMany({
            where: { employeeId, orgId },       // same ownership guard on User side
            data:  { isActive: false },
        }),
    ]);

    if (result.count === 0) {
        throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found');
    }

    // Read-after-write only for response shaping — ownership already enforced above.
    //   orgId included so a cross-tenant read is structurally impossible.
    const employee = await prisma.employee.findFirstOrThrow({
        where:  { id: employeeId, orgId },
        select: EMPLOYEE_SELECT,
    });
    return mapRow(employee);
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
