// =============================================================================
// AI routes — /api/ai/*
//
// SPEC § 2.4 AI Routes:
//   GET /api/ai/score/:employeeId      — productivity score + breakdown
//   GET /api/ai/recommend/:taskId      — top-3 employee recommendations for task
//   GET /api/ai/skill-gap/:employeeId  — skill gap analysis
//
// All routes require JWT — authMiddleware applied at router.use() level.
// This means any future AI endpoint added here is automatically protected.
// =============================================================================

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
    getScoreHandler,
    recommendHandler,
    skillGapHandler,
} from '../controllers/ai.controller';

const router = Router();

// Enforce JWT on every route in this file.
router.use(authMiddleware);

// ── Score ──────────────────────────────────────────────────────────────────
// GET /api/ai/score/:employeeId
// Returns: score (0-100), grade (A+/A/B/C/D), breakdown, trend, computedAt
router.get('/score/:employeeId', getScoreHandler);

// ── Recommend ──────────────────────────────────────────────────────────────
// GET /api/ai/recommend/:taskId
// Returns: ranked top-3 employees with skillOverlap, activeCount, perfScore
router.get('/recommend/:taskId', recommendHandler);

// ── Skill Gap ──────────────────────────────────────────────────────────────
// GET /api/ai/skill-gap/:employeeId
// Returns: currentSkills, requiredSkills, gapSkills, coverageRate
router.get('/skill-gap/:employeeId', skillGapHandler);

export default router;
