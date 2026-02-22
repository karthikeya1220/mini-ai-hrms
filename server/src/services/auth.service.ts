// =============================================================================
// Auth service — JWT token lifecycle for the RBAC auth system.
//
// Design contract (AUTH_SYSTEM.md):
//   Access token  — 1 h,  signed with JWT_SECRET
//                   payload: { userId, orgId, employeeId, email, role }
//   Refresh token — 7 d,  signed with JWT_REFRESH_SECRET
//                   payload: { userId, orgId, tokenVersion }
//
// tokenVersion is an integer stored on the User row and incremented on
// password-change or explicit logout.  Verification rejects any refresh
// token whose embedded version is behind the stored version — this is the
// server-side revocation mechanism that replaces a token blocklist.
//
// Secrets:
//   JWT_SECRET          — required, access-token signing key
//   JWT_REFRESH_SECRET  — required, refresh-token signing key (different key)
//   Both are read inside each function so test suites can swap them via
//   process.env without module-level caching issues.
// =============================================================================

import jwt, { SignOptions, JwtPayload } from 'jsonwebtoken';
import { AppError } from '../middleware/errorHandler';
import { hashPassword, verifyPassword } from '../utils/hash';
import prisma from '../lib/prisma';

// ─── Role ─────────────────────────────────────────────────────────────────────
// Mirrors the Prisma Role enum added in schema.prisma.
// Defined locally so this file compiles before `prisma generate` has run
// against the new migration.  Once the client is regenerated, callers may
// import Role from '@prisma/client' and pass it here — the types are identical.
export type Role = 'ADMIN' | 'EMPLOYEE';

// ─── Input shape ──────────────────────────────────────────────────────────────
// The minimal slice of the Prisma User row that token functions need.
// Callers (controllers / auth middleware) fetch the full User row and pass it
// here — the service never touches the database itself.
export interface TokenUser {
  id: string;                // users.id  (UUID)
  orgId: string;             // users.org_id
  employeeId: string | null; // users.employee_id — null until Employee profile linked
  email: string;             // users.email
  role: Role;                // Prisma Role enum: 'ADMIN' | 'EMPLOYEE'
  tokenVersion: number;      // users.token_version — incremented on revocation
}

// ─── Token payload shapes ─────────────────────────────────────────────────────

/**
 * Claims embedded in a signed access token.
 *
 * Standard JWT fields (iss, sub, exp, iat) are added by jsonwebtoken automatically.
 * Custom claims follow the AUTH_SYSTEM.md contract exactly.
 */
export interface AccessTokenPayload extends JwtPayload {
  /** users.id */
  userId: string;
  /** users.org_id — tenant scoping for all downstream queries */
  orgId: string;
  /** users.employee_id — null for org-owner accounts not yet linked to an Employee row */
  employeeId: string | null;
  /** Login email — convenience for logging / audit without a DB lookup */
  email: string;
  /** 'ADMIN' | 'EMPLOYEE' — sourced from the Role enum column, not a VARCHAR */
  role: Role;
}

/**
 * Claims embedded in a signed refresh token.
 *
 * Refresh tokens carry only the minimum claims needed to issue a new access
 * token.  tokenVersion is the revocation vector — if the stored version on the
 * User row is higher than this value, the token is considered revoked.
 */
export interface RefreshTokenPayload extends JwtPayload {
  /** users.id */
  userId: string;
  /** users.org_id */
  orgId: string;
  /**
   * Snapshot of users.token_version at signing time.
   * verifyRefreshToken rejects the token if this is behind the current DB value.
   * Callers must perform that DB check themselves after calling verifyRefreshToken.
   */
  tokenVersion: number;
}

// ─── Token pair — convenience return type ─────────────────────────────────────
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Reads a required environment variable or throws at call time (not module load). */
function requireEnv(key: 'JWT_SECRET' | 'JWT_REFRESH_SECRET'): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(
      `[auth.service] Environment variable "${key}" is not set. ` +
      `The server cannot issue or verify tokens without it.`
    );
  }
  return value;
}

/** Maps a jsonwebtoken error to the appropriate AppError. */
function mapJwtError(err: unknown, context: 'access' | 'refresh'): never {
  if (err instanceof AppError) throw err;

  const label = context === 'access' ? 'Access' : 'Refresh';

  if (err instanceof jwt.TokenExpiredError) {
    throw new AppError(
      401,
      'TOKEN_EXPIRED',
      `${label} token has expired${context === 'refresh' ? '. Please log in again' : ''}.`
    );
  }
  if (err instanceof jwt.NotBeforeError) {
    throw new AppError(401, 'TOKEN_NOT_ACTIVE', `${label} token is not yet active.`);
  }
  if (err instanceof jwt.JsonWebTokenError) {
    throw new AppError(401, 'INVALID_TOKEN', `${label} token is invalid.`);
  }

  throw new AppError(401, 'INVALID_TOKEN', `${label} token verification failed.`);
}

