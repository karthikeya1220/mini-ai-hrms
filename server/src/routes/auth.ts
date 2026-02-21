// =============================================================================
// Auth routes — /api/auth/*
//
// SPEC § 2.4 Authentication Routes:
//   POST /api/auth/register  — no auth
//   POST /api/auth/login     — no auth
//   POST /api/auth/refresh   — no auth (uses refresh token cookie)
//   POST /api/auth/logout    — requires access token JWT
//
// All auth routes are public EXCEPT logout, which requires the authMiddleware
// so we know which session to invalidate.
// =============================================================================

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
    register,
    login,
    refresh,
    logout,
} from '../controllers/auth.controller';

const router = Router();

// ── Public ────────────────────────────────────────────────────────────────────
router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refresh);

// ── Protected — valid access token required ───────────────────────────────────
router.post('/logout', authMiddleware, logout);

export default router;
