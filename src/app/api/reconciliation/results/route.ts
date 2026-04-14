import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (session as SessionPayload).orgId;
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  const status = searchParams.get('status');
  const ruleId = searchParams.get('ruleId');
  const runId = searchParams.get('runId');
  const limit = Math.min(parseInt(searchParams.get('limit') || '200'), 1000);
  const offset = parseInt(searchParams.get('offset') || '0');

  if (!projectId) {
    return Response.json({ error: 'projectId query param is required' }, { status: 400 });
  }

  const sb = getSupabase();
  let query = sb
    .from('reconciliation_results')
    .select('*, reconciliation_rules(rule_name, link_type_key, severity, source_field, target_field, match_key)')
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('status', status);
  if (ruleId) query = query.eq('rule_id', ruleId);
  if (runId) query = query.eq('run_id', runId);

  const { data, error, count } = await query;

  if (error) {
    console.error('[reconciliation] Results query failed:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  const summary = {
    total: data?.length || 0,
    pass: data?.filter(r => r.status === 'pass').length || 0,
    warning: data?.filter(r => r.status === 'warning').length || 0,
    fail: data?.filter(r => r.status === 'fail').length || 0,
    no_match: data?.filter(r => r.status === 'no_match').length || 0,
  };

  return Response.json({ results: data || [], summary, count });
}
