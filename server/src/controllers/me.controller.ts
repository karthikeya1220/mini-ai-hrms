// =============================================================================
// Me controller — returns the authenticated org's identity from req.org.
//
// This endpoint exists to:
//   1. Give the frontend a way to verify a stored access token is still valid
//      without re-logging in (e.g. on page load / tab focus).
//   2. Return the canonical orgId that all subsequent requests must use.
//
// SPEC invariant: orgId is NEVER sourced from the request body.
// Here it comes exclusively from req.org, which authMiddleware populates
// after verifying the JWT signature.
//
// req.org is typed as AuthenticatedOrg | undefined.
// The non-null assertion below is safe: this controller is only ever reached
// after authMiddleware, which either populates req.org or returns 401.
// =============================================================================

import { Response } from 'express';
import { AuthRequest } from '../types';
import { sendSuccess } from '../utils/response';

export function getMe(req: AuthRequest, res: Response): void {
    // req.org is guaranteed non-null here — authMiddleware runs before this handler.
    // If it were somehow undefined (misconfigured router), the type cast would throw
    // at runtime, which is the correct failure mode (loud, not silent).
    const org = req.org!;

    sendSuccess(res, {
        orgId: org.id,
        email: org.email,
    });
}
