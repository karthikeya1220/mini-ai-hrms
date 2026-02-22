// =============================================================================
// Auth middleware — validates JWT access token and populates req.org.
//
// SPEC § 1.3 (Fundamental Principles — Multi-Tenancy First):
//   "The orgId is extracted from the JWT on every authenticated request.
//    Clients NEVER pass an orgId in the request body."
//
// SPEC § Day 1, Hour 1–4:
//   "authMiddleware extracts orgId from JWT and attaches to req.org"
//
// Risk R7 (architecture analysis): org existence is NOT re-validated against
// the database on every request — this is a documented limitation. The JWT
// is trusted until expiry (1h). If real-time deactivation is needed, add a
// Redis revocation check here.
// =============================================================================

import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { sendError } from '../utils/response';
import { supabase } from '../lib/supabase';
import prisma from '../lib/prisma';

export async function authMiddleware(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        sendError(res, 401, 'UNAUTHORIZED', 'Missing or malformed Authorization header.');
        return;
    }

    const token = authHeader.slice(7);

    try {
        // ── 1. Verify with Supabase ───────────────────────────────────────────
        const { data: { user: sbUser }, error: sbError } = await supabase.auth.getUser(token);

        if (sbError || !sbUser) {
            sendError(res, 401, 'UNAUTHORIZED', 'Invalid session or token expired.');
            return;
        }

        // ── 2. Link to local Employee/Org ─────────────────────────────────────
        // We use email as the bridge. Employee table has (orgId, email) unique.
        // We find the employee regardless of org (since email is globally unique in Supabase).
        const employee = await (prisma.employee as any).findFirst({
            where: { email: sbUser.email, isActive: true },
            select: { id: true, orgId: true, role: true, email: true }
        });

        if (!employee) {
            sendError(res, 403, 'USER_NOT_SYNCED', 'Your account is recognized but not linked to any organization.');
            return;
        }

        req.user = {
            id: employee.id,
            orgId: employee.orgId,
            email: employee.email,
            role: employee.role as 'ADMIN' | 'EMPLOYEE',
        };

        next();
    } catch (err) {
        sendError(res, 401, 'UNAUTHORIZED', 'Authentication failed');
    }
}

/**
 * Authorization middleware — restricts access to specific roles.
 * Must be registered AFTER authMiddleware.
 */
export function authorize(roles: ('ADMIN' | 'EMPLOYEE')[]) {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
            return;
        }

        if (!roles.includes(req.user.role)) {
            sendError(
                res,
                403,
                'FORBIDDEN',
                `Insufficient permissions. Required: [${roles.join(', ')}]`
            );
            return;
        }

        next();
    };
}
