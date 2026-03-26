import { NextRequest } from 'next/server';
import { fetchProjectList, getSupabase } from '@/lib/supabase';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const projects = await fetchProjectList(session.orgId);
    return Response.json({ projects });
  } catch (err) {
    console.error('Projects API error:', err);
    return Response.json({ projects: [] });
  }
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { name?: string; address?: string; trade?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return Response.json({ error: 'Project name is required' }, { status: 400 });
  }

  const projectId = name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  const sb = getSupabase();

  const { data, error } = await sb.from('projects').insert({
    project_id: projectId,
    project_name: name,
    org_id: session.orgId,
    project_status: 'active',
    contract_value: 0,
    revised_budget: 0,
    job_to_date: 0,
    percent_complete_cost: 0,
    total_cos: 0,
    ...(body.address?.trim() ? { address: body.address.trim() } : {}),
    ...(body.trade?.trim() ? { trade: body.trade.trim() } : {}),
  }).select('project_id, project_name').single();

  if (error) {
    console.error('Failed to create project:', error.message);
    if (error.code === '23505') {
      return Response.json({ error: 'A project with this name already exists' }, { status: 409 });
    }
    return Response.json({ error: 'Failed to create project' }, { status: 500 });
  }

  return Response.json({
    projectId: data.project_id,
    projectName: data.project_name,
  });
}