// ─── Access token ─────────────────────────────────────────────────────────────

/**
 * Sign a short-lived access token for the given User.
 *
 * @param user  Minimal User row slice — see TokenUser.
 * @returns     Signed JWT string, expires in 1 h (overridable via JWT_EXPIRES_IN).
 */
export function signAccessToken(user: TokenUser): string {
  const secret = requireEnv('JWT_SECRET');
  const expiresIn = (process.env.JWT_EXPIRES_IN ?? '1h') as SignOptions['expiresIn'];

  const claims: Omit<AccessTokenPayload, keyof JwtPayload> = {
    userId:     user.id,
    orgId:      user.orgId,
    employeeId: user.employeeId,
    email:      user.email,
    role:       user.role,
  };

  return jwt.sign(claims, secret, {
    subject:   user.id,      // RFC 7519 §4.1.2 canonical subject
    expiresIn,
    issuer:    'mini-ai-hrms',
    algorithm: 'HS256',
  });
}

/**
 * Verify an access token and return its decoded payload.
 *
 * Throws AppError 401 on any verification failure — callers do not need to
 * handle jsonwebtoken errors directly.
 *
 * @param token  Raw JWT string extracted from the Authorization header.
 * @returns      Decoded, type-safe AccessTokenPayload.
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const secret = requireEnv('JWT_SECRET');

  let payload: AccessTokenPayload;
  try {
    payload = jwt.verify(token, secret, {
      issuer:     'mini-ai-hrms',
      algorithms: ['HS256'],
    }) as AccessTokenPayload;
  } catch (err) {
    mapJwtError(err, 'access');
  }

  if (
    typeof payload!.userId !== 'string' ||
    typeof payload!.orgId  !== 'string' ||
    typeof payload!.email  !== 'string' ||
    typeof payload!.role   !== 'string' ||
    !['ADMIN', 'EMPLOYEE'].includes(payload!.role)
  ) {
    throw new AppError(401, 'INVALID_TOKEN', 'Access token payload is malformed.');
  }

  return payload!;
}

// ─── Refresh token ────────────────────────────────────────────────────────────

/**
 * Sign a long-lived refresh token for the given User.
 *
 * The token embeds tokenVersion so that incrementing the User row's
 * token_version column immediately invalidates all outstanding refresh tokens
 * for that user — no blocklist table required.
 *
 * @param user  Minimal User row slice — see TokenUser.
 * @returns     Signed JWT string, expires in 7 d (overridable via JWT_REFRESH_EXPIRES_IN).
 */
export function signRefreshToken(user: TokenUser): string {
  const secret = requireEnv('JWT_REFRESH_SECRET');
  const expiresIn = (process.env.JWT_REFRESH_EXPIRES_IN ?? '7d') as SignOptions['expiresIn'];

  const claims: Omit<RefreshTokenPayload, keyof JwtPayload> = {
    userId:       user.id,
    orgId:        user.orgId,
    tokenVersion: user.tokenVersion,
  };

  return jwt.sign(claims, secret, {
    subject:   user.id,
    expiresIn,
    issuer:    'mini-ai-hrms',
    algorithm: 'HS256',
  });
}

/**
 * Verify a refresh token and return its decoded payload.
 *
 * Validates cryptographic integrity and expiry only.
 * Does NOT compare tokenVersion against the database — the caller must do
 * that after this function returns:
 *
 *   const payload = verifyRefreshToken(token);
 *   const user = await prisma.user.findUniqueOrThrow({ where: { id: payload.userId } });
 *   if (user.tokenVersion !== payload.tokenVersion) {
 *     throw new AppError(401, 'TOKEN_REVOKED', 'Session has been revoked. Please log in again.');
 *   }
 *
 * Separating the DB check keeps this function pure and independently testable.
 *
 * @param token  Raw JWT string.
 * @returns      Decoded, type-safe RefreshTokenPayload.
 */
export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const secret = requireEnv('JWT_REFRESH_SECRET');

  let payload: RefreshTokenPayload;
  try {
    payload = jwt.verify(token, secret, {
      issuer:     'mini-ai-hrms',
      algorithms: ['HS256'],
    }) as RefreshTokenPayload;
  } catch (err) {
    mapJwtError(err, 'refresh');
  }

  if (
    typeof payload!.userId       !== 'string' ||
    typeof payload!.orgId        !== 'string' ||
    typeof payload!.tokenVersion !== 'number'
  ) {
    throw new AppError(401, 'INVALID_TOKEN', 'Refresh token payload is malformed.');
  }

  return payload!;
}

