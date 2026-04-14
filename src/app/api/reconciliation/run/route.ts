import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { reconcileProject } from '@/lib/reconciliation';
import { materializeProjectProfile } from '@/lib/project-profile';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (session as SessionPayload).orgId;
  const { projectId } = await request.json();

  if (!projectId) {
    return Response.json({ error: 'projectId is required' }, { status: 400 });
  }

  try {
    const result = await reconcileProject(projectId, orgId);

    let profile = null;
    try {
      profile = await materializeProjectProfile(projectId, orgId);
    } catch (err) {
      console.warn('[reconciliation] Profile materialization failed (non-fatal):', err);
    }

    return Response.json({ ...result, profileRefreshed: !!profile });
  } catch (err) {
    console.error('[reconciliation] Run failed:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Reconciliation failed' },
      { status: 500 },
    );
  }
}
