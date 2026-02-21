// =============================================================================
// Prisma client singleton
//
// Instantiated once and re-used across all services.
// In development, attaches the instance to globalThis to survive hot-reloads
// (nodemon re-requires modules but doesn't reset globalThis).
// In production, a plain singleton is fine.
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
                ? ['query', 'warn', 'error']
                : ['warn', 'error'],
    });

if (process.env.NODE_ENV !== 'production') {
    global.__prisma = prisma;
}

export default prisma;
