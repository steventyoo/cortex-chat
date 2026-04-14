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

/**
 * Returns the set of key_fields referenced across all context cards that involve a given skill.
 * Used by the code-gen meta-prompt to know which fields context cards need
 * beyond what the skill schema defines (the "floor" for extraction).
 */
export async function getContextCardFieldsForSkill(
  skillId: string,
  orgId: string,
): Promise<string[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('context_cards')
    .select('key_fields')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .contains('skills_involved', [skillId]);
  if (error) throw error;

  const fieldNames = new Set<string>();
  for (const row of data ?? []) {
    const kf = row.key_fields as Record<string, unknown> | null;
    if (kf && typeof kf === 'object') {
      for (const key of Object.keys(kf)) {
        fieldNames.add(key);
      }
    }
  }
  return Array.from(fieldNames);
}
