// =============================================================================
// Dashboard routes — /api/dashboard
//
// SPEC § 2.4: GET /api/dashboard (protected)
//
// Auth: authMiddleware applied at router.use() — protects all routes in this
// file unconditionally. Any new dashboard endpoint inherits protection.
// =============================================================================

import { Router } from 'express';
import { authMiddleware, authorize } from '../middleware/auth';
import {
    getDashboardHandler,
    getDashboardEmployeesHandler,
} from '../controllers/dashboard.controller';

const router = Router();

// Enforce JWT and ADMIN role on every route in this file.
router.use(authMiddleware);
router.use(authorize(['ADMIN']));

// ── GET /api/dashboard ────────────────────────────────────────────────────────
// Org-scoped aggregate statistics + per-employee completion breakdown.
router.get('/', getDashboardHandler);

// ── GET /api/dashboard/employees ──────────────────────────────────────────────
// List of all employees with their productivity scores and completed task counts.
router.get('/employees', getDashboardEmployeesHandler);


export default router;
