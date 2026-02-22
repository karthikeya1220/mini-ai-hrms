// context/Web3Context.tsx
// =============================================================================
// React context that shares a single useWeb3() instance across the component
// tree — avoids multiple EIP-1193 event listener registrations if multiple
// components import the hook independently.
//
// Usage
// ─────
//   // In App.tsx (wrap inside AuthProvider):
//   <Web3Provider>
//     <AppRouter />
//   </Web3Provider>
//
//   // In any component:
//   import { useWeb3Context } from '../context/Web3Context';
//   const { account, connect, logTaskCompletion } = useWeb3Context();
//
// The context returns the same shape as useWeb3() — see hooks/useWeb3.ts.
// =============================================================================

import { createContext, useContext, type ReactNode } from 'react';
import { useWeb3, type UseWeb3Result } from '../hooks/useWeb3';

// ─── Context ──────────────────────────────────────────────────────────────────

export const Web3Context = createContext<UseWeb3Result | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────
// Exported as the only default export so Vite fast-refresh works correctly.

export function Web3Provider({ children }: { children: ReactNode }) {
    const web3 = useWeb3();
    return (
        <Web3Context.Provider value={web3}>
            {children}
        </Web3Context.Provider>
    );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Consume the shared Web3 context.
 * Stable across re-renders — same instance returned every call.
 * Throws if called outside <Web3Provider>.
 */
export function useWeb3Context(): UseWeb3Result {
    const ctx = useContext(Web3Context);
    if (!ctx) throw new Error('useWeb3Context must be used within <Web3Provider>');
    return ctx;
}
