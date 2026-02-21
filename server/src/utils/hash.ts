// =============================================================================
// Password hashing utilities — bcrypt wrapper.
//
// SPEC § Day 1, Hour 1–4:
//   "Hash passwords with bcrypt (12 salt rounds)"
//
// Rule: no other file in this codebase calls bcrypt directly.
//       Always use these two exports.
// =============================================================================

import bcrypt from 'bcryptjs';

/** Number of salt rounds — SPEC-mandated value. Do not lower for performance. */
const SALT_ROUNDS = 12;

/**
 * Hash a plain-text password.
 * Called once at registration time; never called on login.
 */
export async function hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, SALT_ROUNDS);
}

/**
 * Compare a plain-text candidate with a stored hash.
 * Returns true if they match, false otherwise.
 * bcryptjs.compare is timing-safe — do NOT reimplement with === .
 */
export async function verifyPassword(
    plain: string,
    hash: string
): Promise<boolean> {
    return bcrypt.compare(plain, hash);
}
