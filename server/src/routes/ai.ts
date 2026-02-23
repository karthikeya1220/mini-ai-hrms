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
    geminiSkillGapHandler,
    geminiRecommendHandler,
    geminiTrendHandler,
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

// ── GET /api/ai/gemini/skill-gap/:employeeId ──────────────────────────────────
// Gemini-powered skill gap detection — LLM reasoning on top of peer task data.
// ADMIN OR the employee themselves. 503 when GEMINI_API_KEY is unset.
router.get('/gemini/skill-gap/:employeeId',
    authMiddleware,
    authorizeOwnerOrAdmin('employeeId'),
    geminiSkillGapHandler,
);

// ── GET /api/ai/gemini/recommend/:taskId ──────────────────────────────────────
// Gemini-powered single-best-employee recommendation for a task.
// ADMIN only — exposes all active employee profiles + scores.
// 503 when GEMINI_API_KEY is unset; use /recommend/:taskId as deterministic fallback.
router.get('/gemini/recommend/:taskId',
    authMiddleware,
    authorize(['ADMIN']),
    geminiRecommendHandler,
);

// ── GET /api/ai/gemini/trend/:employeeId ──────────────────────────────────────
// Gemini-powered 30-day trend prediction with confidence % and explanation.
// ADMIN OR the employee themselves. 503 when GEMINI_API_KEY is unset.
// Deterministic fallback: GET /score/:employeeId exposes trendAnalysis.
router.get('/gemini/trend/:employeeId',
    authMiddleware,
    authorizeOwnerOrAdmin('employeeId'),
    geminiTrendHandler,
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
