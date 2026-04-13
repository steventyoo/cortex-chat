import { getSupabase } from '@/lib/supabase';

// ─── Reads ──────────────────────────────────────────────────────────

export async function listCatalogFields(opts?: { category?: string }) {
  const sb = getSupabase();
  let query = sb.from('field_catalog').select('*').order('category').order('display_name');
  if (opts?.category) {
    query = query.eq('category', opts.category);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getFieldUsageCounts(): Promise<Map<string, number>> {
  const sb = getSupabase();
  const { data } = await sb.from('skill_fields').select('field_id');
  const countMap = new Map<string, number>();
  for (const row of data || []) {
    const fid = row.field_id as string;
    countMap.set(fid, (countMap.get(fid) || 0) + 1);
  }
  return countMap;
}

const SKILL_FIELD_SELECT = `
  id,
  skill_id,
  field_id,
  display_override,
  tier,
  required,
  importance,
  description,
  options,
  example,
  extraction_hint,
  disambiguation_rules,
  sort_order,
  field_catalog (
    id,
    canonical_name,
    display_name,
    field_type,
    category,
    description,
    enum_options
  )
` as const;

export async function listSkillFields(skillId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('skill_fields')
    .select(SKILL_FIELD_SELECT)
    .eq('skill_id', skillId)
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

// ─── Writes ─────────────────────────────────────────────────────────

export async function insertCatalogField(row: {
  canonical_name: string;
  display_name: string;
  field_type: string;
  category: string;
  description: string;
  enum_options: string[] | null;
}) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('field_catalog')
    .insert({
      ...row,
      enum_options: row.enum_options ? JSON.stringify(row.enum_options) : null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateCatalogField(id: string, updates: Record<string, unknown>) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('field_catalog')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getNextSortOrder(skillId: string): Promise<number> {
  const sb = getSupabase();
  const { data } = await sb
    .from('skill_fields')
    .select('sort_order')
    .eq('skill_id', skillId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .single();
  return (data?.sort_order ?? 0) + 1;
}

export async function insertSkillField(row: {
  skill_id: string;
  field_id: string;
  display_override: string | null;
  tier: number;
  required: boolean;
  importance: string | null;
  description: string;
  options: string[] | null;
  example: string;
  extraction_hint: string | null;
  disambiguation_rules: string | null;
  sort_order: number;
}) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('skill_fields')
    .insert(row)
    .select(SKILL_FIELD_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function updateSkillField(
  id: string,
  skillId: string,
  updates: Record<string, unknown>,
) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('skill_fields')
    .update(updates)
    .eq('id', id)
    .eq('skill_id', skillId)
    .select(SKILL_FIELD_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function deleteSkillField(id: string, skillId: string) {
  const sb = getSupabase();
  const { error } = await sb
    .from('skill_fields')
    .delete()
    .eq('id', id)
    .eq('skill_id', skillId);
  if (error) throw error;
}