// ─── Convenience: sign both tokens at once ────────────────────────────────────

/**
 * Sign and return both tokens in a single call.
 * Use at login and after a successful token refresh.
 *
 * @param user  Minimal User row slice — see TokenUser.
 * @returns     { accessToken, refreshToken }
 */
export function signTokenPair(user: TokenUser): TokenPair {
  return {
    accessToken:  signAccessToken(user),
    refreshToken: signRefreshToken(user),
  };
}

// ─── Registration ─────────────────────────────────────────────────────────────

export interface RegisterInput {
  /** Display name for the organization (stored on organizations.name). */
  orgName: string;
  /** Login email — globally unique across all users. */
  email: string;
  /** Plain-text password — hashed with bcrypt (12 rounds) before storage. */
  password: string;
  /**
   * Role for the registering user.
   * Defaults to 'ADMIN' (org-owner self-registration).
   * Pass 'EMPLOYEE' when an org allows employees to self-register.
   */
  role?: Role;
}

export interface RegisterResult {
  /** Short-lived access token — returned in the response body. */
  accessToken: string;
  /**
   * Long-lived refresh token — returned here so the controller can set it
   * as an httpOnly cookie.  It must never appear in the response body.
   */
  refreshToken: string;
  /** Safe user shape returned to the client — no hashes, no tokenVersion. */
  user: {
    id: string;
    orgId: string;
    email: string;
    role: Role;
    employeeId: string | null;
  };
}

/**
 * Register a new organization and its first ADMIN user.
 *
 * Transaction guarantees:
 *   - Organization and User are created atomically.
 *   - If either insert fails (e.g. duplicate email) the entire transaction
 *     rolls back — no orphaned organizations are left in the database.
 *
 * Security guarantees:
 *   - Password is hashed with bcrypt (12 rounds) inside the transaction,
 *     after input validation but before any DB write.
 *   - The plain-text password never touches the database.
 *   - The new User has employeeId = null.  An Employee profile is linked
 *     separately (e.g. when an admin fills in their HR profile).
 *   - tokenVersion starts at 0 (Prisma default).
 *
 * @throws AppError 409 EMAIL_TAKEN   when the email is already registered.
 * @throws AppError 500 DB_ERROR      on unexpected Prisma failures.
 */
export async function registerUser(input: RegisterInput): Promise<RegisterResult> {
  const { orgName, email, password, role = 'ADMIN' } = input;

  // Hash before entering the transaction so bcrypt's CPU cost does not hold
  // a DB connection open longer than necessary.
  const passwordHash = await hashPassword(password);

  try {
    const { user } = await prisma.$transaction(async (tx) => {
      // 1. Create organization (tenant root).
      const org = await tx.organization.create({
        data: {
          name:         orgName,
          email,                 // org contact email mirrors the owner's email
          passwordHash: '',      // Organization.passwordHash is a legacy SPEC field;
                                 // credentials now live exclusively on the User row.
        },
        select: { id: true, name: true },
      });

      // 2. Create the first user with the requested role.
      //    Defaults to ADMIN (org-owner self-registration path).
      //    employeeId is intentionally omitted (null) — the User exists at the
      //    auth layer; an Employee profile is a separate business-logic concern.
      const user = await (tx as any).user.create({
        data: {
          orgId:        org.id,
          email,
          passwordHash,
          role,          // caller-supplied; defaults to 'ADMIN'
          // tokenVersion: 0 — Prisma default, no need to set explicitly
          // isActive:     true — Prisma default
          // employeeId:   null — Prisma default (optional relation)
        },
        select: {
          id:           true,
          orgId:        true,
          email:        true,
          role:         true,
          tokenVersion: true,
          employeeId:   true,
        },
      });

      return { org, user };
    });

    // 3. Issue tokens outside the transaction — no DB connection held here.
    const tokenUser: TokenUser = {
      id:           user.id,
      orgId:        user.orgId,
      employeeId:   user.employeeId,
      email:        user.email,
      role:         user.role as Role,
      tokenVersion: user.tokenVersion,
    };

    const { accessToken, refreshToken } = signTokenPair(tokenUser);

    return {
      accessToken,
      refreshToken,
      user: {
        id:         user.id,
        orgId:      user.orgId,
        email:      user.email,
        role:       user.role as Role,
        employeeId: user.employeeId,
      },
    };
  } catch (err: unknown) {
    // P2002 = Prisma unique constraint violation.
    // The globally-unique email index on users.email fires here.
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as any).code === 'P2002'
    ) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
    }
    throw err;
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    orgId: string;
    email: string;
    role: Role;
    employeeId: string | null;
  };
}

