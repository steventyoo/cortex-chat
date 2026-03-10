import { NextRequest } from 'next/server';
import { fetchProjectList } from '@/lib/supabase';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const projects = await fetchProjectList(session.orgId);
    return Response.json({ projects });
  } catch (err) {
    console.error('Projects API error:', err);
    return Response.json({ projects: [] });
  }
}
