// =============================================================================
// Employee routes — /api/employees/*
//
// SPEC § 2.4 Employee Routes:
//   GET    /api/employees       → admin only        (list all in org)
//   POST   /api/employees       → admin only        (create employee)
//   GET    /api/employees/:id   → admin OR owner    (view profile)
//   PUT    /api/employees/:id   → admin OR owner    (edit profile)
//   DELETE /api/employees/:id   → admin only        (soft-delete / deactivate)
//
// Auth chain (applied per-route, not via router.use):
//   authMiddleware              — verifies JWT, populates req.user
//   authorize(['ADMIN'])        — role gate: ADMIN only
//   authorizeOwnerOrAdmin()     — role gate: ADMIN OR employeeId === :id
//
// Org scoping:
//   authorizeOwnerOrAdmin enforces identity only ("is this your record?").
//   Every controller MUST also apply WHERE orgId = req.user.orgId on its
//   DB query — that is the actual tenant boundary.
// =============================================================================

import { Router } from 'express';
import { authMiddleware, authorize, authorizeOwnerOrAdmin } from '../middleware/auth';
import {
    createEmployeeHandler,
    listEmployeesHandler,
    getEmployeeHandler,
    updateEmployeeHandler,
    deactivateEmployeeHandler,
} from '../controllers/employee.controller';

const router = Router();

// ── Admin only ────────────────────────────────────────────────────────────────
router.get('/',    authMiddleware, authorize(['ADMIN']),    listEmployeesHandler);
router.post('/',   authMiddleware, authorize(['ADMIN']),    createEmployeeHandler);
router.delete('/:id', authMiddleware, authorize(['ADMIN']), deactivateEmployeeHandler);

// ── Admin OR record owner ─────────────────────────────────────────────────────
router.get('/:id', authMiddleware, authorizeOwnerOrAdmin(), getEmployeeHandler);
router.put('/:id', authMiddleware, authorizeOwnerOrAdmin(), updateEmployeeHandler);

export default router;
