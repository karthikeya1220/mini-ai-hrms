// hooks/useWeb3.ts
// =============================================================================
// MetaMask integration hook — fully optional.
//
// Design principles
// ─────────────────
// 1. Web3 is OPTIONAL. Every state value has a safe "not connected" default.
//    The rest of the app works identically whether MetaMask is installed or not.
//
// 2. No external libraries. Uses the raw window.ethereum EIP-1193 provider and
//    the ethers.js BrowserProvider for typed contract calls. No wagmi, no viem,
//    no RainbowKit — keeps the bundle lean and the dep tree shallow.
//
// 3. Single responsibility. This hook manages:
//      - wallet connection / disconnection
//      - account and chain change events
//      - the WorkforceLogger contract call (logTaskCompletion)
//    It does NOT manage the POST /api/web3/log call — that stays in the
//    component so it can receive the JWT access token from useAuth().
//
// 4. Contract address comes from the env var VITE_WORKFORCE_LOGGER_ADDRESS.
//    If unset, logTaskCompletion is a harmless no-op.
//
// Exported API
// ─────────────
//   isMetaMaskInstalled  boolean — false if window.ethereum is absent
//   account              string | null — connected wallet address (checksummed)
//   chainId              number | null — hex→decimal chain ID
//   isConnecting         boolean — true while eth_requestAccounts is in flight
//   connectError         string | null — human-readable error message
//   connect()            () => Promise<void>
//   disconnect()         () => void — clears state (MetaMask has no programmatic disconnect)
//   logTaskCompletion()  (taskId: string) => Promise<string | null>
//                        Returns tx hash on success, null on any failure.
// =============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';

// ─── WorkforceLogger ABI (only the functions we need) ────────────────────────

