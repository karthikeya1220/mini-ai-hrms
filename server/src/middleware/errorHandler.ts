// =============================================================================
// Error handler middleware — must be registered LAST in Express.
//
// Catches anything passed via next(err).
// SPEC § 2.4: all errors return { success, error, message, statusCode }.
// SPEC § 5.2: no console.log in production paths — structured logger stub used.
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { sendError } from '../utils/response';

// Minimal structured logger (swap for winston/pino in production)
function logError(err: unknown): void {
    if (process.env.NODE_ENV !== 'test') {
        console.error('[ERROR]', err);
    }
}

// A typed application error you can throw from anywhere in the codebase.
export class AppError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly code: string,
        message: string
    ) {
        super(message);
        this.name = 'AppError';
    }
}

// ─── Global error handler ────────────────────────────────────────────────────
export function errorHandler(
    err: unknown,
    _req: Request,
    res: Response,
    // next MUST be declared even if unused — Express uses arity to identify error handlers
    _next: NextFunction
): void {
    logError(err);

    // 1. Zod validation errors — map to field-level messages
    if (err instanceof ZodError) {
        const message = err.errors
            .map((e) => `${e.path.join('.')}: ${e.message}`)
            .join('; ');
        sendError(res, 400, 'VALIDATION_ERROR', message);
        return;
    }

    // 2. Known application errors thrown with AppError
    if (err instanceof AppError) {
        sendError(res, err.statusCode, err.code, err.message);
        return;
    }

    // 3. Unexpected errors — never leak internals to caller
    sendError(
        res,
        500,
        'INTERNAL_SERVER_ERROR',
        'An unexpected error occurred. Please try again.'
    );
}

// ─── 404 handler — catches any route not matched by the router ───────────────
export function notFoundHandler(req: Request, res: Response): void {
    sendError(res, 404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`);
}
