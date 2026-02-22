// =============================================================================
// Application factory — creates and configures the Express app.
//
// Separated from index.ts (the entry point) so the configured app can be
// imported by tests without starting the HTTP listener.
// =============================================================================

import express, { Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { registerRoutes } from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

export function createApp(): Express {
    const app = express();

    // ── CORS ──────────────────────────────────────────────────────────────────
    // SPEC § 5.4 pitfall: set ALLOWED_ORIGINS env var; configure cors() before
    // all routes. Comma-separated origins supported for multi-origin deployments.
    const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
        .split(',')
        .map((o) => o.trim());

    // ── Startup Guard ────────────────────────────────────────────────────────
    // SPEC § 5.4 Safety: In production, we MUST NOT allow localhost as an origin.
    // This prevents accidental exposure where an attacker could leverage a user's
    // local development environment to bypass CORS.
    if (process.env.NODE_ENV === 'production') {
        const hasLocalhost = allowedOrigins.some(o =>
            o.includes('localhost') || o.includes('127.0.0.1')
        );
        if (hasLocalhost) {
            throw new Error(
                '[startup] SECURITY VIOLATION: ALLOWED_ORIGINS contains localhost in production. ' +
                'Update your environment variables to use a real domain.'
            );
        }
    }

    app.use(
        cors({
            origin: (origin, callback) => {
                // Allow requests with no origin (e.g. curl, Postman, server-to-server)
                if (!origin || allowedOrigins.includes(origin)) {
                    callback(null, true);
                } else {
                    callback(new Error(`CORS: origin '${origin}' not in ALLOWED_ORIGINS`));
                }
            },
            credentials: true,          // required for httpOnly refresh token cookie
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization'],
        })
    );

    // ── Cookie parser ─────────────────────────────────────────────────────────
    // Required for req.cookies to be populated — needed by auth/refresh & logout.
    // Must be registered before routes.
    app.use(cookieParser());

    // ── Body parsing ──────────────────────────────────────────────────────────
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true }));

    // ── Routes ────────────────────────────────────────────────────────────────
    registerRoutes(app);

    // ── 404 — must come after all routes ─────────────────────────────────────
    app.use(notFoundHandler);

    // ── Global error handler — must be LAST and have 4 params ────────────────
    app.use(errorHandler);

    return app;
}
