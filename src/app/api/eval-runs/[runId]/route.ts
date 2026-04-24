import { NextRequest } from 'next/server';
import { z } from 'zod';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getEvalRun, getEvalRunResults } from '@/lib/stores/eval-runs.store';
import { EvalRunSchema, EvalRunResultSchema } from '@/lib/schemas/eval-runs.schema';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { runId } = await params;

  try {
    const [rawRun, rawResults] = await Promise.all([
      getEvalRun(runId),
      getEvalRunResults(runId),
    ]);

    if (!rawRun || rawRun.org_id !== session.orgId) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    const run = EvalRunSchema.parse(rawRun);
    const results = z.array(EvalRunResultSchema).parse(rawResults);

    return Response.json({ run, results });
  } catch (err) {
    console.error('[eval-runs] GET [runId] error:', err);
    return Response.json({ error: 'Failed to fetch eval run' }, { status: 500 });
  }
}
