import { getSupabase } from '@/lib/supabase';

export async function listEvalItems(orgId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('eval_items')
    .select('*')
    .eq('org_id', orgId)
    .order('category')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getEvalItemById(itemId: string, orgId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('eval_items')
    .select('*')
    .eq('id', itemId)
    .eq('org_id', orgId)
    .single();
  if (error) throw error;
  return data;
}

export async function insertEvalItem(row: {
  id: string;
  org_id: string;
  category: string;
  question: string;
  project_id: string;
  expected_answer: string;
  key_values: Record<string, unknown>;
  expected_tool: string;
  created_by: string;
}) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('eval_items')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function upsertEvalItem(row: {
  id: string;
  org_id: string;
  category: string;
  question: string;
  project_id: string;
  expected_answer: string;
  key_values: Record<string, unknown>;
  expected_tool: string;
  created_by: string;
}) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('eval_items')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateEvalItem(
  itemId: string,
  orgId: string,
  updates: Record<string, unknown>,
) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('eval_items')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', itemId)
    .eq('org_id', orgId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteEvalItem(itemId: string, orgId: string) {
  const sb = getSupabase();
  const { error } = await sb
    .from('eval_items')
    .delete()
    .eq('id', itemId)
    .eq('org_id', orgId);
  if (error) throw error;
}
