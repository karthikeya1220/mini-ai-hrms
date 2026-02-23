// =============================================================================
// Me controller — returns the authenticated user + org identity.
//
// The org is looked up directly from the Organization table using orgId from
// the JWT.  The employee profile (name) is looked up only when the user has
// a linked employeeId — ADMIN users created at registration have no Employee
// profile and get an empty name gracefully.
//
// Org-scope enforcement:
//   The employee lookup uses findFirst({ where: { id, orgId } }) rather than
//   findUnique({ where: { id } }).  Although users.employee_id is unique (so
//   a plain findUnique would not cross tenants in practice), the compound
//   where clause is a defence-in-depth guard: if the JWT were somehow forged
//   with a foreign employeeId, the orgId check prevents the read from
//   returning data from another tenant.
// =============================================================================

import { Response } from 'express';
import { AuthRequest } from '../types';
import { sendSuccess } from '../utils/response';
import prisma from '../lib/prisma';

export async function getMe(req: AuthRequest, res: Response): Promise<void> {
    const user = req.user!;

    // Fire all three queries in parallel — all are independent.
    // email is no longer embedded in the JWT (PII minimization); we fetch it
    // from the DB here, the one place that actually needs it for the client.
    // The employee query resolves to null immediately when employeeId is absent,
    // so Promise.all never blocks on a no-op branch.
    const [org, employee, dbUser] = await Promise.all([
        prisma.organization.findFirst({
            where:  { id: user.orgId },
            select: { id: true, name: true },
        }),
        user.employeeId
            ? prisma.employee.findFirst({
                  where:  { id: user.employeeId, orgId: user.orgId }, // org-scoped — cross-tenant guard
                  select: { name: true },
              })
            : Promise.resolve(null),
        prisma.user.findFirst({
            where:  { id: user.id, orgId: user.orgId },
            select: { email: true },
        }),
    ]);

    sendSuccess(res, {
        user: {
            id:         user.id,
            email:      dbUser?.email ?? '',
            role:       user.role,
            employeeId: user.employeeId,
            name:       employee?.name ?? '',
        },
        org: org ?? { id: user.orgId, name: 'Workspace' },
    });
}
