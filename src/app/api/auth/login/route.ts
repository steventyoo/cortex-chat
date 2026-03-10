import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword, createUserSession, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth-v2';
import { getUserByEmail, updateUserLastLogin } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    const user = await getUserByEmail(email);
    if (!user || !user.active) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Create JWT
    const token = await createUserSession({
      userId: user.userId,
      orgId: user.orgId,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    // Update last login
    updateUserLastLogin(user.id).catch(() => {}); // fire-and-forget

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());

    return response;
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
