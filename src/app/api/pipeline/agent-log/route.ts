import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return Response.json({ error: 'id parameter required' }, { status: 400 });
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from('pipeline_log')
    .select('agent_activity_log, agent_best_script, agent_composite_score, agent_rounds, agent_tool_calls')
    .eq('id', id)
    .eq('org_id', session.orgId)
    .single();

  if (error || !data) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  return Response.json({
    activityLog: data.agent_activity_log,
    bestScript: data.agent_best_script,
    compositeScore: data.agent_composite_score,
    rounds: data.agent_rounds,
    toolCalls: data.agent_tool_calls,
  });
}
