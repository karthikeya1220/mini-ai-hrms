/**
 * WorkforceLogger — canonical ABI
 *
 * Auto-generated from contracts/WorkforceLogger.sol — do not edit by hand.
 * Update by running: npx hardhat compile  (artifacts/contracts/WorkforceLogger.sol/WorkforceLogger.json)
 *
 * This file is intentionally committed so the server and client can import
 * it without depending on a compiled artifact at runtime.
 */

export const WORKFORCE_LOGGER_ABI = [
    // ─── Events ─────────────────────────────────────────────────────────────

    {
        type: "event",
        name: "TaskCompleted",
        inputs: [
            { name: "org", type: "address", indexed: true },
            { name: "taskId", type: "uint256", indexed: true },
            { name: "timestamp", type: "uint256", indexed: true },
        ],
        anonymous: false,
    },
    {
        type: "event",
        name: "OrgRegistered",
        inputs: [
            { name: "org", type: "address", indexed: true },
            { name: "registeredAt", type: "uint256", indexed: false },
        ],
        anonymous: false,
    },

    // ─── Errors ──────────────────────────────────────────────────────────────

    {
        type: "error",
        name: "NotRegisteredOrg",
        inputs: [{ name: "caller", type: "address" }],
    },
    {
        type: "error",
        name: "AlreadyRegistered",
        inputs: [{ name: "caller", type: "address" }],
    },

    // ─── State variables (public getters) ────────────────────────────────────

    {
        type: "function",
        name: "registeredOrgs",
        stateMutability: "view",
        inputs: [{ name: "", type: "address" }],
        outputs: [{ name: "", type: "bool" }],
    },
    {
        type: "function",
        name: "totalLogged",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "uint256" }],
    },

    // ─── External functions ───────────────────────────────────────────────────

    {
        type: "function",
        name: "registerOrg",
        stateMutability: "nonpayable",
        inputs: [],
        outputs: [],
    },
    {
        type: "function",
        name: "logTaskCompletion",
        stateMutability: "nonpayable",
        inputs: [{ name: "taskId", type: "uint256" }],
        outputs: [],
    },
    {
        type: "function",
        name: "isRegistered",
        stateMutability: "view",
        inputs: [{ name: "org", type: "address" }],
        outputs: [{ name: "", type: "bool" }],
    },
] as const;

export type WorkforceLoggerAbi = typeof WORKFORCE_LOGGER_ABI;
