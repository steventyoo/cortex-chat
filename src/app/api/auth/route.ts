import { NextResponse } from 'next/server';

/**
 * Legacy shared-password auth endpoint — DEPRECATED.
 * Returns 410 Gone to inform clients they must use /api/auth/login instead.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'This authentication endpoint has been deprecated. Use /api/auth/login with email and password.',
      migration: 'POST /api/auth/login { email, password }',
    },
    { status: 410 }
  );
}
