// =============================================================================
// Route index — registers all route groups on the Express app.
//
// SPEC § 2.4 route groups:
//   PUBLIC  (no JWT)  : /health  /api/auth
//   PROTECTED (JWT)   : /api/me  /api/employees  /api/tasks
//                       /api/dashboard  /api/ai  /api/web3
//
// Auth enforcement strategy:
//   Each protected router applies authMiddleware via router.use() inside its
//   own route file. Protection is enforced at the Router level, not per-route;
//   adding a new endpoint to any protected router cannot accidentally skip auth.
// =============================================================================

import { Express } from 'express';

// ── Real route modules ────────────────────────────────────────────────────────
import healthRouter from './health';      // public
import authRouter from './auth';        // public (register / login / refresh / logout)
import meRouter from './me';          // protected — GET /api/me          ✅
import employeeRouter from './employees';   // protected — /api/employees        ✅
import taskRouter from './tasks';       // protected — /api/tasks            ✅
import aiRouter from './ai';          // protected — /api/ai               ✅
import dashboardRouter from './dashboard';   // protected — /api/dashboard         ✅
import web3Router from './web3';        // protected — /api/web3             ✅

// ─────────────────────────────────────────────────────────────────────────────
export function registerRoutes(app: Express): void {
    // ── Public routes — no JWT required ──────────────────────────────────────
    app.use('/health', healthRouter);
    app.use('/api/auth', authRouter);

    // ── Protected routes — JWT enforced at router level ───────────────────────
    app.use('/api/me', meRouter);
    app.use('/api/employees', employeeRouter);
    app.use('/api/tasks', taskRouter);
    app.use('/api/dashboard', dashboardRouter);
    app.use('/api/ai', aiRouter);
    app.use('/api/web3', web3Router);
}
