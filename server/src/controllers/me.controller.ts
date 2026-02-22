// =============================================================================
// Me controller — returns the authenticated user + org identity.
//
// The org is looked up directly from the Organization table using orgId from
// the JWT.  The employee profile (name) is looked up only when the user has
// a linked employeeId — ADMIN users created at registration have no Employee
// profile and get an empty name gracefully.
// =============================================================================

import { Response } from 'express';
import { AuthRequest } from '../types';
import { sendSuccess } from '../utils/response';
import prisma from '../lib/prisma';

export async function getMe(req: AuthRequest, res: Response): Promise<void> {
    const user = req.user!;

    // Fetch org name directly — guaranteed to exist (FK from JWT's orgId).
    const org = await (prisma.organization as any).findUnique({
        where: { id: user.orgId },
        select: { id: true, name: true },
    });

    // Fetch employee name only if this user has a linked Employee profile.
    // ADMINs created at registration have employeeId = null — handle gracefully.
    let employeeName = '';
    if (user.employeeId) {
        const employee = await (prisma.employee as any).findUnique({
            where: { id: user.employeeId },
            select: { name: true },
        });
        employeeName = employee?.name ?? '';
    }

    sendSuccess(res, {
        user: {
            id:         user.id,
            email:      user.email,
            role:       user.role,
            employeeId: user.employeeId,
            name:       employeeName,
        },
        org: org ?? { id: user.orgId, name: 'Workspace' },
    });
}