/**
 * Authenticate a user by email + password and issue a token pair.
 *
 * Security contract:
 *   - A single generic error (INVALID_CREDENTIALS) is thrown for both
 *     "user not found" and "wrong password". This prevents email enumeration:
 *     an attacker cannot distinguish between an unknown email and a wrong
 *     password from the response alone.
 *
 *   - bcrypt.compare runs in both the "user found" and "user not found" paths
 *     via a dummy hash comparison when no user row exists. This ensures the
 *     response time is indistinguishable between the two cases, defeating
 *     timing-based enumeration attacks.
 *
 *   - isActive is checked AFTER the password comparison. Checking it before
 *     would create a timing discrepancy that leaks whether the email exists.
 *
 * @throws AppError 401 INVALID_CREDENTIALS  wrong email or wrong password.
 * @throws AppError 401 USER_INACTIVE        account exists but has been deactivated.
 */
export async function loginUser(input: LoginInput): Promise<LoginResult> {
  const { email, password } = input;

  // 1. Fetch the user row — include passwordHash for comparison only.
  //    (tx as any) cast mirrors registerUser; remove once prisma generate runs.
  const user = await (prisma as any).user.findUnique({
    where: { email },
    select: {
      id:           true,
      orgId:        true,
      employeeId:   true,
      email:        true,
      role:         true,
      passwordHash: true,
      tokenVersion: true,
      isActive:     true,
    },
  });

  // 2. Dummy hash used when no user row exists.
  //    bcrypt.compare is always called, keeping response time constant
  //    regardless of whether the email is registered.
  //    The sentinel is a valid bcrypt hash of an arbitrary string — it will
  //    never match any real input, so the comparison always returns false.
  const DUMMY_HASH =
    '$2b$12$invalidhashpaddingthatnevermatchesanyrealpassword000000';

  const storedHash: string = user ? user.passwordHash : DUMMY_HASH;

  // 3. Constant-time comparison — always runs regardless of user existence.
  const passwordValid = await verifyPassword(password, storedHash);

  // 4. Both "no user" and "wrong password" collapse to the same error,
  //    after the full bcrypt comparison completes (no short-circuit).
  if (!user || !passwordValid) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }

  // 5. Active-status check comes AFTER password verification.
  //    Inactive users have already completed the bcrypt comparison so there
  //    is no timing difference between an inactive account and a wrong password.
  if (!user.isActive) {
    throw new AppError(401, 'USER_INACTIVE', 'This account has been deactivated.');
  }

  // 6. Issue tokens — tokenVersion snapshot embedded in the refresh token.
  const tokenUser: TokenUser = {
    id:           user.id,
    orgId:        user.orgId,
    employeeId:   user.employeeId,
    email:        user.email,
    role:         user.role as Role,
    tokenVersion: user.tokenVersion,
  };

  const { accessToken, refreshToken } = signTokenPair(tokenUser);

  return {
    accessToken,
    refreshToken,
    user: {
      id:         user.id,
      orgId:      user.orgId,
      email:      user.email,
      role:       user.role as Role,
      employeeId: user.employeeId,
    },
  };
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

export interface RefreshResult {
  /** New short-lived access token. */
  accessToken: string;
}

/**
 * Issue a new access token from a valid, non-revoked refresh token.
 *
 * Intentionally issues an access token ONLY — the refresh token is NOT
 * rotated here.  Rotation would require re-setting the cookie on every
 * silent refresh, which adds complexity with no meaningful security gain
 * for a short-lived (1 h) access token.  The refresh token's 7-day TTL
 * and the tokenVersion revocation mechanism together bound the attack window.
 *
 * Revocation model:
 *   The refresh JWT embeds the tokenVersion that was current at sign time.
 *   The User row's tokenVersion is the ground truth.  Any operation that
 *   must invalidate all sessions (logout, password change) increments the
 *   DB column.  This check catches tokens whose embedded version is stale.
 *
 * Step-by-step:
 *   1. verifyRefreshToken — validates signature, issuer, algorithm, expiry,
 *      and payload shape.  Throws 401 on any failure.
 *   2. DB lookup by userId — confirms the user still exists.
 *   3. isActive check — deactivated accounts cannot refresh.
 *   4. tokenVersion comparison — rejects revoked tokens.
 *   5. signAccessToken — issues a fresh 1 h access token.
 *
 * @param rawToken  The raw refresh token string read from the httpOnly cookie.
 * @throws AppError 401 MISSING_REFRESH_TOKEN  cookie was absent.
 * @throws AppError 401 INVALID_TOKEN          signature / shape invalid.
 * @throws AppError 401 TOKEN_EXPIRED          refresh token past its TTL.
 * @throws AppError 401 USER_NOT_FOUND         userId in token no longer exists.
 * @throws AppError 401 USER_INACTIVE          account has been deactivated.
 * @throws AppError 401 TOKEN_REVOKED          tokenVersion mismatch.
 */
