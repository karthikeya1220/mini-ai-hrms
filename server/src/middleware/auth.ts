// =============================================================================
// Auth middleware — validates JWT access token and populates req.org.
//
// SPEC § 1.3 (Fundamental Principles — Multi-Tenancy First):
//   "The orgId is extracted from the JWT on every authenticated request.
//    Clients NEVER pass an orgId in the request body."
//
// SPEC § Day 1, Hour 1–4:
//   "authMiddleware extracts orgId from JWT and attaches to req.org"
//
// Risk R7 (architecture analysis): org existence is NOT re-validated against
// the database on every request — this is a documented limitation. The JWT
// is trusted until expiry (1h). If real-time deactivation is needed, add a
// Redis revocation check here.
// =============================================================================

import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { sendError } from '../utils/response';
import { verifyAccessToken } from '../utils/jwt';
import { AppError } from './errorHandler';

export function authMiddleware(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): void {
    // ── 1. Extract Bearer token from Authorization header ─────────────────────
    // Client stores the access token in-memory (SPEC § Hour 10–13).
    // It is NOT in localStorage — it is sent manually on each request.
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        sendError(
            res,
            401,
            'UNAUTHORIZED',
            'Missing or malformed Authorization header. Expected: Bearer <token>'
        );
        return;
    }

    const token = authHeader.slice(7); // strip "Bearer " prefix

    if (!token) {
        sendError(res, 401, 'UNAUTHORIZED', 'Access token is empty');
        return;
    }

    // ── 2. Verify token and extract payload ───────────────────────────────────
    // verifyAccessToken throws AppError on invalid/expired tokens.
    // We catch it here and translate to a response — we are in middleware,
    // not inside next(), so the global errorHandler won't fire for us.
    try {
        const payload = verifyAccessToken(token);

        // ── 3. Attach org context to request ────────────────────────────────────
        // Downstream controllers / services read req.org.id — NEVER req.body.orgId.
        // This is the single source of truth for multi-tenancy scoping.
        req.org = {
            id: payload.orgId,
            email: payload.email,
        };

        next();
    } catch (err) {
        if (err instanceof AppError) {
            sendError(res, err.statusCode, err.code, err.message);
            return;
        }
        // Unexpected error — don't leak details
        sendError(res, 401, 'UNAUTHORIZED', 'Authentication failed');
    }
}
