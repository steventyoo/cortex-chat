import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, isAdminRole } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

interface RouteParams {
  params: Promise<{ skillId: string }>;
}

/** GET all version snapshots for a skill */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { skillId } = await params;
  const sb = getSupabase();

  const { data, error } = await sb
    .from('skill_version_history')
    .select('*')
    .eq('skill_id', skillId)
    .order('version', { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ versions: data || [] });
}

/** POST rollback a skill to a specific version */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session || !isAdminRole(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { skillId } = await params;
  const { version } = await request.json() as { version: number };

  if (!version) {
    return Response.json({ error: 'version is required' }, { status: 400 });
  }

  const sb = getSupabase();

  // Fetch the target snapshot
  const { data: historyRow, error: fetchErr } = await sb
    .from('skill_version_history')
    .select('snapshot')
    .eq('skill_id', skillId)
    .eq('version', version)
    .single();

  if (fetchErr || !historyRow) {
    return Response.json({ error: `Version ${version} not found` }, { status: 404 });
  }

  const snapshot = historyRow.snapshot as Record<string, unknown>;

  // Get current version to increment
  const { data: current } = await sb
    .from('document_skills')
    .select('version')
    .eq('skill_id', skillId)
    .single();

  const newVersion = ((current?.version as number) || 1) + 1;

  // Apply snapshot to the skill
  const { data, error } = await sb
    .from('document_skills')
    .update({
      display_name: snapshot.display_name,
      system_prompt: snapshot.system_prompt,
      extraction_instructions: snapshot.extraction_instructions,
      field_definitions: snapshot.field_definitions,
      classifier_hints: snapshot.classifier_hints,
      sample_extractions: snapshot.sample_extractions,
      reference_doc_ids: snapshot.reference_doc_ids,
      status: snapshot.status,
      version: newVersion,
      updated_at: new Date().toISOString(),
    })
    .eq('skill_id', skillId)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Record the rollback as a new version entry
  await sb.from('skill_version_history').upsert({
    skill_id: skillId,
    version: newVersion,
    snapshot,
    changed_by: session.email,
    change_summary: `Rolled back to v${version}`,
  }, { onConflict: 'skill_id,version' });

  return Response.json({ skill: data });
}
