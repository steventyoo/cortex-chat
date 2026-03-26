import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getSignedUrl } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const path = request.nextUrl.searchParams.get('path');
  if (!path) {
    return Response.json({ error: 'path parameter required' }, { status: 400 });
  }

  if (!path.startsWith(session.orgId + '/')) {
    return Response.json({ error: 'Access denied' }, { status: 403 });
  }

  const url = await getSignedUrl(path);
  if (!url) {
    return Response.json({ error: 'Failed to generate URL' }, { status: 500 });
  }

  return Response.json({ url });
}
