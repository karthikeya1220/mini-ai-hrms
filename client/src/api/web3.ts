// api/web3.ts — typed wrapper for /api/web3/* endpoints.
//
// All calls use the shared Axios client (api/client.ts).
// Authorization header and TOKEN_EXPIRED refresh are handled automatically.
// Token is no longer a parameter on any function.

import { client } from './client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Web3LogRequest {
    taskId: string;              // off-chain task UUID
    txHash: string;              // 0x-prefixed Ethereum tx hash
    eventType: 'task_completed'; // only event type defined in SPEC
}

export interface Web3LogResponse {
    taskId: string;
    txHash: string;
    eventType: string;
    loggedAt: string;   // ISO timestamp
}

// ─── POST /api/web3/log ───────────────────────────────────────────────────────

/**
 * Records the on-chain tx_hash + taskId in the off-chain database.
 *
 * Fire-and-forget contract: if the call fails for any reason, null is returned
 * and a console.warn is emitted — no toast is shown.  The task is still marked
 * completed server-side regardless of whether this call succeeds.
 */
export async function postWeb3Log(payload: Web3LogRequest): Promise<Web3LogResponse | null> {
    try {
        const res = await client.post<{ success: true; data: Web3LogResponse }>('/web3/log', payload);
        return res.data.data;
    } catch (err) {
        console.warn('[web3] POST /web3/log failed:', err);
        return null;
    }
}

// ─── GET /api/web3/logs ───────────────────────────────────────────────────────

/**
 * Returns blockchain log entries for the current user's org.
 * ADMIN sees all; EMPLOYEE sees only logs for their own tasks (server-filtered).
 */
export async function getWeb3Logs(): Promise<Web3LogResponse[]> {
    const res = await client.get<{ success: true; data: Web3LogResponse[] }>('/web3/logs');
    return res.data.data;
}

