import { NextRequest, NextResponse } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getOrgsForUser } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const orgs = await getOrgsForUser(session.email);
    return NextResponse.json({ orgs, currentOrgId: session.orgId });
  } catch (err) {
    console.error('List orgs error:', err);
    return NextResponse.json({ error: 'Failed to list organizations' }, { status: 500 });
  }
}
