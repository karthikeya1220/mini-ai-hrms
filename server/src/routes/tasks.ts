// =============================================================================
// Task routes — /api/tasks/*
//
// SPEC § 2.4 Task Routes:
//   GET    /api/tasks           → all authenticated; controller filters by role
//   POST   /api/tasks           → admin only        (create task)
//   GET    /api/tasks/:id       → all authenticated (org-scoped in service)
//   PUT    /api/tasks/:id       → admin only        (full field update)
//   PUT    /api/tasks/:id/status → admin OR assigned employee (FSM transition)
//   DELETE /api/tasks/:id       → admin only        (hard delete)
//
// Role enforcement strategy:
//   ┌──────────────────────────┬──────────────────────────────────────────────┐
//   │ Route                    │ Gate                                         │
//   ├──────────────────────────┼──────────────────────────────────────────────┤
//   │ GET  /                   │ authMiddleware only — controller branches    │
//   │ POST /                   │ authorize(['ADMIN'])                         │
//   │ GET  /:id                │ authMiddleware only — service org-scopes     │
//   │ PUT  /:id                │ authorize(['ADMIN'])                         │
//   │ PUT  /:id/status         │ authMiddleware only — controller owns check  │
//   │ DELETE /:id              │ authorize(['ADMIN'])                         │
//   └──────────────────────────┴──────────────────────────────────────────────┘
//
// Note on PUT /:id/status ownership:
//   The task's assignedTo field is in the DB, not in req.params.  The
//   authorizeOwnerOrAdmin middleware cannot perform this check without a DB
//   call.  The updateStatusHandler fetches the task first and enforces
//   ownership inline before delegating to the service — no duplicate fetch.
//
// Route ordering:
//   /:id/status is registered before /:id to prevent Express matching
//   the literal string "status" as a task UUID.
// =============================================================================

import { Router } from 'express';
import { authMiddleware, authorize } from '../middleware/auth';
import {
    createTaskHandler,
    listTasksHandler,
    getTaskHandler,
    updateTaskHandler,
    updateStatusHandler,
    deleteTaskHandler,
} from '../controllers/task.controller';

const router = Router();

// ── All authenticated ─────────────────────────────────────────────────────────
// listTasksHandler branches internally: ADMIN sees all, EMPLOYEE sees own.
router.get('/',    authMiddleware, listTasksHandler);
router.get('/:id', authMiddleware, getTaskHandler);

// ── Admin OR assigned employee — ownership checked in controller ──────────────
// Registered before PUT /:id so Express does not capture the literal "status"
// as a task UUID value for the :id param.
router.put('/:id/status', authMiddleware, updateStatusHandler);

// ── Admin only ────────────────────────────────────────────────────────────────
router.post('/',      authMiddleware, authorize(['ADMIN']), createTaskHandler);
router.put('/:id',    authMiddleware, authorize(['ADMIN']), updateTaskHandler);
router.delete('/:id', authMiddleware, authorize(['ADMIN']), deleteTaskHandler);

export default router;
