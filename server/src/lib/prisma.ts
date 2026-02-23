// =============================================================================
// Prisma client singleton
//
// Instantiated once and re-used across all services.
// In development, attaches the instance to globalThis to survive hot-reloads
// (nodemon re-requires modules but doesn't reset globalThis).
// In production, a plain singleton is fine.
//
// Neon free-tier note
// ───────────────────
// Neon suspends the compute after ~5 min of inactivity. The first query after
// a cold wake hits a transient "Can't reach database server" error. We expose
// ensureConnected() which is called on startup and from the error handler so
// the DB is warm before real requests arrive.
//
// DO NOT set connection_limit=1 — Neon's pooler already manages connections
// and reducing the limit to 1 causes P2024 timeouts when two queries run in
// parallel (e.g. Promise.all([count, findMany])).
// =============================================================================

import { PrismaClient } from '@prisma/client';

declare global {
    // Allow re-use across hot-reload cycles in development without spawning
    // multiple PrismaClient instances (which exhausts the connection pool).
    // eslint-disable-next-line no-var
    var __prisma: PrismaClient | undefined;
}

const prisma: PrismaClient =
    global.__prisma ??
    new PrismaClient({
        log:
            process.env.NODE_ENV === 'development'
                ? ['warn', 'error']
                : ['warn', 'error'],
    });

if (process.env.NODE_ENV !== 'production') {
    global.__prisma = prisma;
}

/**
 * Ping the DB and retry once after 4 s if the first attempt fails.
 * Handles Neon free-tier cold-wake: the first connection after ~5 min
 * inactivity may fail with "Can't reach database server".
 */
export async function ensureConnected(): Promise<void> {
    try {
        await prisma.$queryRaw`SELECT 1`;
    } catch (firstErr) {
        const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
        if (msg.includes("Can't reach database") || msg.includes('ECONNRESET') || msg.includes('connect')) {
            console.warn('[prisma] Cold-start ping failed, retrying in 4 s…', msg.split('\n')[0]);
            await new Promise(r => setTimeout(r, 4000));
            await prisma.$queryRaw`SELECT 1`; // throws if still unreachable
        } else {
            throw firstErr;
        }
    }
}

export default prisma;
