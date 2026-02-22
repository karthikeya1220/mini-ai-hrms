// =============================================================================
// Entry point — loads env, boots the HTTP server, handles shutdown.
//
// Boot sequence:
//   1. dotenv/config   — populate process.env (MUST be first import)
//   2. initRedis()     — connect the dashboard-cache Redis singleton (optional)
//   3. initScoringQueue() — connect BullMQ queue + worker (optional, needs Redis)
//   4. createApp()     — build Express app + register routes
//   5. app.listen()    — bind HTTP port
//   6. SIGTERM/SIGINT  — graceful shutdown (worker drain → queue close → Redis close → Prisma close)
// =============================================================================

import 'dotenv/config'; // side-effect import — populates process.env from .env

import { createApp } from './app';
import prisma from './lib/prisma';
import { initRedis, disconnectRedis } from './lib/redis';
import { initScoringQueue, closeScoringQueue } from './lib/scoringQueue';

// ── Step 2 & 3: Initialise optional services ──────────────────────────────────
// Both must run after dotenv/config (REDIS_URL must be defined by now).
// Both are no-ops if REDIS_URL is absent and log a warning instead.
initRedis();
initScoringQueue();

const PORT = parseInt(process.env.PORT ?? '3001', 10);

async function main(): Promise<void> {
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
    //   2. Wait for the BullMQ worker to finish its in-flight job (closeScoringQueue)
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
