import { NextRequest, NextResponse } from 'next/server';
import { validateUserSession, SESSION_COOKIE, createUserSession, sessionCookieOptions } from '@/lib/auth-v2';
import { createOrganization, createUser, getUserByEmail } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { orgName } = await req.json();
    if (!orgName?.trim()) {
      return NextResponse.json({ error: 'Organization name is required' }, { status: 400 });
    }

    const org = await createOrganization({
      orgName: orgName.trim(),
      ownerEmail: session.email,
    });

    const existingUser = await getUserByEmail(session.email);
    const passwordHash = existingUser?.passwordHash || 'no-password';

    const user = await createUser({
      orgId: org.orgId,
      email: session.email,
      name: session.name,
      passwordHash,
      role: 'owner',
    });

    const newToken = await createUserSession({
      userId: user.userId,
      orgId: org.orgId,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    const response = NextResponse.json({ ok: true, orgId: org.orgId });
    response.cookies.set(SESSION_COOKIE, newToken, sessionCookieOptions());
    return response;
  } catch (err) {
    console.error('Create org error:', err);
    return NextResponse.json(
      { error: 'Failed to create organization', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
