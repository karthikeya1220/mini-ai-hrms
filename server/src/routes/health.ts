// =============================================================================
// Health check route
//
// GET /health — public, no auth required.
// Returns server status, environment, and timestamp.
// Used by Railway health checks and smoke tests listed in SPEC § Hour 25–27.
// =============================================================================

import { Router, Request, Response } from 'express';
import { sendSuccess } from '../utils/response';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
    sendSuccess(res, {
        status: 'ok',
        environment: process.env.NODE_ENV ?? 'unknown',
        timestamp: new Date().toISOString(),
    });
});

export default router;
