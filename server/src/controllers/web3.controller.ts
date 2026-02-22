// =============================================================================
// web3.controller.ts — HTTP layer for /api/web3/* routes.
//
// Responsibility boundary:
//   - Extract orgId from req.user.orgId (JWT-derived, NEVER from req.body)
//   - Validate body with Zod
//   - Call web3.service
//   - Strip internal fields (orgId) before sending response
//   - Forward errors via next(err) to global errorHandler
//
// Routes handled:
//   POST /api/web3/log  → logBlockchainEntryHandler  (admin OR assigned employee)
//   GET  /api/web3/logs → listBlockchainLogsHandler  (admin: all; employee: own)
// =============================================================================

import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { sendSuccess } from '../utils/response';
import { AppError } from '../middleware/errorHandler';
import { logBlockchainEntry, listBlockchainLogs } from '../services/web3.service';

// ─── Zod schema ───────────────────────────────────────────────────────────────

/**
 * Ethereum tx hash: exactly "0x" followed by 64 lowercase hex characters.
 * Total length: 66 chars — matches the VARCHAR(66) column in blockchain_logs.
 *
 * We allow uppercase hex as well (some wallets emit mixed case) and normalise
 * to lowercase before storage via .toLowerCase().
 */
const TX_HASH_REGEX = /^0x[0-9a-fA-F]{64}$/;

const LogBlockchainSchema = z.object({
    taskId: z
        .string()
        .uuid('taskId must be a valid UUID'),

    txHash: z
        .string()
        .regex(TX_HASH_REGEX, 'txHash must be a 0x-prefixed 64-hex-char Ethereum transaction hash')
        .transform((h) => h.toLowerCase()),   // normalise to lowercase for consistent storage
});

// ─── Response shaping ─────────────────────────────────────────────────────────

/** Strip orgId before sending to the client — it is internal only. */
function toResponse(log: {
    id: string;
    orgId: string;
    taskId: string;
    txHash: string;
    eventType: string;
    loggedAt: Date;
}) {
    const { orgId: _stripped, ...safe } = log;
    void _stripped;
    return safe;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

/**
 * POST /api/web3/log
 *
 * Body:
 *   { taskId: UUID, txHash: "0x" + 64 hex chars }
 *
 * Success 201:
 *   { success: true, data: { id, taskId, txHash, eventType, loggedAt } }
 *
 * Errors:
 *   400  VALIDATION_ERROR   — body fails Zod schema
 *   401  UNAUTHORIZED       — missing / invalid JWT (enforced by authMiddleware)
 *   403  FORBIDDEN          — EMPLOYEE trying to log a task not assigned to them
 *   404  TASK_NOT_FOUND     — task does not exist or belongs to a different org
 *   409  ALREADY_LOGGED     — this task has already been logged
 */
export async function logBlockchainEntryHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        // ── 1. Tenant context from JWT — never from body ──────────────────────
        const orgId = req.user?.orgId;
        if (!orgId) {
            throw new AppError(401, 'UNAUTHORIZED', 'Missing org context');
        }

        // ── 2. Validate body ──────────────────────────────────────────────────
        const parseResult = LogBlockchainSchema.safeParse(req.body);
        if (!parseResult.success) {
            throw new AppError(
                400,
                'VALIDATION_ERROR',
                parseResult.error.errors.map((e) => e.message).join('; '),
            );
        }
        const { taskId, txHash } = parseResult.data;

        // ── 3. EMPLOYEE ownership — pass employeeId so service can enforce it ─
        // ADMINs pass undefined → service skips the ownership check.
        // EMPLOYEEs pass their employeeId → service verifies task.assignedTo matches.
        // employeeId null means user has no linked profile — service will 403 because
        // task.assignedTo (always a UUID or null) can never equal null as a match.
        const requestingEmployeeId =
            req.user!.role === 'EMPLOYEE'
                ? (req.user!.employeeId ?? undefined)
                : undefined;

        // ── 4. Service call ───────────────────────────────────────────────────
        const log = await logBlockchainEntry({ orgId, taskId, txHash, requestingEmployeeId });

        // ── 5. Respond ────────────────────────────────────────────────────────
        sendSuccess(res, toResponse(log), 201);
    } catch (err) {
        next(err);
    }
}

// ─── GET /api/web3/logs ───────────────────────────────────────────────────────

/**
 * GET /api/web3/logs
 *
 * Returns blockchain log entries for this org, ordered most-recent first.
 *
 * ADMIN: sees all logs in the org.
 * EMPLOYEE: sees only logs for tasks assigned to them (filtered via
 *   tasks.assignedTo = req.user.employeeId in the service layer).
 *
 * Success 200:
 *   { success: true, data: [ { id, taskId, txHash, eventType, loggedAt }, … ] }
 *
 * Errors:
 *   401  UNAUTHORIZED — missing / invalid JWT (enforced by authMiddleware)
 */
export async function listBlockchainLogsHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId = req.user?.orgId;
        if (!orgId) {
            throw new AppError(401, 'UNAUTHORIZED', 'Missing org context');
        }

        // EMPLOYEE: scope to tasks assigned to them.
        // If employeeId is null (no linked profile), return empty immediately —
        // passing undefined to the service would fall through to the admin path
        // and leak all org logs.
        if (req.user!.role === 'EMPLOYEE' && req.user!.employeeId === null) {
            sendSuccess(res, []);
            return;
        }

        const employeeId =
            req.user!.role === 'EMPLOYEE'
                ? req.user!.employeeId!              // non-null guaranteed by guard above
                : undefined;                         // ADMIN: no filter, sees all org logs

        const logs = await listBlockchainLogs({ orgId, employeeId });

        sendSuccess(res, logs.map(toResponse));
    } catch (err) {
        next(err);
    }
}
