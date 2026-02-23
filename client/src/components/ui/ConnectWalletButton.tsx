// components/ui/ConnectWalletButton.tsx
// =============================================================================
// MetaMask connect/disconnect widget.
//
// Behaviour
// ─────────
// • MetaMask not installed → grey "Install MetaMask" link (opens metamask.io)
// • Not connected         → purple "Connect Wallet" button with fox icon
// • Connecting            → spinner + "Connecting…" label
// • Connected             → address pill (truncated) with chain badge + disconnect
//
// Design
// ──────
// • Fits in any toolbar — 36 px tall by default.
// • Uses the project's existing slate colour system + brand-500 purple.
// • Dropdown on connected state shows full address + chain name + disconnect.
// • Fully keyboard accessible (focus-visible ring, role="button", esc closes).
//
// Props
// ─────
// compact   boolean  — hide the chain badge (for tight headers). Default false.
// =============================================================================

import { useState, useRef, useEffect, useCallback } from 'react';
import { useWeb3Context } from '../../context/Web3Context';

// ─── MetaMask fox icon (inline SVG — no image dep) ───────────────────────────

function FoxIcon({ className = 'w-4 h-4' }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 35 33"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
        >
            {/* Simplified MetaMask fox silhouette */}
            <path d="M32.958.5 19.42 10.488l2.44-5.78L32.958.5Z" fill="#E2761B" stroke="#E2761B" strokeLinecap="round" strokeLinejoin="round" />
            <path d="m2.032.5 13.424 10.086-2.323-5.878L2.032.5Z" fill="#E4761B" stroke="#E4761B" strokeLinecap="round" strokeLinejoin="round" />
            <path d="m28.06 23.533-3.6 5.513 7.7 2.12 2.212-7.51-6.312-.123ZM.64 23.656l2.2 7.51 7.7-2.12-3.598-5.513L.64 23.656Z" fill="#E4761B" stroke="#E4761B" strokeLinecap="round" strokeLinejoin="round" />
            <path d="m10.098 14.36-2.143 3.237 7.638.338-.267-8.21-5.228 4.636ZM24.892 14.36l-5.3-4.737-.175 8.312 7.627-.338-2.152-3.237ZM10.54 29.046l4.594-2.237-3.964-3.09-.63 5.327ZM19.856 26.809l4.605 2.237-.641-5.327-3.964 3.09Z" fill="#E4761B" stroke="#E4761B" strokeLinecap="round" strokeLinejoin="round" />
            <path d="m24.46 29.046-4.604-2.237.373 3.01-.04 1.27 4.271-2.043ZM10.54 29.046l4.27 2.043-.028-1.27.35-3.01-4.592 2.237Z" fill="#D7C1B3" stroke="#D7C1B3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="m14.874 21.717-3.82-1.12 2.693-1.233 1.127 2.353ZM20.116 21.717l1.127-2.353 2.704 1.234-3.831 1.119Z" fill="#233447" stroke="#233447" strokeLinecap="round" strokeLinejoin="round" />
            <path d="m10.54 29.046.653-5.513-4.25.123 3.597 5.39ZM23.797 23.533l.663 5.513 3.598-5.39-4.26-.123ZM27.034 17.597l-7.627.338.71 3.782 1.127-2.353 2.704 1.234 3.086-3.001ZM11.054 20.598l2.704-1.234 1.116 2.353.722-3.782-7.638-.338 3.096 3.001Z" fill="#CD6116" stroke="#CD6116" strokeLinecap="round" strokeLinejoin="round" />
            <path d="m7.955 17.597 3.2 6.24-.104-3.239-3.096-3.001ZM23.96 20.598l-.115 3.239 3.2-6.24-3.085 3.001ZM15.676 17.935l-.722 3.782.91 4.69.206-6.18-.394-2.292ZM19.407 17.935l-.383 2.281.185 6.19.921-4.69-.723-3.781Z" fill="#E4751F" stroke="#E4751F" strokeLinecap="round" strokeLinejoin="round" />
            <path d="m20.116 21.717-.921 4.69.663.46 4.101-3.09v-2.06l-3.843.999" fill="#F6851B" stroke="#F6851B" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

// ─── Chain colour dot ─────────────────────────────────────────────────────────

const CHAIN_COLORS: Record<number, string> = {
    1: '#627eea', // Ethereum blue
    137: '#8247e5', // Polygon purple
    80001: '#8247e5',
    80002: '#8247e5',
    11155111: '#627eea',
    31337: '#f59e0b', // amber — local
};

function ChainDot({ chainId }: { chainId: number }) {
    const color = CHAIN_COLORS[chainId] ?? '#6b7280';
    return (
        <span
            className="inline-block w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: color }}
            aria-hidden="true"
        />
    );
}

// ─── Truncate helpers ─────────────────────────────────────────────────────────

function truncateAddress(addr: string): string {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
    /** Hide chain badge — useful in very narrow toolbars. */
    compact?: boolean;
}

export function ConnectWalletButton({ compact = false }: Props) {
    const {
        isMetaMaskInstalled,
        account,
        chainId,
        chainName,
        isConnecting,
        connectError,
        connect,
        disconnect,
    } = useWeb3Context();

    const [open, setOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown on outside click
    useEffect(() => {
        if (!open) return;
        function onPointerDown(e: PointerEvent) {
            if (!dropdownRef.current?.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [open]);

    // Close on Escape
    useEffect(() => {
        if (!open) return;
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') setOpen(false);
        }
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open]);

    const handleCopyAddress = useCallback(() => {
        if (account) {
            navigator.clipboard.writeText(account).catch(() => { });
        }
    }, [account]);

    // ── MetaMask not installed ─────────────────────────────────────────────────
    if (!isMetaMaskInstalled) {
        return (
            <a
                href="https://metamask.io/download/"
                target="_blank"
                rel="noopener noreferrer"
                id="btn-install-metamask"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-slate-500 hover:border-white/20 hover:text-slate-300 text-xs font-medium transition-all"
                title="MetaMask is not installed"
            >
                <FoxIcon className="w-3.5 h-3.5 opacity-50" />
                Install MetaMask
            </a>
        );
    }

    // ── Not connected ──────────────────────────────────────────────────────────
    if (!account) {
        return (
            <div className="flex flex-col items-end gap-1">
                <button
                    id="btn-connect-wallet"
                    onClick={connect}
                    disabled={isConnecting}
                    className="
                        flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                        border border-violet-500/40 bg-violet-500/10 text-violet-300
                        hover:bg-violet-500/20 hover:border-violet-400/60 hover:text-violet-200
                        disabled:opacity-50 disabled:cursor-not-allowed
                        transition-all duration-150 focus-visible:outline-none
                        focus-visible:ring-2 focus-visible:ring-violet-500/60"
                    aria-label="Connect MetaMask wallet"
                >
                    {isConnecting ? (
                        <>
                            <svg
                                className="w-3.5 h-3.5 animate-spin"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                aria-hidden="true"
                            >
                                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                                <path d="M12 2a10 10 0 0 1 10 10" />
                            </svg>
                            Connecting…
                        </>
                    ) : (
                        <>
                            <FoxIcon className="w-3.5 h-3.5" />
                            Connect Wallet
                        </>
                    )}
                </button>

                {connectError && (
                    <p className="text-xs text-red-400 max-w-[200px] text-right leading-snug">
                        {connectError}
                    </p>
                )}
            </div>
        );
    }

    // ── Connected — address pill with dropdown ─────────────────────────────────
    return (
        <div className="relative" ref={dropdownRef}>
            <button
                id="btn-wallet-connected"
                onClick={() => setOpen(o => !o)}
                className="
                    flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                    border border-emerald-500/30 bg-emerald-500/10 text-emerald-300
                    hover:bg-emerald-500/20 hover:border-emerald-400/50 hover:text-emerald-200
                    transition-all duration-150 focus-visible:outline-none
                    focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                aria-haspopup="true"
                aria-expanded={open}
                aria-label={`Wallet connected: ${account}`}
            >
                {/* Status dot */}
                <span
                    className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0"
                    aria-hidden="true"
                />

                {/* Truncated address */}
                <span className="font-mono tracking-tight">
                    {truncateAddress(account)}
                </span>

                {/* Chain badge */}
                {!compact && chainId !== null && (
                    <span className="flex items-center gap-1 pl-1 border-l border-emerald-500/20 ml-0.5">
                        <ChainDot chainId={chainId} />
                        <span className="text-slate-400 text-[10px]">{chainName}</span>
                    </span>
                )}

                {/* Chevron */}
                <svg
                    className={`w-3 h-3 text-emerald-500/60 transition-transform ${open ? 'rotate-180' : ''}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                >
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>

            {/* Dropdown */}
            {open && (
                <div
                    className="
                        absolute right-0 top-full mt-1.5 z-50 min-w-[220px]
                        rounded-xl border border-white/10 bg-[#0a0a0a]/95
                        backdrop-blur-sm shadow-2xl shadow-black/60
                        overflow-hidden animate-in fade-in slide-in-from-top-1
                        duration-150"
                    role="menu"
                    aria-label="Wallet options"
                >
                    {/* Header */}
                    <div className="px-3 py-2.5 border-b border-white/8">
                        <div className="flex items-center gap-2 mb-0.5">
                            <FoxIcon className="w-4 h-4" />
                            <span className="text-xs font-semibold text-slate-200">
                                Connected Wallet
                            </span>
                        </div>
                        {chainId !== null && (
                            <div className="flex items-center gap-1.5 mt-1">
                                <ChainDot chainId={chainId} />
                                <span className="text-[10px] text-slate-500">{chainName}</span>
                            </div>
                        )}
                    </div>

                    {/* Full address */}
                    <div className="px-3 py-2 border-b border-white/8">
                        <p className="text-[10px] text-slate-600 mb-0.5 uppercase tracking-wider">Address</p>
                        <p className="font-mono text-[11px] text-slate-300 break-all leading-snug">
                            {account}
                        </p>
                    </div>

                    {/* Actions */}
                    <div className="p-1">
                        <button
                            role="menuitem"
                            onClick={() => { handleCopyAddress(); setOpen(false); }}
                            className="
                                w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs
                                text-slate-400 hover:text-slate-200 hover:bg-white/5
                                transition-colors text-left"
                        >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                            Copy address
                        </button>

                        <button
                            role="menuitem"
                            onClick={() => { disconnect(); setOpen(false); }}
                            className="
                                w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs
                                text-red-400 hover:text-red-300 hover:bg-red-500/10
                                transition-colors text-left"
                        >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                                <polyline points="16 17 21 12 16 7" />
                                <line x1="21" y1="12" x2="9" y2="12" />
                            </svg>
                            Disconnect
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
