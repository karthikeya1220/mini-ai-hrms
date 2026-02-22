// =============================================================================
// Auth controller — HTTP layer for /api/auth/* routes.
//
// Responsibilities (AUTH_SYSTEM.md):
//   POST /api/auth/register  — create org + first ADMIN user, issue tokens
//   POST /api/auth/login     — verify credentials, issue tokens
//   POST /api/auth/refresh   — rotate tokens via httpOnly cookie
//   POST /api/auth/logout    — increment tokenVersion, clear cookie
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

const RegisterSchema = z.object({
    orgName:  z.string().min(1, 'Organization name is required').max(255),
    email:    z.string().email('Invalid email address').max(255),
    password: z.string()
        .min(8,  'Password must be at least 8 characters')
        .max(72, 'Password must be at most 72 characters'),  // bcrypt hard limit
    role:     z.enum(['ADMIN', 'EMPLOYEE']).default('ADMIN'),
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

        // Access token returned in body only. Refresh cookie is NOT touched —
        // intentional: the existing cookie continues to be used until logout
        // or password change increments tokenVersion.
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

