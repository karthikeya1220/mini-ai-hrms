// =============================================================================
// Dashboard routes — /api/dashboard
//
// SPEC § 2.4: GET /api/dashboard (protected)
//
// Auth: admin only on every route — dashboard aggregates are org-wide data
// that employees must not read.  Per-route chains used (not router.use) for
// consistency with the rest of the codebase and to make the gate explicit on
// each line.
// =============================================================================

import { Router } from 'express';
import { authMiddleware, authorize } from '../middleware/auth';
import {
    getDashboardHandler,
    getDashboardEmployeesHandler,
} from '../controllers/dashboard.controller';

const router = Router();

// ── GET /api/dashboard ────────────────────────────────────────────────────────
// Org-scoped aggregate statistics + per-employee completion breakdown.
// Admin only — employees must not see org-wide productivity data.
router.get('/',          authMiddleware, authorize(['ADMIN']), getDashboardHandler);

// ── GET /api/dashboard/employees ──────────────────────────────────────────────
// All employees with their productivity scores and completed task counts.
// Admin only — an employee must not read another employee's score via this route.
router.get('/employees', authMiddleware, authorize(['ADMIN']), getDashboardEmployeesHandler);

export default router;
