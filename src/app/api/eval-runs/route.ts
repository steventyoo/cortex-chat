import { NextRequest } from 'next/server';
import { z } from 'zod';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { listEvalRuns } from '@/lib/stores/eval-runs.store';
import { EvalRunSchema } from '@/lib/schemas/eval-runs.schema';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const raw = await listEvalRuns(session.orgId);
    const runs = z.array(EvalRunSchema).parse(raw);
    return Response.json({ runs });
  } catch (err) {
    console.error('[eval-runs] GET error:', err);
    return Response.json({ error: 'Failed to fetch eval runs' }, { status: 500 });
  }
}
