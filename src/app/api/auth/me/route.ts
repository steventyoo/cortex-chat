import { NextRequest, NextResponse } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getOrganization } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (!token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const session = await validateUserSession(token);
    if (!session) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    // Fetch org info
    const org = await getOrganization(session.orgId);

    return NextResponse.json({
      userId: session.userId,
      orgId: session.orgId,
      email: session.email,
      name: session.name,
      role: session.role,
      orgName: org?.orgName || '',
      onboardingComplete: org?.onboardingComplete ?? true,
    });
  } catch (err) {
    console.error('Auth me error:', err);
    return NextResponse.json({ error: 'Auth check failed' }, { status: 500 });
  }
}
