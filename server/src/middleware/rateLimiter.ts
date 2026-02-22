// =============================================================================
// middleware/rateLimiter.ts — Express rate-limiter factory.
//
// Used exclusively on POST /api/auth/login and POST /api/auth/register to
// defend against brute-force and credential-stuffing attacks (CRITICAL-3 from
// architecture audit).
//
// Store strategy
// ──────────────
//   Redis available  → rate-limit-redis (RedisStore)
//     Keys:  rl:auth:<IP>
//     Advantage: limits survive server restarts; works across multiple instances.
//
//   Redis unavailable → express-rate-limit built-in MemoryStore
//     Keys:  in-process Map; reset on restart.
//     Advantage: zero dependencies — always works, even in dev without Redis.
//
// The store is resolved lazily at request time (not at module load time) so the
// middleware can be imported before Redis is initialised in index.ts.
//
// Response shape on 429
// ─────────────────────
// Matches the global SPEC error envelope { success, error, message, statusCode }
// so the frontend can handle 429 exactly like any other API error.
//
// Environment variables (all optional — defaults are fine for most setups)
// ─────────────────────
//   RATE_LIMIT_AUTH_MAX      Max requests per window  (default: 10)
//   RATE_LIMIT_AUTH_WINDOW_MS  Window length in ms      (default: 900 000 = 15 min)
// =============================================================================

import rateLimit, { Store, Options, MemoryStore } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { getRedis } from '../lib/redis';

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_AUTH_MAX ?? '10', 10);
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS ?? String(15 * 60 * 1000), 10);

// ─── Store factory ────────────────────────────────────────────────────────────

/**
 * Build the rate-limit Store.
 *
 * Called at first request, not at module load, so we can safely call
 * getRedis() after initRedis() has run in index.ts.
 *
 * RedisStore key prefix: "rl:auth:" — namespaced so it never collides with
 * dashboard cache keys (prefix "hrms:").
 *
 * The sendCommand adapter translates rate-limit-redis's generic command
 * interface to ioredis's dynamic command methods.
 */
function buildStore(): Store {
    const redis = getRedis();

    if (redis) {
        console.log('[rateLimiter] Using Redis-backed store for auth rate limiting');

        return new RedisStore({
            prefix: 'rl:auth:',
            // rate-limit-redis v4 requires a sendCommand function that
            // forwards raw Redis commands to the underlying client.
            // ioredis exposes every command as a method, so we delegate
            // dynamically via `(redis as any)[command.toLowerCase()]`.
            sendCommand: async (...args: string[]): Promise<number> => {
                const [command, ...rest] = args;
                // ioredis commands return mixed types; cast to number for
                // EVALSHA / INCR results that rate-limit-redis expects.
                return (redis as any)[command.toLowerCase()](...rest) as Promise<number>;
            },
        });
    }

    // Memory store is the default — no extra config needed.
    console.log('[rateLimiter] Redis not available — using in-memory store for auth rate limiting');
    return new MemoryStore();
}

// ─── Singleton store ──────────────────────────────────────────────────────────
// Resolved once on first call, then reused. Avoids constructing a new
// RedisStore on every request while still allowing lazy initialisation.

let _store: Store | null = null;

function getStore(): Store {
    if (!_store) {
        _store = buildStore();
    }
    return _store;
}

// ─── Rate limiter factory ─────────────────────────────────────────────────────

/**
 * Returns an Express middleware that enforces:
 *   max MAX_REQUESTS requests per IP per WINDOW_MS milliseconds.
 *
 * On limit breach, responds immediately with:
 *   HTTP 429  { success: false, error: 'RATE_LIMIT_EXCEEDED', message: '...', statusCode: 429 }
 *
 * Usage (in route files — not app-wide):
 *   router.post('/login', authRateLimiter(), login);
 */
export function authRateLimiter() {
    const options: Partial<Options> = {
        windowMs: WINDOW_MS,
        max: MAX_REQUESTS,
        standardHeaders: true,   // emit RateLimit-* headers (RFC 9110 draft)
        legacyHeaders: false,    // suppress X-RateLimit-* (deprecated)

        // Resolve store lazily so Redis is available by the time the first
        // request arrives (initRedis() has already run in index.ts).
        store: getStore(),

        // Key by IP address — express-rate-limit reads req.ip by default.
        // If the app sits behind a trusted proxy (Railway, Render, etc.),
        // set `app.set('trust proxy', 1)` in app.ts so req.ip is the real
        // client IP rather than the load-balancer's IP.
        keyGenerator: (req) => req.ip ?? req.socket.remoteAddress ?? 'unknown',

        // Custom handler — returns the SPEC-mandated error envelope.
        // `next` is not used because we are terminating the request here.
        handler: (_req, res, _next, opts) => {
            const retryAfterSecs = Math.ceil(opts.windowMs / 1000);
            res.status(429).json({
                success: false,
                error: 'RATE_LIMIT_EXCEEDED',
                message: `Too many requests. You may retry after ${retryAfterSecs} seconds.`,
                statusCode: 429,
            });
        },

        // Skip successful requests from the counter so only failed / repeated
        // attempts burn through the quota (optional — conservative default).
        skipSuccessfulRequests: false,
    };

    return rateLimit(options);
}
