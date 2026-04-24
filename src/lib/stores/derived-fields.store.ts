import { getSupabase } from '@/lib/supabase';

const COLUMNS = 'id, canonical_name, display_name, source_skill_ids, primary_skill_id, tab, section, data_type, status, scope, formula, expression, depends_on, is_active, created_at, updated_at';

export async function listDerivedFields(opts?: { skillId?: string }) {
  const sb = getSupabase();
  let query = sb.from('derived_fields').select(COLUMNS)
    .order('primary_skill_id').order('tab').order('section').order('canonical_name');
  if (opts?.skillId) query = query.eq('primary_skill_id', opts.skillId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function insertDerivedField(input: Record<string, unknown>) {
  const sb = getSupabase();
  const { data, error } = await sb.from('derived_fields').insert(input).select(COLUMNS).single();
  if (error) throw error;
  return data;
}

export async function updateDerivedField(id: string, updates: Record<string, unknown>) {
  const sb = getSupabase();
  const { data, error } = await sb.from('derived_fields')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id).select(COLUMNS).single();
  if (error) throw error;
  return data;
}

export async function deleteDerivedField(id: string) {
  const sb = getSupabase();
  const { error } = await sb.from('derived_fields').delete().eq('id', id);
  if (error) throw error;
}
