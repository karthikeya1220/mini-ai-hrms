// =============================================================================
// server/src/lib/web3.ts — WorkforceLogger integration
//
// Responsibility:
//   Provide a single typed interface for the backend to:
//     1. Register an org on-chain (once, on org creation).
//     2. Log a task completion on-chain (called by updateTaskStatus service).
//
// This module is non-blocking by design:
//   - logTaskCompletion() resolves after `tx.wait(1)` — one on-chain
//     confirmation — so it does not hold up the HTTP response.
//   - The caller (task.service.ts) wraps this in dispatchJob() and never
//     awaits it in the request path.
//
// Required environment variables (all three must be set to enable web3):
//   WEB3_RPC_URL              — JSON-RPC URL (Alchemy / Infura / Amoy public node)
//   WORKFORCE_LOGGER_ADDRESS  — deployed contract address (output of deploy script)
//   DEPLOYER_PRIVATE_KEY      — private key of the wallet used to sign txs
//
// All three are optional at startup (the module initialises lazily).
// If any are absent, getClient() logs a per-variable warning and returns null —
// every public function becomes a no-op and the rest of the app runs normally.
// =============================================================================

import { ethers } from "ethers";

// ─── ABI (inline to avoid a compile dependency at runtime) ───────────────────

const ABI = [
    "event TaskCompleted(address indexed org, uint256 indexed taskId, uint256 indexed timestamp)",
    "event OrgRegistered(address indexed org, uint256 registeredAt)",
    "error NotRegisteredOrg(address caller)",
    "error AlreadyRegistered(address caller)",
    "function registerOrg() external",
    "function logTaskCompletion(uint256 taskId) external",
    "function isRegistered(address org) external view returns (bool)",
    "function totalLogged() external view returns (uint256)",
] as const;

// ─── Lazy singleton ───────────────────────────────────────────────────────────

interface Web3Client {
    contract: ethers.Contract;
    signer: ethers.Wallet;
    provider: ethers.JsonRpcProvider;
}

let _client: Web3Client | null = null;

function getClient(): Web3Client | null {
    if (_client) return _client;

    const rpcUrl  = process.env.WEB3_RPC_URL;
    const privKey = process.env.DEPLOYER_PRIVATE_KEY;
    const address = process.env.WORKFORCE_LOGGER_ADDRESS;

    // Report each missing variable individually so the developer knows exactly
    // which value(s) to add to .env — a single combined message hides the root cause.
    const missing: string[] = [];
    if (!rpcUrl)  missing.push('WEB3_RPC_URL');
    if (!privKey) missing.push('DEPLOYER_PRIVATE_KEY');
    if (!address) missing.push('WORKFORCE_LOGGER_ADDRESS');

    if (missing.length > 0) {
        console.warn(
            `[web3] Blockchain logging disabled — missing env var(s): ${missing.join(', ')}.\n` +
            `       Set them in server/.env to enable on-chain task logging.`
        );
        return null;
    }

    // All three are guaranteed non-empty strings past this point.
    const provider = new ethers.JsonRpcProvider(rpcUrl as string);
    const signer   = new ethers.Wallet(privKey as string, provider);
    const contract = new ethers.Contract(address as string, ABI, signer);

    _client = { contract, signer, provider };
    return _client;
}

// ─── UUID → uint256 encoding ──────────────────────────────────────────────────

/**
 * Convert an off-chain UUID string to uint256 for use as the on-chain taskId.
 *
 * Strategy: strip hyphens, parse as 128-bit hex, return as BigInt.
 * The lower 128 bits of a UUID are sufficient to uniquely identify tasks
 * within an org without risk of collision in practice.
 *
 * @example
 *   uuidToUint256("550e8400-e29b-41d4-a716-446655440000")
 *   // → 113059749145936845100832714089972963328n
 */
export function uuidToUint256(uuid: string): bigint {
    const hex = uuid.replace(/-/g, "");
    return BigInt("0x" + hex);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Register an organisation on-chain.
 *
 * @param orgWalletAddress  The org's EVM wallet address (stored in the DB).
 *
 * @dev   In production the org signs this themselves. In this implementation
 *        the backend deployer signs on behalf of the org — sufficient for a demo
 *        where the org has supplied their wallet address but not their key.
 *        For full self-custody: provide the org's private key at registration time.
 *
 * @returns tx hash or null if web3 is disabled.
 */
export async function registerOrgOnChain(
    _orgWalletAddress: string,
): Promise<string | null> {
    const client = getClient();
    if (!client) return null;

    try {
        // The signer (deployer) calls registerOrg — this registers the DEPLOYER
        // address, not the org's wallet. Swap to org's signer for production.
        const tx = await client.contract.registerOrg() as ethers.TransactionResponse;
        const receipt = await tx.wait(1);
        console.info(`[web3] Org registered — tx: ${receipt?.hash}`);
        return receipt?.hash ?? null;
    } catch (err: unknown) {
        // AlreadyRegistered is expected if the org was previously registered;
        // treat it as a success.
        if (err instanceof Error && err.message.includes("AlreadyRegistered")) {
            console.info("[web3] Org already registered on-chain — skipping.");
            return null;
        }
        console.error("[web3] registerOrgOnChain failed:", err);
        return null;
    }
}

/**
 * Emit a TaskCompleted event on-chain for the given task UUID.
 *
 * @param taskUuid  The off-chain task UUID (e.g. from the tasks table `id` column).
 * @returns tx hash or null if web3 is disabled / call failed.
 */
export async function logTaskCompletionOnChain(
    taskUuid: string,
): Promise<string | null> {
    const client = getClient();
    if (!client) return null;

    const taskId = uuidToUint256(taskUuid);

    try {
        const tx = await client.contract.logTaskCompletion(taskId) as ethers.TransactionResponse;
        const receipt = await tx.wait(1);
        console.info(`[web3] TaskCompleted logged — taskId: ${taskId}, tx: ${receipt?.hash}`);
        return receipt?.hash ?? null;
    } catch (err) {
        // Non-fatal: log error, do not throw (caller is in an async background job)
        console.error("[web3] logTaskCompletionOnChain failed:", err);
        return null;
    }
}

/**
 * Check if an address is registered on-chain.
 * Useful for the /api/web3/logs endpoint.
 */
export async function isOrgRegistered(address: string): Promise<boolean> {
    const client = getClient();
    if (!client) return false;

    try {
        return await client.contract.isRegistered(address) as boolean;
    } catch {
        return false;
    }
}

/**
 * Get the total number of task completions ever logged on-chain.
 */
export async function getTotalLogged(): Promise<bigint | null> {
    const client = getClient();
    if (!client) return null;

    try {
        return await client.contract.totalLogged() as bigint;
    } catch {
        return null;
    }
}
