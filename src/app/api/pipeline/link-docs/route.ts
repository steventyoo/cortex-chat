import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { runDocumentLinking } from '@/lib/linker';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await request.json().catch(() => ({ projectId: null }));
  const orgId = (session as SessionPayload).orgId;

  try {
    const result = await runDocumentLinking(orgId, projectId);

    return Response.json({
      success: true,
      linksCreated: result.linksCreated,
      linksSkipped: result.linksSkipped,
      totalCandidates: result.candidates.length,
      errors: result.errors,
      topLinks: result.candidates.slice(0, 20).map(c => ({
        confidence: c.confidence,
        notes: c.notes,
        matchedFields: Object.keys(c.matchedOn),
      })),
    });
  } catch (err) {
    console.error('Document linking failed:', err);
    return Response.json(
      { error: 'Linking failed', details: String(err) },
      { status: 500 }
    );
  }
}
