// =============================================================================
// Employee routes — /api/employees/*
//
// SPEC § 2.4:
//   GET    /api/employees       — list, paginated, filterable by dept/role
//   POST   /api/employees       — create employee
//   GET    /api/employees/:id   — get by ID
//   PUT    /api/employees/:id   — update profile
//   DELETE /api/employees/:id   — soft-delete (set isActive = false)
//
// All routes require JWT — authMiddleware applied at router.use() level.
// =============================================================================

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
    createEmployeeHandler,
    listEmployeesHandler,
    getEmployeeHandler,
    updateEmployeeHandler,
    deactivateEmployeeHandler,
} from '../controllers/employee.controller';

const router = Router();

// Enforce JWT on every route in this file — cannot be bypassed per-route.
router.use(authMiddleware);

router.get('/', listEmployeesHandler);
router.post('/', createEmployeeHandler);
router.get('/:id', getEmployeeHandler);
router.put('/:id', updateEmployeeHandler);
router.delete('/:id', deactivateEmployeeHandler);

export default router;
