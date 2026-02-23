// =============================================================================
// AI routes — /api/ai/*
//
// SPEC § 2.4 AI Routes:
//   GET /api/ai/score/:employeeId      — productivity score + breakdown
//   GET /api/ai/recommend/:taskId      — top-3 employee recommendations for task
//   GET /api/ai/skill-gap/:employeeId  — skill gap analysis
//
// RBAC:
//   ┌──────────────────────────────┬────────────────────────────────────────────┐
//   │ Route                        │ Gate                                       │
//   ├──────────────────────────────┼────────────────────────────────────────────┤
//   │ GET /score/:employeeId       │ ADMIN OR req.user.employeeId === :employeeId│
//   │ GET /recommend/:taskId       │ ADMIN only                                 │
//   │ GET /skill-gap/:employeeId   │ ADMIN OR req.user.employeeId === :employeeId│
//   └──────────────────────────────┴────────────────────────────────────────────┘
//
// authorizeOwnerOrAdmin('employeeId') is passed 'employeeId' (not the default
// 'id') because these routes use :employeeId as the param name.
//
// Org scoping: all three service functions receive orgId from req.user.orgId
// and apply it as a WHERE clause before returning any data — a valid
// :employeeId from another org returns 404, not that org's data.
// =============================================================================

import { Router } from 'express';
import { authMiddleware, authorize, authorizeOwnerOrAdmin } from '../middleware/auth';
import {
    getScoreHandler,
    recommendHandler,
    skillGapHandler,
} from '../controllers/ai.controller';
import { analyzeHandler } from '../controllers/gemini.controller';

const router = Router();

// ── GET /api/ai/score/:employeeId ─────────────────────────────────────────────
// ADMIN sees any employee's score; EMPLOYEE sees only their own.
router.get('/score/:employeeId',
    authMiddleware,
    authorizeOwnerOrAdmin('employeeId'),
    getScoreHandler,
);

// ── GET /api/ai/recommend/:taskId ─────────────────────────────────────────────
// Admin only — recommendation data includes all active employees + their scores.
router.get('/recommend/:taskId',
    authMiddleware,
    authorize(['ADMIN']),
    recommendHandler,
);

// ── GET /api/ai/skill-gap/:employeeId ────────────────────────────────────────
// ADMIN sees any employee's gaps; EMPLOYEE sees only their own.
router.get('/skill-gap/:employeeId',
    authMiddleware,
    authorizeOwnerOrAdmin('employeeId'),
    skillGapHandler,
);

// ── POST /api/ai/analyze ──────────────────────────────────────────────────────
// Gemini-powered narrative analysis. Body: { type, employeeId }
// ADMIN only — analysis may reveal cross-employee comparative data.
router.post('/analyze',
    authMiddleware,
    authorize(['ADMIN']),
    analyzeHandler,
);

export default router;
