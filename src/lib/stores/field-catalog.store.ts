import { getSupabase } from '@/lib/supabase';

// ─── Types ──────────────────────────────────────────────────────────

export interface FieldMapping {
  canonicalName: string;
  displayOverride: string | null;
  catalogDisplayName: string;
}

export interface AssembledFieldDef {
  name: string;
  type: 'string' | 'number' | 'date' | 'enum' | 'boolean' | 'array';
  tier: 0 | 1 | 2 | 3;
  required: boolean;
  description: string;
  options?: string[];
  disambiguationRules?: string;
  importance?: 'P' | 'S' | 'E' | 'A';
}

// ─── Reads ──────────────────────────────────────────────────────────

export async function listCatalogFields(opts?: { category?: string }) {
  const sb = getSupabase();
  let query = sb.from('field_catalog').select('id, canonical_name, display_name, field_type, category, description, enum_options, created_at, updated_at').order('category').order('display_name');
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

// ─── Query-Oriented Reads ───────────────────────────────────────────

const FIELD_DEF_SELECT = `
  display_override,
  tier,
  required,
  importance,
  description,
  options,
  extraction_hint,
  disambiguation_rules,
  sort_order,
  field_catalog (
    canonical_name,
    display_name,
    field_type,
    category,
    description,
    enum_options
  )
` as const;

/**
 * Assemble FieldDefinition-shaped objects from skill_fields JOIN field_catalog.
 * Returns them sorted by sort_order.
 */
export async function getSkillFieldDefinitions(skillId: string): Promise<AssembledFieldDef[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('skill_fields')
    .select(FIELD_DEF_SELECT)
    .eq('skill_id', skillId)
    .order('sort_order');

  if (error || !data || data.length === 0) return [];

  const fields: AssembledFieldDef[] = [];
  for (const row of data) {
    const catalogRaw = row.field_catalog as unknown;
    const catalog = Array.isArray(catalogRaw) ? catalogRaw[0] : catalogRaw;
    if (!catalog) continue;

    const cat = catalog as {
      canonical_name: string;
      display_name: string;
      field_type: string;
      description: string;
      enum_options: string[] | null;
    };

    const name = row.display_override || cat.display_name;
    const fieldType = (cat.field_type || 'string') as AssembledFieldDef['type'];
    const desc = (row.description as string) || cat.description || '';

    const optionsRaw = row.options as string[] | null;
    const options = optionsRaw && optionsRaw.length > 0
      ? optionsRaw
      : cat.enum_options && cat.enum_options.length > 0
        ? cat.enum_options
        : undefined;

    const disambiguationRules = (row.extraction_hint as string) || (row.disambiguation_rules as string) || undefined;

    fields.push({
      name,
      type: fieldType,
      tier: ((row.tier as number) ?? 1) as AssembledFieldDef['tier'],
      required: (row.required as boolean) ?? false,
      description: desc,
      options,
      disambiguationRules,
      importance: (row.importance as AssembledFieldDef['importance']) || undefined,
    });
  }

  return fields;
}

/**
 * Build (skillId → FieldMapping[]) map from skill_fields JOIN field_catalog.
 * Used by the linker and context-card field resolution.
 */
export async function getFieldMap(): Promise<Map<string, FieldMapping[]>> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('skill_fields')
    .select(`
      skill_id,
      display_override,
      field_catalog (
        canonical_name,
        display_name
      )
    `);

  const map = new Map<string, FieldMapping[]>();
  if (error || !data) return map;

  for (const row of data) {
    const skillId = row.skill_id as string;
    const catalogArr = row.field_catalog as unknown as
      | Array<{ canonical_name: string; display_name: string }>
      | { canonical_name: string; display_name: string }
      | null;
    const catalog = Array.isArray(catalogArr) ? catalogArr[0] : catalogArr;
    if (!catalog) continue;

    const existing = map.get(skillId) || [];
    existing.push({
      canonicalName: catalog.canonical_name,
      displayOverride: row.display_override as string | null,
      catalogDisplayName: catalog.display_name,
    });
    map.set(skillId, existing);
  }

  return map;
}

/**
 * Fetch field-catalog-based field info for the executeFieldCatalog tool.
 * Returns display-friendly field rows for a given skill.
 */
export async function getSkillFieldCatalogInfo(skillId: string) {
  const sb = getSupabase();
  const { data } = await sb
    .from('skill_fields')
    .select(`
      display_override,
      tier,
      required,
      importance,
      description,
      options,
      extraction_hint,
      field_catalog (
        canonical_name,
        display_name,
        field_type,
        description
      )
    `)
    .eq('skill_id', skillId)
    .order('sort_order');

  return (data || []).map((row: Record<string, unknown>) => {
    const catRaw = row.field_catalog as Record<string, unknown> | Record<string, unknown>[] | null;
    const cat = Array.isArray(catRaw) ? catRaw[0] : catRaw;
    return {
      name: (row.display_override as string) || (cat?.display_name as string) || '',
      type: (cat?.field_type as string) || 'string',
      description: (row.description as string) || (cat?.description as string) || '',
      required: (row.required as boolean) || false,
      importance: (row.importance as string) || 'S',
      canonical: (cat?.canonical_name as string) || '',
    };
  });
}

/**
 * Call the get_field_frequency RPC to learn what fields actually appear in
 * extracted_records for a given skill.
 */
export async function getFieldFrequency(
  orgId: string,
  skillId: string,
  includePending: boolean = false,
): Promise<{ field_name: string; record_count: number; sample_value: string }[]> {
  const sb = getSupabase();
  try {
    const { data } = await sb.rpc('get_field_frequency', {
      p_org_id: orgId,
      p_skill_id: skillId,
      p_include_pending: includePending,
    });
    return data
      ? (data as { field_name: string; record_count: number; sample_value: string }[]).slice(0, 30)
      : [];
  } catch {
    return [];
  }
}
