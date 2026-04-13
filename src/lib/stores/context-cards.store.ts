import { getSupabase } from '@/lib/supabase';

// ─── Reads ──────────────────────────────────────────────────────────

export async function listContextCards(orgId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('context_cards')
    .select('*')
    .eq('org_id', orgId)
    .order('display_name');
  if (error) throw error;
  return data ?? [];
}

// ─── Writes ─────────────────────────────────────────────────────────

export async function insertContextCard(row: {
  org_id: string;
  card_name: string;
  display_name: string;
  description: string;
  trigger_concepts: string[];
  skills_involved: string[];
  business_logic?: string;
  key_fields: Record<string, unknown>;
  example_questions: string[];
  embedding: string | null;
  is_active: boolean;
  created_by: string;
}) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('context_cards')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateContextCard(
  id: string,
  orgId: string,
  updates: Record<string, unknown>,
) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('context_cards')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', orgId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteContextCard(id: string, orgId: string) {
  const sb = getSupabase();
  const { error } = await sb
    .from('context_cards')
    .delete()
    .eq('id', id)
    .eq('org_id', orgId);
  if (error) throw error;
}
