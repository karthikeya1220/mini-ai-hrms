// =============================================================================
// web3 routes — /api/web3/*
//
// SPEC § 2.5 (Blockchain Integration):
//   POST /api/web3/log  — record a blockchain tx hash for a completed task
//
// All routes require JWT — authMiddleware applied at router.use() level so
// any future endpoint added here is automatically protected.
// =============================================================================

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { logBlockchainEntryHandler } from '../controllers/web3.controller';

const router = Router();

// Enforce JWT on every route in this file.
router.use(authMiddleware);

router.post('/log', logBlockchainEntryHandler);

export default router;
