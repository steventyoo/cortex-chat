import { getSupabase } from '@/lib/supabase';

// ─── Reads ──────────────────────────────────────────────────────────

export async function listLinkTypes() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('document_link_types')
    .select('*')
    .order('source_skill')
    .order('target_skill');
  if (error) throw error;
  return data ?? [];
}

// ─── Writes ─────────────────────────────────────────────────────────

export async function insertLinkType(row: {
  link_type_key: string;
  display_name: string;
  source_skill: string;
  target_skill: string;
  relationship: string;
  match_fields: string[];
  description: string;
}) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('document_link_types')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateLinkType(id: string, updates: Record<string, unknown>) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('document_link_types')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteLinkType(id: string) {
  const sb = getSupabase();
  const { error } = await sb
    .from('document_link_types')
    .delete()
    .eq('id', id);
  if (error) throw error;
}