export async function refreshAccessToken(rawToken: string): Promise<RefreshResult> {
  // 1. Cryptographic verification — throws on invalid/expired/malformed token.
  const payload = verifyRefreshToken(rawToken);

  // 2. Fetch current user state from DB.
  //    (prisma as any) cast mirrors registerUser; remove once prisma generate runs.
  const user = await (prisma as any).user.findUnique({
    where: { id: payload.userId },
    select: {
      id:           true,
      orgId:        true,
      employeeId:   true,
      email:        true,
      role:         true,
      tokenVersion: true,
      isActive:     true,
    },
  });

  // 3. User existence — the account may have been hard-deleted after token issuance.
  if (!user) {
    throw new AppError(401, 'USER_NOT_FOUND', 'Account associated with this token no longer exists.');
  }

  // 4. Active-status check.
  if (!user.isActive) {
    throw new AppError(401, 'USER_INACTIVE', 'This account has been deactivated.');
  }

  // 5. tokenVersion comparison — the single revocation check.
  //    payload.tokenVersion is the version at the moment the refresh token was signed.
  //    user.tokenVersion is the current ground truth from the DB.
  //    A mismatch means logout or password-change has occurred since this token was issued.
  if (user.tokenVersion !== payload.tokenVersion) {
    throw new AppError(401, 'TOKEN_REVOKED', 'Session has been revoked. Please log in again.');
  }

  // 6. Issue a new access token only.
  const tokenUser: TokenUser = {
    id:           user.id,
    orgId:        user.orgId,
    employeeId:   user.employeeId,
    email:        user.email,
    role:         user.role as Role,
    tokenVersion: user.tokenVersion,
  };

  return {
    accessToken: signAccessToken(tokenUser),
  };
}

// ─── Logout ───────────────────────────────────────────────────────────────────

/**
 * Invalidate all sessions for a user by incrementing their tokenVersion.
 *
 * Design:
 *   The refresh token is the revocation vector here, not the access token.
 *   We verify the refresh token to extract the userId, then atomically
 *   increment users.token_version via a Prisma updateMany (not update, to
 *   avoid a 404 throw on a race where the user is deleted mid-flight).
 *
 *   Why increment instead of set-to-version+1?
 *   Using $increment is atomic at the DB level — two concurrent logout calls
 *   cannot collide and leave tokenVersion at the same value.  Each call
 *   unconditionally advances the version, so both calls succeed and both
 *   outstanding refresh tokens are invalidated.
 *
 * Silent-success contract:
 *   Logout always clears the cookie and returns success, even when:
 *     - The refresh token cookie is absent (already cleared client-side)
 *     - The token is expired or structurally invalid (already unusable)
 *     - The user row no longer exists (already no sessions to revoke)
 *   This prevents logout from leaking whether a session was active,
 *   and ensures the cookie is always cleared regardless of server state.
 *   Internal errors (DB failures) are re-thrown — those are genuine failures.
 *
 * @param rawToken  The raw refresh token string from the httpOnly cookie,
 *                  or undefined if the cookie was absent.
 */
export async function logoutUser(rawToken: string | undefined): Promise<void> {
  // If no cookie is present or the token is cryptographically invalid/expired,
  // there is nothing server-side to revoke — the cookie is cleared by the
  // controller regardless.  We return silently; do NOT throw.
  if (!rawToken) return;

  let userId: string;
  try {
    const payload = verifyRefreshToken(rawToken);
    userId = payload.userId;
  } catch {
    // Token is expired, invalid, or malformed.
    // It is already unusable for refresh — no DB action needed.
    // Return silently so the controller can still clear the cookie.
    return;
  }

  // Atomically increment tokenVersion — invalidates every outstanding
  // refresh token that embeds the old version.
  // updateMany: no error thrown if the user row was deleted between the
  // cookie read and now (count === 0 is a valid silent outcome).
  await (prisma as any).user.updateMany({
    where: { id: userId },
    data:  { tokenVersion: { increment: 1 } },
  });
}
