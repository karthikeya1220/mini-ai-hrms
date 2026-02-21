// =============================================================================
// Dashboard routes — /api/dashboard
//
// SPEC § 2.4: GET /api/dashboard (protected)
//
// Auth: authMiddleware applied at router.use() — protects all routes in this
// file unconditionally. Any new dashboard endpoint inherits protection.
// =============================================================================

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getDashboardHandler } from '../controllers/dashboard.controller';

const router = Router();

// Enforce JWT on every route in this file.
router.use(authMiddleware);

// ── GET /api/dashboard ────────────────────────────────────────────────────────
// Org-scoped aggregate statistics + per-employee completion breakdown.
router.get('/', getDashboardHandler);

export default router;