const WORKFORCE_LOGGER_ABI = [
    "function registerOrg() external",
    "function logTaskCompletion(uint256 taskId) external",
    "function isRegistered(address org) external view returns (bool)",
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a UUID string to uint256 BigInt for the on-chain call.
 * Matches the encoding in server/src/lib/web3.ts and the Hardhat tests.
 */
function uuidToUint256(uuid: string): bigint {
    const hex = uuid.replace(/-/g, '');
    return BigInt('0x' + hex);
}

/** Resolve a human-readable chain name for display. */
function chainLabel(chainId: number): string {
    const names: Record<number, string> = {
        1: 'Ethereum',
        137: 'Polygon',
        80001: 'Mumbai (deprecated)',
        80002: 'Amoy',
        11155111: 'Sepolia',
        31337: 'Hardhat',
    };
    return names[chainId] ?? `Chain ${chainId}`;
}

// ─── EIP-1193 provider type ───────────────────────────────────────────────────

interface EIP1193Provider {
    isMetaMask?: boolean;
    request(args: { method: string; params?: unknown[] }): Promise<unknown>;
    on(event: string, handler: (...args: unknown[]) => void): void;
    removeListener(event: string, handler: (...args: unknown[]) => void): void;
}

declare global {
    interface Window {
        ethereum?: EIP1193Provider;
    }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseWeb3Result {
    /** True if window.ethereum is present (MetaMask or compatible wallet). */
    isMetaMaskInstalled: boolean;
    /** Connected wallet address, or null if not connected. */
    account: string | null;
    /** Decimal chain ID, or null if not connected. */
    chainId: number | null;
    /** Human-readable chain name derived from chainId. */
    chainName: string | null;
    /** True while eth_requestAccounts is in-flight. */
    isConnecting: boolean;
    /** Human-readable connect error, or null. */
    connectError: string | null;

    /** Prompt MetaMask to connect. Resolves after the user approves or rejects. */
    connect: () => Promise<void>;
    /** Clear local state. MetaMask itself has no programmatic disconnect. */
    disconnect: () => void;

    /**
     * Call WorkforceLogger.logTaskCompletion(taskId) via MetaMask.
     *
     * @param   taskUuid  The off-chain task UUID.
     * @returns           The tx hash on success, null on any error or if
     *                    MetaMask is not connected / contract not configured.
     */
    logTaskCompletion: (taskUuid: string) => Promise<string | null>;
}

export function useWeb3(): UseWeb3Result {
    const [account, setAccount] = useState<string | null>(null);
    const [chainId, setChainId] = useState<number | null>(null);
    const [isConnecting, setIsConnecting] = useState(false);
    const [connectError, setConnectError] = useState<string | null>(null);

    const isMetaMaskInstalled = typeof window !== 'undefined' && !!window.ethereum;

    // Ref so event handlers always see the latest values without causing re-renders
    const accountRef = useRef<string | null>(null);

    // ── Restore account if already authorised (no popup) ──────────────────────
    useEffect(() => {
        if (!isMetaMaskInstalled) return;

        // eth_accounts returns already-authorised accounts (no popup)
        window.ethereum!.request({ method: 'eth_accounts' }).then((accts) => {
            const list = accts as string[];
            if (list.length > 0) {
                const checksummed = ethers.getAddress(list[0]);
                setAccount(checksummed);
                accountRef.current = checksummed;
            }
        }).catch(() => {/* silent */ });

        // Fetch current chain
        window.ethereum!.request({ method: 'eth_chainId' }).then((hex) => {
            setChainId(parseInt(hex as string, 16));
        }).catch(() => {/* silent */ });

        // ── Event listeners ───────────────────────────────────────────────────

        const onAccountsChanged = (accts: unknown) => {
            const list = accts as string[];
            if (list.length === 0) {
                setAccount(null);
                accountRef.current = null;
            } else {
                const checksummed = ethers.getAddress(list[0]);
                setAccount(checksummed);
                accountRef.current = checksummed;
            }
        };

        const onChainChanged = (hex: unknown) => {
            setChainId(parseInt(hex as string, 16));
        };

        window.ethereum!.on('accountsChanged', onAccountsChanged);
        window.ethereum!.on('chainChanged', onChainChanged);

        return () => {
            window.ethereum!.removeListener('accountsChanged', onAccountsChanged);
            window.ethereum!.removeListener('chainChanged', onChainChanged);
        };
    }, [isMetaMaskInstalled]);

    // ── connect ───────────────────────────────────────────────────────────────

    const connect = useCallback(async () => {
        if (!isMetaMaskInstalled) {
            setConnectError('MetaMask is not installed. Install it at metamask.io');
            return;
        }
        setIsConnecting(true);
        setConnectError(null);
        try {
            const accts = await window.ethereum!.request({
                method: 'eth_requestAccounts',
            }) as string[];

            if (accts.length === 0) throw new Error('No accounts returned');

            const checksummed = ethers.getAddress(accts[0]);
            setAccount(checksummed);
            accountRef.current = checksummed;

            const hex = await window.ethereum!.request({ method: 'eth_chainId' }) as string;
            setChainId(parseInt(hex, 16));
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            // 4001 = user rejected
            setConnectError(
                msg.includes('4001') || msg.toLowerCase().includes('rejected')
                    ? 'Connection rejected — please approve in MetaMask.'
                    : msg,
            );
        } finally {
            setIsConnecting(false);
        }
    }, [isMetaMaskInstalled]);

    // ── disconnect ────────────────────────────────────────────────────────────

    const disconnect = useCallback(() => {
        setAccount(null);
        accountRef.current = null;
        setChainId(null);
        setConnectError(null);
    }, []);

    // ── logTaskCompletion ─────────────────────────────────────────────────────

    const logTaskCompletion = useCallback(async (taskUuid: string): Promise<string | null> => {
        const contractAddress = import.meta.env.VITE_WORKFORCE_LOGGER_ADDRESS as string | undefined;

        if (!isMetaMaskInstalled || !accountRef.current) {
            console.info('[web3] MetaMask not connected — skipping on-chain log.');
            return null;
        }

        if (!contractAddress) {
            console.warn(
                '[web3] VITE_WORKFORCE_LOGGER_ADDRESS not set — on-chain log skipped.\n' +
                '       Deploy the contract and add its address to client/.env',
            );
            return null;
        }

        try {
            const provider = new ethers.BrowserProvider(window.ethereum as ethers.Eip1193Provider);
            const signer = await provider.getSigner();
            const contract = new ethers.Contract(contractAddress, WORKFORCE_LOGGER_ABI, signer);

            const taskId = uuidToUint256(taskUuid);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const tx = await (contract as any).logTaskCompletion(taskId) as ethers.TransactionResponse;
            const receipt = await tx.wait(1);

            console.info('[web3] TaskCompleted logged on-chain:', receipt?.hash);
            return receipt?.hash ?? tx.hash;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);

            // User rejected the MetaMask popup — not an error worth warning about
            if (msg.includes('4001') || msg.toLowerCase().includes('rejected')) {
                console.info('[web3] User rejected the MetaMask tx prompt.');
            } else {
                console.warn('[web3] logTaskCompletion failed:', msg);
            }
            return null;
        }
    }, [isMetaMaskInstalled]);

    return {
        isMetaMaskInstalled,
        account,
        chainId,
        chainName: chainId !== null ? chainLabel(chainId) : null,
        isConnecting,
        connectError,
        connect,
        disconnect,
        logTaskCompletion,
    };
}
