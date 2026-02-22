// =============================================================================
// web3.service.ts — business logic for blockchain audit log entries.
//
// Single responsibility: all reads and writes to blockchain_logs.
//
// SPEC § 2.5 (Blockchain Integration):
//   "Every task completion is logged to the WorkforceLogger smart contract.
//    blockchain_logs stores the off-chain record of each on-chain tx."
//
// Multi-tenancy rules enforced here (SPEC § 1.3):
//   - Task ownership verified atomically via { id, orgId } before any insert.
//   - orgId is NEVER read from the request body — always from the verified JWT.
//
// Duplicate prevention:
//   A task may only be logged once. A second attempt returns 409 ALREADY_LOGGED.
//   Rationale: blockchain_logs is an append-only audit trail; re-logging the
//   same task would create a misleading on-chain / off-chain record.
//
// txHash validation:
//   Accepts any 0x-prefixed 64-hex-char string (Ethereum tx hash format, 66
//   chars total). The value is stored verbatim — we do not re-verify on-chain
//   because the contract call is the caller's responsibility.
// =============================================================================

import prisma from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';

// ─── Response shape ───────────────────────────────────────────────────────────

export interface BlockchainLogResponse {
    id: string;
    orgId: string;    // internal — stripped in controller before API response
    taskId: string;
    txHash: string;
    eventType: string;
    loggedAt: Date;
}

// ─── Input ────────────────────────────────────────────────────────────────────

export interface LogTaskInput {
    orgId: string;   // from JWT — never from request body
    taskId: string;   // UUID
    txHash: string;   // 0x + 64 hex chars
}

// ─── Service function ─────────────────────────────────────────────────────────

/**
 * Record an on-chain task-completion event in blockchain_logs.
 *
 * Steps (all in the same DB connection, no transaction needed):
 *   1. Verify the task exists and belongs to this org.
 *      Uses findFirst({ where: { id, orgId } }) — atomic ownership check.
 *   2. Guard against duplicate logging.
 *      A second POST for the same taskId returns 409 ALREADY_LOGGED.
 *   3. Insert the blockchain_log row.
 *
 * Why no Prisma transaction?
 *   The three operations are read-then-write. The insertion itself is
 *   idempotent-guarded by the duplicate check immediately before it; if two
 *   concurrent requests race, the second will also pass the check but both
 *   inserts will succeed — creating two rows. To rule this out completely a
 *   UNIQUE(task_id) DB constraint would be required (not in current SPEC schema).
 *   For the current SPEC scope this sequential guard is sufficient.
 */
export async function logBlockchainEntry(
    input: LogTaskInput,
): Promise<BlockchainLogResponse> {
    const { orgId, taskId, txHash } = input;

    // ── 1. Task ownership check ───────────────────────────────────────────────
    // findFirst with { id, orgId } — same compound-where pattern used everywhere
    // in the codebase. Returns null for both "not found" and "wrong org" —
    // 404 in both cases to prevent cross-tenant ID enumeration.
    const task = await prisma.task.findFirst({
        where: { id: taskId, orgId },
        select: { id: true },
    });

    if (!task) {
        throw new AppError(
            404,
            'TASK_NOT_FOUND',
            'Task not found',
        );
    }

    // ── 2. Duplicate check ────────────────────────────────────────────────────
    // A task may only appear once in blockchain_logs.
    // We scope by orgId as well so the check cannot be confused across tenants.
    const existing = await prisma.blockchainLog.findFirst({
        where: { taskId, orgId },
        select: { id: true },
    });

    if (existing) {
        throw new AppError(
            409,
            'ALREADY_LOGGED',
            'This task has already been logged to the blockchain',
        );
    }

    // ── 3. Insert ─────────────────────────────────────────────────────────────
    const log = await prisma.blockchainLog.create({
        data: {
            orgId,
            taskId,
            txHash,
            // eventType defaults to 'task_completed' per schema — no override needed
        },
        select: {
            id: true,
            orgId: true,
            taskId: true,
            txHash: true,
            eventType: true,
            loggedAt: true,
        },
    });

    return log;
}
