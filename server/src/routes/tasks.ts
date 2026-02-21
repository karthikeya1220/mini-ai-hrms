// =============================================================================
// Task routes — /api/tasks/*
//
// SPEC § 2.4:
//   GET  /api/tasks             — list, filtered, paginated
//   POST /api/tasks             — create task
//   GET  /api/tasks/:id         — get by ID
//   PUT  /api/tasks/:id/status  — transition status (FSM-guarded)
//
// All routes require JWT — authMiddleware applied at router.use() level.
// The /:id/status route is intentionally specific to avoid collisions with
// future PUT /api/tasks/:id (full update) additions.
// =============================================================================

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
    createTaskHandler,
    listTasksHandler,
    getTaskHandler,
    updateStatusHandler,
} from '../controllers/task.controller';

const router = Router();

// Enforce JWT on every route in this file.
router.use(authMiddleware);

router.get('/', listTasksHandler);
router.post('/', createTaskHandler);
router.get('/:id', getTaskHandler);
router.put('/:id/status', updateStatusHandler);

export default router;
