import { NextRequest, NextResponse } from 'next/server';
import { validateUserSession, SESSION_COOKIE, createUserSession, sessionCookieOptions } from '@/lib/auth-v2';
import { getUserByEmail } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { orgId } = await req.json();
    if (!orgId) {
      return NextResponse.json({ error: 'orgId is required' }, { status: 400 });
    }

    if (orgId === session.orgId) {
      return NextResponse.json({ ok: true });
    }

    const userInTargetOrg = await getUserByEmail(session.email, orgId);
    if (!userInTargetOrg) {
      return NextResponse.json({ error: 'You do not have access to this organization' }, { status: 403 });
    }

    const newToken = await createUserSession({
      userId: userInTargetOrg.userId,
      orgId: userInTargetOrg.orgId,
      email: userInTargetOrg.email,
      name: userInTargetOrg.name,
      role: userInTargetOrg.role,
    });

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, newToken, sessionCookieOptions());
    return response;
  } catch (err) {
    console.error('Switch org error:', err);
    return NextResponse.json({ error: 'Failed to switch organization' }, { status: 500 });
  }
}
