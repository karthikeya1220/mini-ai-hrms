// =============================================================================
// Me route — GET /api/me
//
// Protected: requires a valid JWT access token.
// Returns the org identity extracted from the token — not from the database.
//
// Use cases:
//   - Client page-load check: "is my stored access token still valid?"
//   - Confirm the orgId the frontend should use for all subsequent requests.
//
// authMiddleware is applied at the router level (router.use) rather than
// per-route so any future endpoints added to this file are automatically
// protected without manual decoration.
// =============================================================================

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getMe } from '../controllers/me.controller';

const router = Router();

// All routes on this router require a valid JWT.
router.use(authMiddleware);

router.get('/', getMe);

export default router;
