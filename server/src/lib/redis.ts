// =============================================================================
// lib/redis.ts — ioredis singleton for the server.
//
// Design decisions
// ────────────────
// 1. OPTIONAL by design — Redis is NOT required to run the API.
//    If REDIS_URL is unset, `redis` exports null and every call site
//    short-circuits gracefully. The dashboard falls back to a live DB query.
//
// 2. Single shared connection — ioredis manages an internal connection pool;
//    one Redis instance per process is correct.
//
// 3. Lazy connect — ioredis connects on first command, not on import.
//    That means this module is safe to import in test files that never set
//    REDIS_URL; the TCP handshake never happens.
//
// 4. Error resilience — a 'error' listener is registered so connection errors
//    (e.g. Redis restart) are logged but do NOT crash the process.
//    ioredis automatically reconnects with exponential backoff.
//
// 5. Graceful shutdown — disconnect() is exported so index.ts can quit the
//    Redis connection alongside Prisma on SIGTERM/SIGINT.
//
// Environment variable
// ────────────────────
//   REDIS_URL   Full ioredis connection URL, e.g.:
//               redis://localhost:6379
//               redis://:password@myredis.host:6379
//               rediss://host:6380   (TLS)
//               (default: redis://localhost:6379 when not set but
//                the client is still considered optional — if Redis
//                is not running, commands fail silently)
// =============================================================================

import Redis from 'ioredis';

// ─── Singleton ────────────────────────────────────────────────────────────────

let _redis: Redis | null = null;

/**
 * Returns the shared ioredis instance, or null if REDIS_URL is not set.
 *
 * Guidelines for callers:
 *   const client = getRedis();
 *   if (!client) { /* Redis disabled — skip caching */ /* }
*/
export function getRedis(): Redis | null {
    return _redis;
}

// ─── Initialise ───────────────────────────────────────────────────────────────

/**
 * Called once from index.ts (after dotenv loads).
 * Creates the ioredis client if REDIS_URL is present.
 * Safe to call multiple times — second call is a no-op.
 */
export function initRedis(): void {
    if (_redis) return;                             // already initialised
    if (!process.env.REDIS_URL) {
        console.log('[redis] REDIS_URL not set — caching disabled (non-fatal)');
        return;
    }

    _redis = new Redis(process.env.REDIS_URL, {
        // ── Connection settings ───────────────────────────────────────────────
        connectTimeout: 5_000,   // 5 s initial TCP timeout
        commandTimeout: 3_000,   // 3 s per-command timeout (prevents hangs)
        maxRetriesPerRequest: 1,     // fail fast per command — don't queue indefinitely
        enableReadyCheck: true,

        // ── Reconnect strategy ───────────────────────────────────────────────
        // ioredis default: exponential backoff up to 2s. We cap it at 5s.
        retryStrategy(times: number) {
            const delay = Math.min(times * 200, 5_000);   // 200 ms, 400, 600, …, 5 000 ms
            console.log(`[redis] Reconnecting attempt ${times} in ${delay}ms…`);
            return delay;
        },
    });

    _redis.on('connect', () => console.log('[redis] Connected'));
    _redis.on('ready', () => console.log('[redis] Ready'));
    _redis.on('error', (err) => {
        // Log but do not throw — ioredis will retry automatically.
        console.error('[redis] Error:', (err as Error).message);
    });
    _redis.on('close', () => console.log('[redis] Connection closed'));
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

/**
 * Quit the Redis connection gracefully (sends QUIT command).
 * Called from index.ts shutdown handler alongside Prisma.$disconnect().
 */
export async function disconnectRedis(): Promise<void> {
    if (_redis) {
        await _redis.quit().catch(() => _redis?.disconnect());
        _redis = null;
        console.log('[redis] Disconnected');
    }
}

// ─── Key helpers (exported for use in cache modules) ─────────────────────────

/**
 * Build a namespaced cache key.
 * Format:  hrms:<namespace>:<discriminator>
 * Example: hrms:dashboard:org_abc123
 */
export function cacheKey(namespace: string, discriminator: string): string {
    return `hrms:${namespace}:${discriminator}`;
}

export const DASHBOARD_NS = 'dashboard';
