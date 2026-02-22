// api/web3.ts
// =============================================================================
// Typed wrapper for POST /api/web3/log
// Documented in SPEC § 2.3 — Web3 Routes (/api/web3)
//
// Request:  { taskId: string, txHash: string, eventType: "task_completed" }
// Response: { taskId, txHash, eventType, loggedAt }
//
// This module is entirely optional — callers handle null / undefined gracefully.
// =============================================================================

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Web3LogRequest {
    taskId: string;           // off-chain task UUID
    txHash: string;           // 0x-prefixed Ethereum tx hash
    eventType: 'task_completed'; // only event type defined in SPEC
}

export interface Web3LogResponse {
    taskId: string;
    txHash: string;
    eventType: string;
    loggedAt: string;   // ISO timestamp
}

// ─── API call ─────────────────────────────────────────────────────────────────

/**
 * POST /api/web3/log
 *
 * Records the on-chain tx_hash + taskId in the off-chain database so the
 * dashboard can surface an "on-chain verified" badge next to completed tasks.
 *
 * This call is fire-and-forget from the UI perspective:
 *   - If it fails, the task is still marked completed in the backend.
 *   - The frontend logs a console.warn only — no toast is shown on failure.
 *
 * @param token   JWT access token (from useAuth)
 * @param payload { taskId, txHash, eventType }
 * @returns       The stored log record, or null on any error.
 */
export async function postWeb3Log(
    token: string,
    payload: Web3LogRequest,
): Promise<Web3LogResponse | null> {
    try {
        const res = await fetch(`${API_BASE}/web3/log`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            console.warn(
                '[web3] POST /web3/log failed:',
                (json as { message?: string }).message ?? res.status,
            );
            return null;
        }

        const json = await res.json();
        return (json as { data: Web3LogResponse }).data ?? null;
    } catch (err) {
        console.warn('[web3] POST /web3/log network error:', err);
        return null;
    }
}
