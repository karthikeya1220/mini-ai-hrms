// =============================================================================
// Auth controller — HTTP layer for /api/auth/* routes.
//
// Auth is now maintained at Supabase. This controller:
//   - POST /api/auth/register  — creates org + employee in Postgres
//   - POST /api/auth/login     — validates against Supabase, returns token
//   - POST /api/auth/logout    — no-op (client calls supabase.auth.signOut())
//   - POST /api/auth/refresh   — no-op (Supabase SDK handles refresh)
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { sendSuccess } from '../utils/response';
import {
    registerOrg,
    loginOrg,
} from '../services/auth.service';

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const RegisterSchema = z.object({
    name: z.string().min(1, 'Organization name is required').max(255),
    email: z.string().email('Invalid email address').max(255),
    password: z.string().min(8, 'Password must be at least 8 characters'),
});

const LoginSchema = z.object({
    email: z.string().email('Invalid email address'),
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
        const result = await registerOrg(body);

        sendSuccess(res, {
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            user: result.user,
            org: result.org,
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
        const body = LoginSchema.parse(req.body);
        const result = await loginOrg(body);

        sendSuccess(res, {
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            user: result.user,
            org: result.org,
        });
    } catch (err) {
        next(err);
    }
}

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
// Token refresh is handled by the Supabase SDK on the client.

export async function refresh(
    _req: Request,
    res: Response,
    _next: NextFunction
): Promise<void> {
    sendSuccess(res, { message: 'Use Supabase SDK to refresh tokens.' });
}

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
// Client calls supabase.auth.signOut() directly; nothing to do on the server.

export async function logout(
    _req: Request,
    res: Response,
    _next: NextFunction
): Promise<void> {
    sendSuccess(res, { message: 'Logged out successfully' });
}
