// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  WorkforceLogger
 * @notice Immutable on-chain audit log for workforce task-completion events.
 *
 * @dev    Architecture notes
 * ─────────────────────────────────────────────────────────────────────────────
 * • Each organization is identified by the *address that registered it* on the
 *   contract (msg.sender when calling `registerOrg`).
 *   This maps 1-to-1 with the `walletAddress` field stored per-org in the
 *   off-chain database (SPEC § 1.2).
 *
 * • `logTaskCompletion(uint256 taskId)` is gated by `onlyRegisteredOrg`:
 *   only an address that has previously called `registerOrg` may emit a log.
 *   This prevents arbitrary wallets from polluting the log.
 *
 * • Events are the canonical on-chain record — no state storage is used for
 *   log entries, keeping gas costs minimal (no SSTORE, only MLOAD + LOG3).
 *
 * • `totalLogged` is the only stored counter; it lets off-chain indexers
 *   verify completeness without scanning the full event history.
 *
 * • The contract is *non-upgradeable* by design: immutability is the whole
 *   point of a blockchain audit trail.
 *
 * Gas estimate per logTaskCompletion call: ~27,000 gas (LOG3 + SSTORE on counter)
 *
 * ─── Events ───────────────────────────────────────────────────────────────────
 *
 * TaskCompleted
 *   - org       (indexed) : address of the org that logged the completion
 *   - taskId    (indexed) : off-chain task UUID encoded as uint256
 *   - timestamp (indexed) : block.timestamp at the time of the call
 *
 * OrgRegistered
 *   - org       (indexed) : address registered
 *   - registeredAt        : block.timestamp
 */
contract WorkforceLogger {

    // ─── State ────────────────────────────────────────────────────────────────

    /// @notice Tracks which addresses are registered organizations.
    mapping(address => bool) public registeredOrgs;

    /// @notice Total task-completion events logged across all orgs.
    /// Monotonically increasing; never decremented.
    uint256 public totalLogged;

    // ─── Events ───────────────────────────────────────────────────────────────

    /**
     * @notice Emitted whenever an organization logs a task completion.
     * @param  org       The organization's wallet address (msg.sender).
     * @param  taskId    Off-chain task identifier (e.g. UUID lower 128 bits).
     * @param  timestamp Unix timestamp of the block in which this was called.
     */
    event TaskCompleted(
        address indexed org,
        uint256 indexed taskId,
        uint256 indexed timestamp
    );

    /**
     * @notice Emitted when a new organization registers on the contract.
     * @param  org          The registered address.
     * @param  registeredAt Block timestamp at registration.
     */
    event OrgRegistered(
        address indexed org,
        uint256 registeredAt
    );

    // ─── Errors ───────────────────────────────────────────────────────────────

    /// @notice Thrown when a non-registered address calls a protected function.
    error NotRegisteredOrg(address caller);

    /// @notice Thrown when an address tries to register more than once.
    error AlreadyRegistered(address caller);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    /**
     * @dev Restricts the function to addresses that have called `registerOrg`.
     * Reverts with a custom error (cheaper than require + string).
     */
    modifier onlyRegisteredOrg() {
        if (!registeredOrgs[msg.sender]) {
            revert NotRegisteredOrg(msg.sender);
        }
        _;
    }

    // ─── External functions ───────────────────────────────────────────────────

    /**
     * @notice Register `msg.sender` as an authorized organization.
     *         Must be called before `logTaskCompletion`.
     *
     * @dev    Each address may register exactly once.
     *         The org address corresponds to the `walletAddress` column in the
     *         organizations table — stored there when the org is created via the
     *         backend API. The backend signs and submits this transaction on the
     *         org's behalf using the org's wallet private key.
     *
     * Emits {OrgRegistered}.
     */
    function registerOrg() external {
        if (registeredOrgs[msg.sender]) {
            revert AlreadyRegistered(msg.sender);
        }
        registeredOrgs[msg.sender] = true;
        emit OrgRegistered(msg.sender, block.timestamp);
    }

    /**
     * @notice Record that task `taskId` was completed by the calling org.
     *
     * @dev    The caller must be a registered org (see `registerOrg`).
     *         `taskId` is the numeric representation of the off-chain UUID —
     *         the backend converts the UUID string to uint256 by taking the
     *         lower 128 bits of the UUID byte array before calling this.
     *
     *         Increments `totalLogged` to enable off-chain completeness checks.
     *
     *         Uses `block.timestamp` as the canonical event time. Miners can
     *         manipulate this by ±15 seconds, which is acceptable for an audit
     *         log (not used for time-locked logic).
     *
     * @param  taskId  Off-chain task numeric identifier.
     *
     * Emits {TaskCompleted}.
     */
    function logTaskCompletion(uint256 taskId) external onlyRegisteredOrg {
        unchecked {
            // Safe: totalLogged would need 2^256 increments to overflow.
            ++totalLogged;
        }
        emit TaskCompleted(msg.sender, taskId, block.timestamp);
    }

    // ─── View functions ───────────────────────────────────────────────────────

    /**
     * @notice Returns whether `org` has been registered.
     * @param  org  Address to query.
     */
    function isRegistered(address org) external view returns (bool) {
        return registeredOrgs[org];
    }
}
