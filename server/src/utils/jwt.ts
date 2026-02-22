// =============================================================================
// JWT utilities — sign and verify access + refresh tokens.
//
// SPEC § Day 1, Hour 1–4:
//   "Access token: 1 hour expiry, contains { orgId, email }"
//   "Refresh token: 7 day expiry, stored in httpOnly cookie"
//
// SPEC Risk R8 (from architecture analysis):
//   Adding `sub` = orgId and `jti` (token ID) to the payload future-proofs
//   multi-session support and makes per-token revocation possible.
//
// Secrets are read from env on each call (not module-load-time constants) so
// that test suites can swap them via process.env without module cache issues.
// =============================================================================

import jwt, { SignOptions, JwtPayload } from 'jsonwebtoken';
import { AppError } from '../middleware/errorHandler';

// ─── Payload shape ────────────────────────────────────────────────────────────
// SPEC: JWT payload must contain { orgId, email }.
// sub = userId mirrors RFC 7519 — keeps the token interoperable.
export interface JwtAccessPayload extends JwtPayload {
    orgId: string;
    userId: string;  // can be Org ID (for system admin) or Employee ID
    email: string;
    role: string;    // 'ADMIN' | 'EMPLOYEE'
}

export interface JwtRefreshPayload extends JwtPayload {
    userId: string;
    orgId: string;
}

// ─── Environment guard ────────────────────────────────────────────────────────
function requireSecret(key: 'JWT_SECRET' | 'JWT_REFRESH_SECRET'): string {
    const value = process.env[key];
    if (!value) {
        throw new Error(
            `[jwt] Environment variable ${key} is not set. ` +
            `The server cannot issue tokens without it.`
        );
    }
    return value;
}

// ─── Access token ─────────────────────────────────────────────────────────────

/**
 * Sign a short-lived access token.
 * Payload: { orgId, email, sub: orgId }
 * Expiry: JWT_EXPIRES_IN (default 1h — SPEC-mandated)
 */
export function signAccessToken(userId: string, orgId: string, email: string, role: string): string {
    const secret = requireSecret('JWT_SECRET');
    const expiresIn = (process.env.JWT_EXPIRES_IN ?? '1h') as SignOptions['expiresIn'];

    const payload: Omit<JwtAccessPayload, keyof JwtPayload> = { userId, orgId, email, role };

    return jwt.sign(payload, secret, {
        subject: userId,      // RFC 7519 sub claim — satisfies R8
        expiresIn,
        issuer: 'mini-ai-hrms',
    });
}

/**
 * Verify and decode an access token.
 * Throws AppError 401 on invalid/expired tokens — callers do not need
 * to catch jwt.JsonWebTokenError themselves.
 */
export function verifyAccessToken(token: string): JwtAccessPayload {
    const secret = requireSecret('JWT_SECRET');

    try {
        const payload = jwt.verify(token, secret, {
            issuer: 'mini-ai-hrms',
        }) as JwtAccessPayload;

        // Structural guard — ensure the payload contains what we require
        if (!payload.userId || !payload.orgId || !payload.email || !payload.role) {
            throw new AppError(401, 'INVALID_TOKEN', 'Token payload is malformed');
        }

        return payload;
    } catch (err) {
        if (err instanceof AppError) throw err;

        if (err instanceof jwt.TokenExpiredError) {
            throw new AppError(401, 'TOKEN_EXPIRED', 'Access token has expired');
        }
        if (err instanceof jwt.JsonWebTokenError) {
            throw new AppError(401, 'INVALID_TOKEN', 'Access token is invalid');
        }

        throw new AppError(401, 'INVALID_TOKEN', 'Token verification failed');
    }
}

// ─── Refresh token ────────────────────────────────────────────────────────────

/**
 * Sign a long-lived refresh token.
 * Expiry: JWT_REFRESH_EXPIRES_IN (default 7d — SPEC-mandated)
 * Stored client-side in an httpOnly cookie — never in localStorage.
 */
export function signRefreshToken(userId: string, orgId: string): string {
    const secret = requireSecret('JWT_REFRESH_SECRET');
    const expiresIn = (process.env.JWT_REFRESH_EXPIRES_IN ?? '7d') as SignOptions['expiresIn'];

    return jwt.sign({ userId, orgId } satisfies Omit<JwtRefreshPayload, keyof JwtPayload>, secret, {
        subject: userId,
        expiresIn,
        issuer: 'mini-ai-hrms',
    });
}

/**
 * Verify and decode a refresh token.
 * Throws AppError 401 on invalid/expired — same contract as verifyAccessToken.
 */
export function verifyRefreshToken(token: string): JwtRefreshPayload {
    const secret = requireSecret('JWT_REFRESH_SECRET');

    try {
        const payload = jwt.verify(token, secret, {
            issuer: 'mini-ai-hrms',
        }) as JwtRefreshPayload;

        if (!payload.userId || !payload.orgId) {
            throw new AppError(401, 'INVALID_TOKEN', 'Refresh token payload is malformed');
        }

        return payload;
    } catch (err) {
        if (err instanceof AppError) throw err;

        if (err instanceof jwt.TokenExpiredError) {
            throw new AppError(401, 'TOKEN_EXPIRED', 'Refresh token has expired. Please log in again.');
        }
        if (err instanceof jwt.JsonWebTokenError) {
            throw new AppError(401, 'INVALID_TOKEN', 'Refresh token is invalid');
        }

        throw new AppError(401, 'INVALID_TOKEN', 'Refresh token verification failed');
    }
}
