// =============================================================================
// Auth routes — /api/auth/*
//
// SPEC § 2.4 Authentication Routes:
//   POST /api/auth/register  — no auth
//   POST /api/auth/login     — no auth
//   POST /api/auth/refresh   — no auth (uses refresh token cookie)
//   POST /api/auth/logout    — no auth (uses refresh token cookie)
//
// Logout does NOT require a valid access token.  The controller reads the
// httpOnly refresh cookie directly and calls logoutUser(), which verifies
// the refresh token and increments tokenVersion.  This means a user whose
// access token has already expired can still log out cleanly.
//
// Rate limiting (CRITICAL-3 from arch audit):
//   POST /register and POST /login are both protected by authRateLimiter():
//     max 10 requests per IP per 15 minutes.
//   /refresh and /logout are intentionally excluded:
//     - /refresh uses a signed httpOnly cookie (not brute-forceable by IP)
//     - /logout is low-risk and should never be blocked for a legit user
// =============================================================================

import { Router } from 'express';
import { authRateLimiter } from '../middleware/rateLimiter';
import {
    register,
    login,
    refresh,
    logout,
} from '../controllers/auth.controller';

const router = Router();

// ── Public (rate-limited) ─────────────────────────────────────────────────────
// authRateLimiter() is applied per-route (not router.use) so that /refresh
// and /logout are never throttled. The middleware is created once and reused.
const limit = authRateLimiter();

router.post('/register', limit, register);
router.post('/login', limit, login);

// ── Public (no rate limit) ────────────────────────────────────────────────────
// Both routes derive identity from the signed httpOnly refresh cookie —
// authMiddleware (access token) is deliberately absent from both.
router.post('/refresh', refresh);
router.post('/logout',  logout);

export default router;
