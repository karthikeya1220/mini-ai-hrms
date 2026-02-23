// =============================================================================
// Auth controller — HTTP layer for /api/auth/* routes.
//
// Responsibilities (AUTH_SYSTEM.md):
//   POST /api/auth/register  — create org + first ADMIN user, issue tokens
//   POST /api/auth/login     — verify credentials, issue tokens
//   POST /api/auth/refresh   — rotate tokens via httpOnly cookie
//   POST /api/auth/logout    — read refresh cookie, increment tokenVersion, clear cookie
//
// Logout does NOT require a valid access token.  userId is extracted from the
// signed refresh token cookie so that a user with an expired access token can
// still invalidate their session.  logoutUser() in auth.service.ts performs
// the tokenVersion increment via verifyRefreshToken(rawToken).
//
// Cookie contract:
//   Name:     refreshToken
//   httpOnly: true   — JS cannot read it
//   secure:   true in production (HTTPS only)
//   sameSite: 'strict' — no cross-site requests
//   path:     /api/auth — scoped to auth routes only
//   maxAge:   7 days in milliseconds
//
// The access token is returned in the response body only.
// The refresh token is set as the cookie above and never appears in the body.
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { sendSuccess } from '../utils/response';
import { AppError } from '../middleware/errorHandler';
import { registerUser, loginUser, refreshAccessToken, logoutUser } from '../services/auth.service';

// ─── Cookie constants ─────────────────────────────────────────────────────────
const REFRESH_COOKIE_NAME = 'refreshToken';
const SEVEN_DAYS_MS       = 7 * 24 * 60 * 60 * 1000;

/** Attach the refresh token as an httpOnly cookie on the response. */
function setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE_NAME, token, {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path:     '/api/auth',   // scoped — cookie not sent to /api/employees etc.
        maxAge:   SEVEN_DAYS_MS,
    });
}

/** Clear the refresh token cookie (used on logout). */
function clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path:     '/api/auth',
    });
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

// role is intentionally absent — registration ALWAYS produces an ADMIN.
// Employee accounts are created exclusively by an authenticated ADMIN via
// POST /api/employees.  Accepting role from the client would let any
// anonymous caller self-register as EMPLOYEE on a new org they control.
const RegisterSchema = z.object({
    orgName:  z.string().min(1, 'Organization name is required').max(255),
    email:    z.string().email('Invalid email address').max(255),
    password: z.string()
        .min(8,  'Password must be at least 8 characters')
        .max(72, 'Password must be at most 72 characters'),  // bcrypt hard limit
});

const LoginSchema = z.object({
    email:    z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
});

// ─── POST /api/auth/register ──────────────────────────────────────────────────

export async function register(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const body = RegisterSchema.parse(req.body);

        const result = await registerUser(body);

        // Refresh token → httpOnly cookie. Never in the response body.
        setRefreshCookie(res, result.refreshToken);

        // Return access token + safe user shape only.
        sendSuccess(res, {
            accessToken: result.accessToken,
            user:        result.user,
        }, 201);
    } catch (err) {
        next(err);
    }
}

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

export async function login(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { email, password } = LoginSchema.parse(req.body);

        const result = await loginUser({ email, password });

        // Refresh token → httpOnly cookie. Never in the response body.
        setRefreshCookie(res, result.refreshToken);

        sendSuccess(res, {
            accessToken: result.accessToken,
            user:        result.user,
        });
    } catch (err) {
        next(err);
    }
}

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────

export async function refresh(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const token: string | undefined = req.cookies?.[REFRESH_COOKIE_NAME];

        if (!token) {
            throw new AppError(401, 'MISSING_REFRESH_TOKEN', 'No refresh token cookie present.');
        }

        const result = await refreshAccessToken(token);

        // Rotation: replace the old httpOnly cookie with the newly issued refresh token.
        // The old token's embedded tokenVersion is now stale — any replay attempt
        // will be rejected by the tokenVersion check in refreshAccessToken().
        setRefreshCookie(res, result.refreshToken);

        sendSuccess(res, { accessToken: result.accessToken });
    } catch (err) {
        next(err);
    }
}

// ─── POST /api/auth/logout ────────────────────────────────────────────────────

export async function logout(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const token: string | undefined = req.cookies?.[REFRESH_COOKIE_NAME];

        // Revoke server-side session by incrementing tokenVersion.
        // logoutUser absorbs missing/invalid/expired token silently —
        // only genuine DB errors propagate to next(err).
        await logoutUser(token);

        // Always clear the cookie, regardless of whether a token was present
        // or whether the DB update found a matching row.
        clearRefreshCookie(res);

        sendSuccess(res, { message: 'Logged out successfully.' });
    } catch (err) {
        // DB-level failure: still clear the cookie so the client is not stuck
        // in a logged-in state while the server is degraded, then propagate.
        clearRefreshCookie(res);
        next(err);
    }
}

