import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { runCoverageAnalysis } from '@/lib/coverage';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, jcrPipelineId } = await request.json().catch(() => ({
    projectId: null,
    jcrPipelineId: null,
  }));
  const orgId = (session as SessionPayload).orgId;

  try {
    const report = await runCoverageAnalysis(orgId, projectId, jcrPipelineId);

    if (!report) {
      return Response.json(
        { error: 'No Job Cost Report found for this project' },
        { status: 404 }
      );
    }

    return Response.json({ success: true, report });
  } catch (err) {
    console.error('Coverage analysis failed:', err);
    return Response.json(
      { error: 'Coverage analysis failed', details: String(err) },
      { status: 500 }
    );
  }
}
