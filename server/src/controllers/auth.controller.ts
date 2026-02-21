// =============================================================================
// Auth controller — HTTP layer for /api/auth/* routes.
//
// Responsibility boundary:
//   - Parse and validate request body (via Zod schemas defined here)
//   - Call the auth service
//   - Set / clear the httpOnly refresh token cookie
//   - Return the SPEC-mandated response shape
//
// The controller knows about HTTP (req, res). The service knows nothing about HTTP.
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { sendSuccess, sendError } from '../utils/response';
import {
    registerOrg,
    loginOrg,
    refreshAccessToken,
    logoutOrg,
} from '../services/auth.service';

// ─── Zod schemas ──────────────────────────────────────────────────────────────
// SPEC § 5.2: "All inputs validated with Zod schemas before touching the database"

const RegisterSchema = z.object({
    name: z.string().min(1, 'Organization name is required').max(255),
    email: z.string().email('Invalid email address').max(255),
    password: z.string().min(8, 'Password must be at least 8 characters'),
});

const LoginSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
});

// ─── Cookie config ────────────────────────────────────────────────────────────
// SPEC § Day 1 Hour 1–4: refresh token stored in httpOnly cookie.
// Secure flag is toggled by NODE_ENV so dev works over http://localhost.
const REFRESH_COOKIE_NAME = 'rz_refresh';

function refreshCookieOptions() {
    return {
        httpOnly: true,                                   // JS cannot read this cookie — XSS safe
        secure: process.env.NODE_ENV === 'production',  // HTTPS only in prod
        sameSite: 'strict' as const,                      // CSRF protection
        maxAge: 7 * 24 * 60 * 60 * 1000,               // 7 days in ms — matches JWT_REFRESH_EXPIRES_IN
        path: '/api/auth',                            // scoped to auth routes only
    };
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────

/**
 * Register a new organization.
 *
 * SPEC Login Response:
 *   { success, accessToken, org: { id, name, email } }
 *
 * orgId is NEVER read from the request body — it is DB-generated and returned
 * in the response + embedded in the issued JWT.
 */
export async function register(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const body = RegisterSchema.parse(req.body);
        const result = await registerOrg(body);

        // Set refresh token in httpOnly cookie
        res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions());

        // Return access token + org info in body (SPEC Login Response shape)
        sendSuccess(
            res,
            {
                accessToken: result.accessToken,
                org: result.org,
            },
            201
        );
    } catch (err) {
        next(err); // forwards to global errorHandler (handles ZodError + AppError)
    }
}

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

/**
 * Authenticate an existing organization.
 * Returns the same shape as register so the client can handle both uniformly.
 */
export async function login(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const body = LoginSchema.parse(req.body);
        const result = await loginOrg(body);

        res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions());

        sendSuccess(res, {
            accessToken: result.accessToken,
            org: result.org,
        });
    } catch (err) {
        next(err);
    }
}

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────

/**
 * Issue a new access token using the refresh token from the httpOnly cookie.
 *
 * SPEC: "Refresh access token — No (refresh token)" for Auth Required.
 * The refresh token is read from the cookie — NOT from the request body.
 */
export async function refresh(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;

        if (!refreshToken) {
            sendError(res, 401, 'NO_REFRESH_TOKEN', 'Refresh token cookie is missing. Please log in.');
            return;
        }

        const result = await refreshAccessToken(refreshToken);

        sendSuccess(res, { accessToken: result.accessToken });
    } catch (err) {
        next(err);
    }
}

// ─── POST /api/auth/logout ────────────────────────────────────────────────────

/**
 * Logout the current session:
 *   1. Revoke the refresh token (prevents future token renewals).
 *   2. Clear the httpOnly cookie on the client.
 *
 * The access token (1h) will naturally expire — this is an accepted
 * stateless JWT trade-off documented in SPEC Risk R6.
 */
export async function logout(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;

        if (refreshToken) {
            await logoutOrg(refreshToken);
        }

        // Clear the cookie regardless of whether a token was present
        res.clearCookie(REFRESH_COOKIE_NAME, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict' as const,
            path: '/api/auth',
        });

        sendSuccess(res, { message: 'Logged out successfully' });
    } catch (err) {
        next(err);
    }
}
