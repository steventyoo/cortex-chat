import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { materializeProjectProfile } from '@/lib/project-profile';
import { getSupabase } from '@/lib/supabase';

export const maxDuration = 120;

/**
 * POST — refresh/materialize a project profile snapshot
 * GET  — fetch the latest profile for a project
 */

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
    const profile = await materializeProjectProfile(projectId, orgId);
    return Response.json({ success: true, profile });
  } catch (err) {
    console.error('[project-profile] Materialization failed:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Profile materialization failed' },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (session as SessionPayload).orgId;
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');

  if (!projectId) {
    return Response.json({ error: 'projectId query param is required' }, { status: 400 });
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from('project_profiles')
    .select('*')
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .order('snapshot_date', { ascending: false })
    .limit(5);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    latest: data?.[0] || null,
    history: data || [],
  });
}
