// =============================================================================
// Route index — registers all route groups on the Express app.
//
// SPEC § 2.4 route groups:
//   PUBLIC  (no JWT)  : /health  /api/auth
//   PROTECTED (JWT)   : /api/me  /api/employees  /api/tasks
//                       /api/dashboard  /api/ai  /api/web3
//
// Auth enforcement strategy:
//   Each protected router has authMiddleware applied via router.use() inside
//   its own route file (or, for stubs, inline below). This means:
//     - Protection is enforced at the Router level, not per-route.
//     - Adding a new endpoint to any protected router cannot accidentally skip auth.
//     - The stub routers below already enforce JWT even before their feature
//       modules are built — unauthenticated requests get 401, not 404.
// =============================================================================

import { Express, Router } from 'express';
import { authMiddleware } from '../middleware/auth';

// ── Real route modules ────────────────────────────────────────────────────────
import healthRouter from './health';     // public
import authRouter from './auth';       // public (register / login / refresh / logout)
import meRouter from './me';         // protected — GET /api/me          ✅
import employeeRouter from './employees';  // protected — /api/employees        ✅
import taskRouter from './tasks';      // protected — /api/tasks            ✅
import aiRouter from './ai';         // protected — /api/ai               ✅
import dashboardRouter from './dashboard'; // protected — /api/dashboard         ✅

// ── Protected stub routers ────────────────────────────────────────────────────
// Each stub immediately applies authMiddleware so every request to these
// prefixes returns 401 (not 404) until the real module is swapped in.
//
// To replace a stub with a real module:
//   1. Add: import xyzRouter from './xyz';
//   2. Remove the corresponding makeProtectedStub() line below.

function makeProtectedStub(label: string): Router {
    const router = Router();
    router.use(authMiddleware);
    router.use((_req, _res, next) => next());
    void label;
    return router;
}

const web3Router = makeProtectedStub('web3');       // → src/routes/web3.ts

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
