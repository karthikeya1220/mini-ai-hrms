// =============================================================================
// Entry point — loads env, boots the HTTP server, handles shutdown.
//
// Boot sequence:
//   1. dotenv/config      — populate process.env (MUST be first import)
//   2. PORT guard         — fail fast if PORT is not set (prevents proxy mismatch)
//   3. initRedis()        — connect the dashboard-cache Redis singleton (optional)
//   4. initScoringQueue() — start the Postgres-backed job queue worker
//   5. createApp()        — build Express app + register routes
//   6. app.listen()       — bind HTTP port
//   7. SIGTERM/SIGINT     — graceful shutdown (worker drain → Redis close → Prisma close)
// =============================================================================

import 'dotenv/config'; // side-effect import — populates process.env from .env

import { createApp } from './app';
import prisma, { ensureConnected } from './lib/prisma';
import { initRedis, disconnectRedis } from './lib/redis';
import { initScoringQueue, closeScoringQueue } from './lib/scoringQueue';

// ── Step 2 & 3: Initialise optional services ──────────────────────────────────
// Both must run after dotenv/config (REDIS_URL must be defined by now).
// Both are no-ops if REDIS_URL is absent and log a warning instead.
initRedis();
initScoringQueue();

// ── PORT — required, no silent fallback ───────────────────────────────────────
// A missing PORT would cause the server to bind on an arbitrary default while
// the Vite proxy (and any other client) targets a different port, making every
// API call fail with ECONNREFUSED.  Fail fast here so the misconfiguration is
// caught immediately at startup, not silently at runtime.
if (!process.env.PORT) {
    console.error(
        '[server] Fatal: PORT environment variable is not set.\n' +
        '         Add PORT=3000 to server/.env and restart.'
    );
    process.exit(1);
}

const PORT = parseInt(process.env.PORT, 10);

async function main(): Promise<void> {
    // ── Warm the Neon connection before the first request arrives ─────────────
    // Neon free-tier suspends after ~5 min of inactivity. The first Prisma
    // query after cold wake fails; ensureConnected() retries once after 4 s so
    // the DB is ready by the time we start serving HTTP traffic.
    try {
        await ensureConnected();
        console.log('[server] DB connection established');
    } catch (dbErr) {
        // Non-fatal: log the warning but keep the server running.
        // Individual request handlers will hit the error and surface it via the
        // normal error-handler middleware.
        console.warn('[server] DB warm-up failed (will retry on first request):', dbErr);
    }

    const app = createApp();

    const server = app.listen(PORT, () => {
        console.log(`[server] Running on http://localhost:${PORT}`);
        console.log(`[server] Environment: ${process.env.NODE_ENV ?? 'development'}`);
        console.log(`[server] Health check: http://localhost:${PORT}/health`);
    });

    // ── Graceful shutdown ─────────────────────────────────────────────────────
    // SPEC § Cloud IDE Assumptions (user rules): "expect kernel resets and
    // interrupted sessions" — always clean up connections on exit.
    //
    // Shutdown order matters:
    //   1. Stop accepting new HTTP connections (server.close)
    //   2. Wait for the Postgres worker to finish its in-flight job (closeScoringQueue)
    //   3. Close the dashboard-cache Redis connection (disconnectRedis)
    //   4. Close Prisma / DB connection pool (prisma.$disconnect)
    async function shutdown(signal: string): Promise<void> {
        console.log(`[server] ${signal} received — shutting down gracefully...`);
        server.close(async () => {
            await closeScoringQueue();
            await Promise.all([
                disconnectRedis(),
                prisma.$disconnect(),
            ]);
            console.log('[server] All connections closed. Bye.');
            process.exit(0);
        });
    }

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
    console.error('[server] Fatal startup error:', err);
    process.exit(1);
});
