// =============================================================================
// web3.controller.ts — HTTP layer for /api/web3/* routes.
//
// Responsibility boundary:
//   - Extract orgId from req.org.id (JWT-derived, NEVER from req.body)
//   - Validate body with Zod
//   - Call web3.service
//   - Strip internal fields (orgId) before sending response
//   - Forward errors via next(err) to global errorHandler
//
// Routes handled:
//   POST /api/web3/log → logBlockchainEntryHandler
// =============================================================================

import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { sendSuccess } from '../utils/response';
import { AppError } from '../middleware/errorHandler';
import { logBlockchainEntry } from '../services/web3.service';

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
            // authMiddleware always sets req.user before this runs.
            // This guard exists for future callers that bypass middleware in tests.
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

        // ── 3. Service call ───────────────────────────────────────────────────
        const log = await logBlockchainEntry({ orgId, taskId, txHash });

        // ── 4. Respond ────────────────────────────────────────────────────────
        sendSuccess(res, toResponse(log), 201);
    } catch (err) {
        next(err);
    }
}
