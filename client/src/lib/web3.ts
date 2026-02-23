// =============================================================================
// lib/web3.ts — MetaMask wallet connection helpers (ethers v6)
//
// Exports:
//   getProvider()    → BrowserProvider wrapping window.ethereum
//   connectWallet()  → prompts MetaMask, returns { signer, address }
//   getSigner()      → returns JsonRpcSigner from the current provider
//                      (assumes wallet already connected; does not prompt)
//
// Design notes:
//   - All functions throw a plain Error with a human-readable message so
//     callers can surface the reason directly in the UI.
//   - No singleton state is held here — every call to getProvider() creates
//     a fresh BrowserProvider so it always reflects the current window.ethereum
//     state (account/network changes are handled by the caller via events).
//   - ethers v6 uses BrowserProvider (replaces v5 Web3Provider) and
//     JsonRpcSigner (returned by provider.getSigner()).
// =============================================================================

import { BrowserProvider, JsonRpcSigner } from 'ethers';
import type { Eip1193Provider } from 'ethers';

// ─── Type guard ───────────────────────────────────────────────────────────────

function assertMetaMask(): void {
    if (typeof window === 'undefined' || !window.ethereum) {
        throw new Error(
            'MetaMask is not installed. Please install the MetaMask browser extension.',
        );
    }
}

// =============================================================================
// getProvider()
// Returns a BrowserProvider wrapping window.ethereum.
// Throws if MetaMask is not present.
// =============================================================================

export function getProvider(): BrowserProvider {
    assertMetaMask();
    // window.ethereum is typed as `any` by MetaMask — cast to the ethers v6
    // Eip1193Provider interface which BrowserProvider's constructor expects.
    return new BrowserProvider(window.ethereum as Eip1193Provider);
}

// =============================================================================
// connectWallet()
// Requests account access via MetaMask (shows the MetaMask popup if needed).
// Returns the JsonRpcSigner and the resolved checksummed address.
//
// Throws:
//   - 'MetaMask is not installed…'  — window.ethereum absent
//   - 'User rejected the connection request.'  — user dismissed popup
//   - Any underlying provider error forwarded as-is
// =============================================================================

export async function connectWallet(): Promise<{
    signer:  JsonRpcSigner;
    address: string;
}> {
    const provider = getProvider();

    try {
        // eth_requestAccounts triggers the MetaMask popup when not yet connected.
        await provider.send('eth_requestAccounts', []);
    } catch (err: unknown) {
        // EIP-1193 user rejection: code 4001
        const code = (err as { code?: number }).code;
        if (code === 4001) {
            throw new Error('User rejected the connection request.');
        }
        throw err;
    }

    const signer  = await provider.getSigner();
    const address = await signer.getAddress();

    return { signer, address };
}

// =============================================================================
// getSigner()
// Returns the JsonRpcSigner for the currently connected account.
// Does NOT prompt MetaMask — call connectWallet() first if the wallet may
// not be connected.
//
// Throws:
//   - 'MetaMask is not installed…'  — window.ethereum absent
//   - Any ethers/provider error if no account is connected
// =============================================================================

export async function getSigner(): Promise<JsonRpcSigner> {
    const provider = getProvider();
    return provider.getSigner();
}
