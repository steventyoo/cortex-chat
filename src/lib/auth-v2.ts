/**
 * Multi-tenant JWT auth module.
 * Uses `jose` (Edge-compatible) for JWTs and `bcryptjs` for password hashing.
 */

import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import type { UserRole } from './schemas/enums';
import { ADMIN_ROLES } from './schemas/enums';

export { ADMIN_ROLES };
export type { UserRole };

export const SESSION_COOKIE = 'cortex-session';
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface SessionPayload {
  userId: string;
  orgId: string;
  email: string;
  name: string;
  role: UserRole;
}

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET not set');
  return new TextEncoder().encode(secret);
}

/** Hash a password with bcrypt (12 rounds). */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

/** Verify a password against a bcrypt hash. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Create a signed JWT for a user session. */
export async function createUserSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(getSecret());
}

/** Validate a JWT and return the session payload, or null if invalid. */
export async function validateUserSession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    // Ensure all required fields are present
    if (!payload.userId || !payload.orgId || !payload.email || !payload.role) {
      return null;
    }
    return {
      userId: payload.userId as string,
      orgId: payload.orgId as string,
      email: payload.email as string,
      name: (payload.name as string) || '',
      role: payload.role as SessionPayload['role'],
    };
  } catch {
    return null;
  }
}

/** Cookie options for setting the session. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: MAX_AGE_SECONDS,
    path: '/',
  };
}

/** Check if a role has admin-level access (owner or admin). */
export function isAdminRole(role: string): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}
