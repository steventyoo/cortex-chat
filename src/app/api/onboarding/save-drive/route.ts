import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getOrganization, updateOrganization } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { folderId } = await req.json();
  if (!folderId) {
    return Response.json({ error: 'folderId required' }, { status: 400 });
  }

  const org = await getOrganization(session.orgId);
  if (!org) {
    return Response.json({ error: 'Organization not found' }, { status: 404 });
  }

  await updateOrganization(org.orgId, { driveFolderId: folderId.trim() });

  return Response.json({ success: true });
}
