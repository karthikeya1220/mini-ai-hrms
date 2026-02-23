// =============================================================================
// Auth middleware — validates JWT access token and populates req.user.
//
// Design (AUTH_SYSTEM.md):
//   - Reads Authorization: Bearer <token> header only.
//   - Verifies the token locally (HMAC-SHA256 + issuer check) via
//     verifyAccessToken — no outbound network call, no Supabase dependency.
//   - Populates req.user from the verified payload exclusively.
//     orgId, userId, employeeId, role and email are all JWT claims signed
//     at login time.  The request body is never consulted.
//   - Distinguishes TOKEN_EXPIRED from TOKEN_INVALID so clients can decide
//     whether to attempt a silent refresh or prompt re-login.
//
// Trust model:
//   The access token is trusted for its 1 h lifetime.  isActive and
//   tokenVersion are NOT re-checked on every request — that would add a DB
//   round-trip to every authenticated call.  Hard revocation happens at
//   refresh time (tokenVersion check in refreshAccessToken).  If real-time
//   deactivation is required, add a Redis session-presence check here.
//
// authorize():
//   Role comparison uses strict string equality against the Role enum values
//   in the verified JWT payload — req.body is never read.
//
// authorizeOwnerOrAdmin():
//   Allows access when the caller is ADMIN or when the caller's own
//   Employee UUID matches req.params.id.  Does NOT enforce org scoping —
//   controllers remain responsible for WHERE orgId = req.user.orgId on
//   every DB query.  This middleware only answers "is this your record?",
//   not "does this record belong to your org?".
// =============================================================================

import { Response, NextFunction } from 'express';
import { AuthRequest, UserRole } from '../types';
import { sendError } from '../utils/response';
import { verifyAccessToken } from '../services/auth.service';
import { AppError } from './errorHandler';

// ─── authMiddleware ───────────────────────────────────────────────────────────

export async function authMiddleware(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    // 1. Extract bearer token — reject immediately if header is absent or malformed.
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        sendError(res, 401, 'UNAUTHORIZED', 'Missing or malformed Authorization header.');
        return;
    }

    const token = authHeader.slice(7);

    // Guard: empty string after stripping "Bearer "
    if (!token) {
        sendError(res, 401, 'UNAUTHORIZED', 'Authorization header contains no token.');
        return;
    }

    // 2. Verify token locally — no DB call, no Supabase call.
    //    verifyAccessToken throws AppError with specific codes on failure.
    try {
        const payload = verifyAccessToken(token);

        // 3. Populate req.user exclusively from the verified JWT payload.
        //    Every field is cryptographically bound — the client cannot forge any of them.
        //    email is not in the token (removed as PII); fetch via GET /api/me if needed.
        req.user = {
            id:         payload.userId,
            orgId:      payload.orgId,
            employeeId: payload.employeeId,
            role:       payload.role as UserRole,
        };

        next();
    } catch (err) {
        // 4. Distinguish expiry from structural invalidity.
        //    Clients use TOKEN_EXPIRED as the signal to attempt a silent refresh.
        //    TOKEN_INVALID means the token is corrupt/tampered — re-login required.
        if (err instanceof AppError) {
            if (err.code === 'TOKEN_EXPIRED') {
                sendError(res, 401, 'TOKEN_EXPIRED', 'Access token has expired.');
                return;
            }
            // TOKEN_NOT_ACTIVE, INVALID_TOKEN, or any other auth AppError
            sendError(res, 401, 'TOKEN_INVALID', 'Access token is invalid.');
            return;
        }

        // Unexpected error (should never reach here — verifyAccessToken only
        // throws AppError, but guard defensively).
        sendError(res, 401, 'UNAUTHORIZED', 'Authentication failed.');
    }
}

// ─── authorize ────────────────────────────────────────────────────────────────

/**
 * Role-based authorization guard.
 * Must be chained after authMiddleware — req.user is assumed to be populated.
 *
 * Usage:
 *   router.get('/admin-only', authMiddleware, authorize(['ADMIN']), handler);
 *
 * Role values are compared against the JWT payload's role claim — they are
 * never read from the request body or query string.
 */
export function authorize(roles: UserRole[]) {
    return (req: AuthRequest, res: Response, next: NextFunction): void => {
        if (!req.user) {
            // authMiddleware was not applied before this guard — programming error.
            sendError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
            return;
        }

        if (!roles.includes(req.user.role)) {
            sendError(
                res,
                403,
                'FORBIDDEN',
                `This action requires one of the following roles: [${roles.join(', ')}].`
            );
            return;
        }

        next();
    };
}

// ─── authorizeOwnerOrAdmin ────────────────────────────────────────────────────

/**
 * Ownership + role guard for routes that operate on a single Employee record.
 * Must be chained after authMiddleware — req.user is assumed to be populated.
 *
 * Allows the request through when EITHER condition is true:
 *   1. req.user.role === 'ADMIN'  (full access within the org)
 *   2. req.user.employeeId === req.params[paramName]  (employee owns this record)
 *
 * Rejects with 403 in all other cases, including:
 *   - EMPLOYEE whose employeeId is null (no linked profile yet)
 *   - EMPLOYEE whose employeeId does not match the requested :id
 *
 * ⚠ Org-scoping is NOT enforced here — this middleware only answers
 *   "is this your record?".  Every controller that uses this guard MUST
 *   still apply WHERE orgId = req.user.orgId on its DB query so that a
 *   legitimate employee from org A cannot read org B's data even if the
 *   param IDs coincidentally collide.
 *
 * @param paramName - The route param name that holds the Employee UUID.
 *                    Defaults to 'id' to match the standard /:id pattern.
 *
 * Usage:
 *   // Standard /:id route
 *   router.get('/:id', authMiddleware, authorizeOwnerOrAdmin(), handler);
 *
 *   // Non-standard param name
 *   router.get('/:employeeId/profile', authMiddleware, authorizeOwnerOrAdmin('employeeId'), handler);
 */
export function authorizeOwnerOrAdmin(paramName = 'id') {
    return (req: AuthRequest, res: Response, next: NextFunction): void => {
        // Guard: authMiddleware was not applied before this guard — programming error.
        if (!req.user) {
            sendError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
            return;
        }

        // Path 1 — ADMIN: unconditional pass (still org-scoped by the controller).
        if (req.user.role === 'ADMIN') {
            next();
            return;
        }

        // Path 2 — EMPLOYEE: must own the record.
        const targetId = req.params[paramName];

        // Guard: route was mounted without the expected param — programming error.
        if (!targetId) {
            sendError(
                res,
                500,
                'INTERNAL_ERROR',
                `authorizeOwnerOrAdmin: route param '${paramName}' is not present.`
            );
            return;
        }

        // Guard: employeeId is null — user has no linked Employee profile yet.
        // A null employeeId must never match any real UUID.
        if (req.user.employeeId === null) {
            sendError(
                res,
                403,
                'FORBIDDEN',
                'Your account is not linked to an employee profile.'
            );
            return;
        }

        // Ownership check — both values are UUIDs sourced from the DB; compare
        // with strict equality (no case-folding needed for UUIDs in lowercase
        // canonical form, but normalise defensively).
        if (req.user.employeeId.toLowerCase() !== targetId.toLowerCase()) {
            sendError(
                res,
                403,
                'FORBIDDEN',
                'You do not have permission to access this resource.'
            );
            return;
        }

        next();
    };
}
