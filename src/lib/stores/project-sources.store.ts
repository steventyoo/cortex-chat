import { getSupabase } from '@/lib/supabase';
import type { SourceKind } from '@/lib/schemas/project-sources.schema';

// ─── Reads ──────────────────────────────────────────────────────

export async function listProjectSources(orgId: string, projectId?: string) {
  const sb = getSupabase();
  let query = sb.from('project_sources').select('*').eq('org_id', orgId);
  if (projectId) query = query.eq('project_id', projectId);
  query = query.order('created_at', { ascending: true });
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function listActiveFileSources(orgId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('project_sources')
    .select('*')
    .eq('org_id', orgId)
    .eq('kind', 'file')
    .eq('active', true)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ─── Writes ─────────────────────────────────────────────────────

export async function insertProjectSource(row: {
  project_id: string;
  org_id: string;
  kind: SourceKind;
  provider: string;
  config: Record<string, unknown>;
  label: string;
  integration_id?: string;
}) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('project_sources')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteProjectSource(sourceId: string, orgId: string) {
  const sb = getSupabase();
  const { error } = await sb
    .from('project_sources')
    .delete()
    .eq('id', sourceId)
    .eq('org_id', orgId);
  if (error) throw error;
}

export async function updateSourceLastSynced(sourceId: string) {
  const sb = getSupabase();
  const { error } = await sb
    .from('project_sources')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('id', sourceId);
  if (error) throw error;
}
