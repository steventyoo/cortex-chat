import { NextRequest, NextResponse } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';

export async function POST(request: NextRequest) {
  // Must be logged in first
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { password } = await request.json();
    const adminPassword = (process.env.CORTEX_ADMIN_PASSWORD || '').trim();
    const inputPassword = (password || '').trim();

    if (!adminPassword || inputPassword !== adminPassword) {
      return Response.json({ error: 'Invalid admin password' }, { status: 403 });
    }

    // Set admin cookie (session-only, no maxAge = expires when browser closes)
    const res = NextResponse.json({ success: true });
    res.cookies.set('cortex-admin', 'true', {
      httpOnly: false, // Need to read from client
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 60 * 60, // 24 hours
    });

    return res;
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }
}

// Check admin status
export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ isAdmin: false });
  }

  const adminCookie = request.cookies.get('cortex-admin')?.value;
  return Response.json({ isAdmin: adminCookie === 'true' });
}
