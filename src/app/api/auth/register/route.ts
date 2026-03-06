import { NextRequest, NextResponse } from 'next/server';
import { hashPassword, createUserSession, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth-v2';
import { getUserByEmail, createUser, createOrganization } from '@/lib/organizations';

export async function POST(req: NextRequest) {
  try {
    const { email, password, name, orgName } = await req.json();

    if (!email || !password || !name || !orgName) {
      return NextResponse.json(
        { error: 'Email, password, name, and organization name are required' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    // Check if user already exists
    const existing = await getUserByEmail(email);
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
    }

    // Create org
    const org = await createOrganization({
      orgName,
      ownerEmail: email.toLowerCase(),
    });

    // Create user
    const passwordHash = await hashPassword(password);
    const user = await createUser({
      orgId: org.orgId,
      email: email.toLowerCase(),
      name,
      passwordHash,
      role: 'owner',
    });

    // Create session
    const token = await createUserSession({
      userId: user.userId,
      orgId: org.orgId,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    const response = NextResponse.json({ ok: true, orgId: org.orgId });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());

    return response;
  } catch (err) {
    console.error('Register error:', err);
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}
