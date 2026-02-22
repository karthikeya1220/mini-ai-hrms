// =============================================================================
// Me controller — returns the authenticated user + org identity.
//
// authMiddleware populates req.user from the Supabase token + local DB lookup.
// We then fetch the org name to return a complete profile.
// =============================================================================

import { Response } from 'express';
import { AuthRequest } from '../types';
import { sendSuccess } from '../utils/response';
import prisma from '../lib/prisma';

export async function getMe(req: AuthRequest, res: Response): Promise<void> {
    const user = req.user!;

    // Fetch employee name + org name in one query via relation
    const employee = await (prisma.employee as any).findUnique({
        where: { id: user.id },
        select: {
            name: true,
            organization: { select: { id: true, name: true } },
        },
    });

    sendSuccess(res, {
        user: {
            id:    user.id,
            name:  employee?.name ?? '',
            email: user.email,
            role:  user.role,
        },
        org: employee?.organization ?? { id: user.orgId, name: 'Workspace' },
    });
}
