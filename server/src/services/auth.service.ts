// =============================================================================
// Auth service — business logic for register, login.
// Auth is now maintained at Supabase.
// =============================================================================

import { supabase } from '../lib/supabase';
import prisma from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';

export interface RegisterInput {
    name: string;
    email: string;
    password: string;
}

export interface AuthResult {
    accessToken: string;
    refreshToken: string;
    user: { id: string; name: string; email: string; role: string };
    org: { id: string; name: string };
}

/**
 * Create a new organization (tenant) account via Supabase.
 */
export async function registerOrg(input: RegisterInput): Promise<AuthResult> {
    const { name, email, password } = input;

    // 1. Sign up with Supabase
    const { data: sb, error: sbError } = await supabase.auth.signUp({
        email,
        password,
    });

    if (sbError) {
        throw new AppError(400, 'AUTH_FAILED', sbError.message);
    }

    if (!sb.user || !sb.session) {
        throw new AppError(400, 'CONFIRMATION_REQUIRED', 'Please check your email to confirm your account.');
    }

    // 2. Create local records
    try {
        return await prisma.$transaction(async (tx) => {
            const org = await tx.organization.create({
                data: { name, email, passwordHash: 'SUPABASE' },
                select: { id: true, name: true },
            });

            const admin = await (tx.employee as any).create({
                data: {
                    orgId: org.id,
                    name: 'System Admin',
                    email,
                    passwordHash: 'SUPABASE',
                    role: 'ADMIN',
                },
                select: { id: true, name: true, email: true, role: true },
            });

            return {
                accessToken: sb.session!.access_token,
                refreshToken: sb.session!.refresh_token,
                user: { ...admin, role: admin.role as string },
                org,
            };
        });
    } catch (err: any) {
        if (err.code === 'P2002') {
            throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'Email is already registered in our system.');
        }
        throw err;
    }
}

/**
 * Authenticate via Supabase.
 */
export async function loginOrg(input: { email: string; password: string }): Promise<AuthResult> {
    const { email, password } = input;

    // 1. Sign in with Supabase
    const { data: sb, error: sbError } = await supabase.auth.signInWithPassword({
        email,
        password,
    });

    if (sbError) {
        throw new AppError(401, 'INVALID_CREDENTIALS', sbError.message);
    }

    // 2. Fetch local profile
    const employee = await (prisma.employee as any).findFirst({
        where: { email, isActive: true },
        select: {
            id: true,
            orgId: true,
            name: true,
            email: true,
            role: true,
            organization: { select: { id: true, name: true } },
        },
    });

    if (!employee) {
        throw new AppError(403, 'USER_NOT_SYNCED', 'Account exists but is not linked to any organization.');
    }

    return {
        accessToken: sb.session!.access_token,
        refreshToken: sb.session!.refresh_token,
        user: {
            id: employee.id,
            name: employee.name,
            email: employee.email,
            role: employee.role as string,
        },
        org: employee.organization,
    };
}

/**
 * Structural compatibility
 */
export async function refreshAccessToken(_refreshToken: string): Promise<{ accessToken: string }> {
    throw new AppError(501, 'NOT_IMPLEMENTED', 'Use Supabase SDK to refresh tokens.');
}

export async function logoutOrg(_refreshToken: string): Promise<void> {
    // Structural compatibility
}
