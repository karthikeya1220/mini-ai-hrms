// =============================================================================
// Entry point — loads env, boots the HTTP server, handles shutdown.
//
// This file's only job is to:
//   1. Load environment variables (must happen before any other import)
//   2. Create the app
//   3. Bind the HTTP listener
//   4. Handle SIGTERM / SIGINT for graceful shutdown (closes Prisma connection)
// =============================================================================

import 'dotenv/config'; // side-effect import — populates process.env from .env

import { createApp } from './app';
import prisma from './lib/prisma';

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
    // interrupted sessions" — always clean up DB connections on exit.
    async function shutdown(signal: string): Promise<void> {
        console.log(`[server] ${signal} received — shutting down gracefully...`);
        server.close(async () => {
            await prisma.$disconnect();
            console.log('[server] Prisma disconnected. Bye.');
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
