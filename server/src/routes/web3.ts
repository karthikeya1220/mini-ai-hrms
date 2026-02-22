// =============================================================================
// web3 routes — /api/web3/*
//
// SPEC § 2.5 (Blockchain Integration):
//   POST /api/web3/log   — record a blockchain tx hash for a completed task
//   GET  /api/web3/logs  — retrieve blockchain audit log entries
//
// RBAC:
//   ┌──────────────────┬──────────────────────────────────────────────────────┐
//   │ Route            │ Gate                                                 │
//   ├──────────────────┼──────────────────────────────────────────────────────┤
//   │ POST /log        │ ADMIN OR assigned employee (checked in controller)   │
//   │ GET  /logs       │ all authenticated; controller filters by role        │
//   └──────────────────┴──────────────────────────────────────────────────────┘
//
// POST /log ownership:
//   No middleware gate — authMiddleware only. The controller passes
//   req.user.employeeId to the service when role === EMPLOYEE; the service
//   then enforces task.assignedTo === employeeId, returning 403 if not matched.
//   This mirrors the updateStatusHandler pattern: ownership lives in the
//   service because it requires a DB fetch (task row), not a param comparison.
//
// GET /logs filter:
//   The controller branches on req.user.role: ADMIN receives all org logs,
//   EMPLOYEE receives only logs for tasks assigned to them (service-level join).
// =============================================================================

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
    logBlockchainEntryHandler,
    listBlockchainLogsHandler,
} from '../controllers/web3.controller';

const router = Router();

// ── POST /api/web3/log ────────────────────────────────────────────────────────
// ADMIN OR assigned employee — ownership enforced in the service layer.
router.post('/log',  authMiddleware, logBlockchainEntryHandler);

// ── GET /api/web3/logs ────────────────────────────────────────────────────────
// All authenticated — role-based filter applied in the controller.
router.get('/logs',  authMiddleware, listBlockchainLogsHandler);

export default router;
