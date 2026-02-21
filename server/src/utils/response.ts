// =============================================================================
// Response helpers
//
// Centralise the SPEC-mandated response shapes so controllers never inline them.
// SPEC § 2.4 error format: { success, error, message, statusCode }
// =============================================================================

import { Response } from 'express';
import { ApiSuccess, ApiError } from '../types';

export function sendSuccess<T>(
    res: Response,
    data: T,
    statusCode = 200
): Response<ApiSuccess<T>> {
    return res.status(statusCode).json({ success: true, data });
}

export function sendError(
    res: Response,
    statusCode: number,
    error: string,
    message: string
): Response<ApiError> {
    return res.status(statusCode).json({ success: false, error, message, statusCode });
}
