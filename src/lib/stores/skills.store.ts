import { getSupabase } from '@/lib/supabase';

// ─── Reads ──────────────────────────────────────────────────────────

export async function listSkills(statusFilter: string = 'active') {
  const sb = getSupabase();
  let query = sb.from('document_skills').select('*');
  if (statusFilter !== 'all') {
    query = query.eq('status', statusFilter);
  }
  query = query.order('display_name', { ascending: true });
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * Fetch active skills with only the columns needed at runtime
 * (classifier, extraction). Used by skills.ts listActiveSkills().
 */
export async function listActiveSkillRows() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('document_skills')
    .select('*')
    .eq('status', 'active');
  if (error) throw error;
  return data ?? [];
}

export async function getSkillById(skillId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('document_skills')
    .select('*')
    .eq('skill_id', skillId)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Fetch active skills with classifier_hints for the field catalog tool.
 * Optionally filtered to specific skill IDs.
 */
export async function listActiveSkillSummaries(skillIds?: string[]) {
  const sb = getSupabase();
  let query = sb
    .from('document_skills')
    .select('skill_id, display_name, classifier_hints')
    .eq('status', 'active');
  if (skillIds && skillIds.length > 0) {
    query = query.in('skill_id', skillIds);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function listSkillVersions(skillId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('skill_version_history')
    .select('*')
    .eq('skill_id', skillId)
    .order('version', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getSkillVersionSnapshot(skillId: string, version: number) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('skill_version_history')
    .select('snapshot')
    .eq('skill_id', skillId)
    .eq('version', version)
    .single();
  if (error) throw error;
  return data;
}

export async function listOrgSkillConfigs(skillId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('org_skill_configs')
    .select('*')
    .eq('skill_id', skillId);
  if (error) throw error;
  return data ?? [];
}

// ─── Writes ─────────────────────────────────────────────────────────

export async function insertSkill(row: Record<string, unknown>) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('document_skills')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateSkill(skillId: string, updates: Record<string, unknown>) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('document_skills')
    .update(updates)
    .eq('skill_id', skillId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function upsertSkillVersion(row: {
  skill_id: string;
  version: number;
  snapshot: Record<string, unknown>;
  changed_by: string;
  change_summary: string;
}) {
  const sb = getSupabase();
  const { error } = await sb
    .from('skill_version_history')
    .upsert(row, { onConflict: 'skill_id,version' });
  if (error) throw error;
}

export async function upsertOrgSkillConfig(row: {
  org_id: string;
  skill_id: string;
  pinned_version: number | null;
  document_aliases: string[];
  hidden_fields: string[];
}) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('org_skill_configs')
    .upsert({
      ...row,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id,skill_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteOrgSkillConfig(skillId: string, orgId: string) {
  const sb = getSupabase();
  const { error } = await sb
    .from('org_skill_configs')
    .delete()
    .eq('skill_id', skillId)
    .eq('org_id', orgId);
  if (error) throw error;
}

export async function findOrCreateCatalogEntry(canonical: string, fd: {
  name: string;
  type?: string;
  description?: string;
  options?: string[] | null;
}): Promise<string | null> {
  const sb = getSupabase();
  const { data: existing } = await sb
    .from('field_catalog')
    .select('id')
    .eq('canonical_name', canonical)
    .single();

  if (existing) return existing.id;

  const { data: created } = await sb
    .from('field_catalog')
    .insert({
      canonical_name: canonical,
      display_name: fd.name,
      field_type: fd.type || 'string',
      category: 'general',
      description: fd.description || '',
      enum_options: fd.options || null,
    })
    .select('id')
    .single();

  return created?.id ?? null;
}

export async function replaceSkillFields(skillId: string, fieldDefs: Array<{
  name: string;
  type?: string;
  description?: string;
  options?: string[] | null;
  tier?: number;
  required?: boolean;
  importance?: string | null;
  disambiguationRules?: string | null;
}>) {
  const sb = getSupabase();
  await sb.from('skill_fields').delete().eq('skill_id', skillId);

  for (let i = 0; i < fieldDefs.length; i++) {
    const fd = fieldDefs[i];
    const canonical = fd.name
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .toLowerCase()
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

    const catalogId = await findOrCreateCatalogEntry(canonical, fd);
    if (catalogId) {
      await sb.from('skill_fields').insert({
        skill_id: skillId,
        field_id: catalogId,
        display_override: fd.name,
        tier: fd.tier ?? 1,
        required: fd.required ?? false,
        importance: fd.importance || null,
        description: fd.description || '',
        options: fd.options || null,
        extraction_hint: fd.disambiguationRules || null,
        disambiguation_rules: fd.disambiguationRules || null,
        sort_order: i + 1,
      });
    }
  }
}
