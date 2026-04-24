import { getSupabase } from '@/lib/supabase';

const COLUMNS = 'id, skill_id, check_name, display_name, description, tier, classification, scope, expression, tolerance_abs, affected_fields, hint_template, is_active, created_at';

export async function listConsistencyChecks(opts?: { skillId?: string }) {
  const sb = getSupabase();
  let query = sb.from('consistency_checks').select(COLUMNS)
    .order('skill_id').order('tier').order('check_name');
  if (opts?.skillId) query = query.eq('skill_id', opts.skillId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function insertConsistencyCheck(input: Record<string, unknown>) {
  const sb = getSupabase();
  const { data, error } = await sb.from('consistency_checks').insert(input).select(COLUMNS).single();
  if (error) throw error;
  return data;
}

export async function updateConsistencyCheck(id: string, updates: Record<string, unknown>) {
  const sb = getSupabase();
  const { data, error } = await sb.from('consistency_checks')
    .update(updates).eq('id', id).select(COLUMNS).single();
  if (error) throw error;
  return data;
}

export async function deleteConsistencyCheck(id: string) {
  const sb = getSupabase();
  const { error } = await sb.from('consistency_checks').delete().eq('id', id);
  if (error) throw error;
}
