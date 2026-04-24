import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getOrganization, getSupabase } from '@/lib/supabase';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projects } = await req.json();
  if (!Array.isArray(projects) || projects.length === 0) {
    return Response.json({ error: 'projects array required' }, { status: 400 });
  }

  const org = await getOrganization(session.orgId);
  if (!org) {
    return Response.json({ error: 'Organization not found' }, { status: 404 });
  }

  const sb = getSupabase();
  const rows = projects.map(
    (p: { name: string; projectId?: string; driveFolderId?: string; address?: string; trade?: string }) => ({
      project_id: p.projectId || p.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase(),
      project_name: p.name,
      org_id: session.orgId,
      project_status: 'active',
      contract_value: 0,
      revised_budget: 0,
      job_to_date: 0,
      percent_complete_cost: 0,
      total_cos: 0,
      ...(p.address ? { address: p.address } : {}),
      ...(p.trade ? { trade: p.trade } : {}),
    })
  );

  const { data, error } = await sb.from('projects').insert(rows).select('project_id');
  if (error) {
    console.error('Failed to create projects:', error.message);
    return Response.json({ error: 'Failed to create projects' }, { status: 500 });
  }

  const created = (data || []).map((r: { project_id: string }) => r.project_id);

  // Persist project_sources rows for projects that came from Drive subfolders
  const sourceRows = projects
    .filter((p: { driveFolderId?: string }) => p.driveFolderId)
    .map((p: { name: string; projectId?: string; driveFolderId?: string }) => ({
      project_id: p.projectId || p.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase(),
      org_id: session.orgId,
      kind: 'file',
      provider: 'gdrive',
      config: { folder_id: p.driveFolderId, relative_to_org_root: true },
      label: p.name,
    }));

  if (sourceRows.length > 0) {
    const { error: srcError } = await sb.from('project_sources').insert(sourceRows);
    if (srcError) {
      console.error('Failed to create project sources:', srcError.message);
    }
  }

  return Response.json({
    success: true,
    created: created.length,
    projectIds: created,
  });
}
