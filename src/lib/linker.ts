import { getSupabase } from './supabase';

interface PipelineDoc {
  id: string;
  orgId: string;
  projectId: string | null;
  fileName: string;
  skillId: string;
  fields: Record<string, { value: string | number | null; confidence: number }>;
}

interface LinkType {
  id: string;
  linkTypeKey: string;
  displayName: string;
  sourceSkill: string;
  targetSkill: string;
  relationship: string;
  matchFields: string[];
  description: string;
}

interface LinkCandidate {
  sourceId: string;
  targetId: string;
  linkTypeId: string;
  confidence: number;
  matchedOn: Record<string, { sourceValue: string; targetValue: string; score: number }>;
  notes: string;
}

export interface LinkResult {
  linksCreated: number;
  linksSkipped: number;
  errors: string[];
  candidates: LinkCandidate[];
}

// ── Field Catalog Cache ───────────────────────────────────────
// Maps (skillId, canonicalName) → display_override or display_name
// so the linker can resolve match_fields to exact extracted field names.

interface FieldMapping {
  canonicalName: string;
  displayOverride: string | null;
  catalogDisplayName: string;
}

let _fieldMapCache: Map<string, FieldMapping[]> | null = null;
let _fieldMapCacheTime = 0;
const FIELD_MAP_TTL = 5 * 60 * 1000;

async function getFieldMap(): Promise<Map<string, FieldMapping[]>> {
  const now = Date.now();
  if (_fieldMapCache && now - _fieldMapCacheTime < FIELD_MAP_TTL) {
    return _fieldMapCache;
  }

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

  if (!error && data) {
    for (const row of data) {
      const skillId = row.skill_id as string;
      const catalogArr = row.field_catalog as unknown as Array<{ canonical_name: string; display_name: string }> | { canonical_name: string; display_name: string } | null;
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
  }

  _fieldMapCache = map;
  _fieldMapCacheTime = now;
  return map;
}

// ── Match Helpers ─────────────────────────────────────────────

function normalizeValue(val: string | number | null | undefined): string {
  if (val == null) return '';
  return String(val).toLowerCase().trim().replace(/[,\s]+/g, ' ');
}

function extractNumeric(val: string | number | null | undefined): number | null {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function fuzzyMatch(a: string, b: string): number {
  if (!a || !b) return 0;
  const na = normalizeValue(a);
  const nb = normalizeValue(b);
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.8;

  const wordsA = new Set(na.split(/\s+/));
  const wordsB = new Set(nb.split(/\s+/));
  const intersection = [...wordsA].filter(w => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);
  if (union.size === 0) return 0;
  const jaccard = intersection.length / union.size;
  return jaccard > 0.5 ? jaccard * 0.7 : 0;
}

function numericMatch(a: number | null, b: number | null): number {
  if (a == null || b == null) return 0;
  if (a === b) return 1.0;
  if (a === 0 && b === 0) return 1.0;
  const diff = Math.abs(a - b);
  const max = Math.max(Math.abs(a), Math.abs(b));
  if (max === 0) return 1.0;
  const ratio = 1 - diff / max;
  return ratio > 0.9 ? ratio : 0;
}

function dateMatch(a: string, b: string): number {
  const dateA = new Date(normalizeValue(a));
  const dateB = new Date(normalizeValue(b));
  if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) return 0;
  const diffDays = Math.abs((dateA.getTime() - dateB.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 1.0;
  if (diffDays <= 1) return 0.95;
  if (diffDays <= 7) return 0.8;
  if (diffDays <= 30) return 0.6;
  return 0;
}

// ── Catalog-Aware Field Resolution ────────────────────────────

/**
 * Resolve a canonical match_field name to the actual value in a document's
 * extracted_data, using the field catalog for deterministic mapping.
 *
 * Lookup order:
 * 1. Catalog: canonical_name → display_override or display_name → exact field key
 * 2. Fallback: substring matching on field keys (for uncatalogued fields)
 */
function getFieldValue(
  doc: PipelineDoc,
  fieldHint: string,
  fieldMap: Map<string, FieldMapping[]>,
): string | number | null {
  const hint = fieldHint.toLowerCase();

  // 1. Catalog-based resolution: look up the exact field name for this skill
  const skillMappings = fieldMap.get(doc.skillId);
  if (skillMappings) {
    const mapping = skillMappings.find(m => m.canonicalName === hint);
    if (mapping) {
      const displayName = mapping.displayOverride || mapping.catalogDisplayName;
      // Try exact match first
      const exactVal = doc.fields[displayName];
      if (exactVal !== undefined) return exactVal.value;

      // Try case-insensitive match
      for (const [key, val] of Object.entries(doc.fields)) {
        if (key.toLowerCase() === displayName.toLowerCase()) return val.value;
      }
    }
  }

  // 2. Fallback: direct key match
  for (const [key, val] of Object.entries(doc.fields)) {
    if (key.toLowerCase() === hint) return val.value;
  }

  // 3. Fallback: substring match
  for (const [key, val] of Object.entries(doc.fields)) {
    const lower = key.toLowerCase();
    if (lower.includes(hint) || hint.includes(lower)) return val.value;
  }

  // 4. Legacy alias fallback for any fields not yet in catalog
  const ALIASES: Record<string, string[]> = {
    cost_code: ['cost code', 'line item number', 'cost_code'],
    csi_division: ['csi division', 'csi_division', 'division'],
    co_number: ['change order number', 'co number', 'co_number', 'co #'],
    date: ['date', 'report date', 'inspection date', 'activity date', 'meeting date'],
    amount: ['amount', 'total', 'cost', 'budget', 'value', 'approved_amount'],
    rfi_number: ['rfi number', 'rfi_number', 'rfi #', 'rfi no'],
    spec_section: ['spec section', 'specification section', 'spec_section'],
    subcontractor: ['subcontractor', 'sub', 'vendor', 'contractor'],
    location: ['location', 'area', 'zone', 'site'],
    crew_data: ['crew', 'crew size', 'workers', 'headcount', 'crew_data'],
  };

  const aliases = ALIASES[hint] || [];
  for (const alias of aliases) {
    for (const [key, val] of Object.entries(doc.fields)) {
      if (key.toLowerCase().includes(alias)) return val.value;
    }
  }

  return null;
}

// ── Scoring ───────────────────────────────────────────────────

function scoreFieldMatch(
  source: PipelineDoc,
  target: PipelineDoc,
  matchFields: string[],
  fieldMap: Map<string, FieldMapping[]>,
): { totalScore: number; matchedOn: Record<string, { sourceValue: string; targetValue: string; score: number }> } {
  const matchedOn: Record<string, { sourceValue: string; targetValue: string; score: number }> = {};
  let totalScore = 0;
  let fieldsChecked = 0;

  for (const field of matchFields) {
    const sourceVal = getFieldValue(source, field, fieldMap);
    const targetVal = getFieldValue(target, field, fieldMap);

    if (sourceVal == null && targetVal == null) continue;
    fieldsChecked++;

    if (sourceVal == null || targetVal == null) {
      matchedOn[field] = {
        sourceValue: String(sourceVal ?? ''),
        targetValue: String(targetVal ?? ''),
        score: 0,
      };
      continue;
    }

    let score = 0;
    const isDateField = field.toLowerCase().includes('date');
    const sourceNum = extractNumeric(sourceVal);
    const targetNum = extractNumeric(targetVal);

    if (isDateField) {
      score = dateMatch(String(sourceVal), String(targetVal));
    } else if (sourceNum != null && targetNum != null) {
      score = numericMatch(sourceNum, targetNum);
    } else {
      score = fuzzyMatch(String(sourceVal), String(targetVal));
    }

    if (score > 0) {
      matchedOn[field] = {
        sourceValue: String(sourceVal),
        targetValue: String(targetVal),
        score,
      };
      totalScore += score;
    }
  }

  const normalizedScore = fieldsChecked > 0 ? totalScore / matchFields.length : 0;
  return { totalScore: normalizedScore, matchedOn };
}

// ── Main Entry Point ──────────────────────────────────────────

export async function runDocumentLinking(
  orgId: string,
  projectId?: string | null
): Promise<LinkResult> {
  const sb = getSupabase();
  const result: LinkResult = { linksCreated: 0, linksSkipped: 0, errors: [], candidates: [] };

  // Load field catalog mappings
  const fieldMap = await getFieldMap();

  const { data: linkTypes } = await sb
    .from('document_link_types')
    .select('*')
    .eq('is_active', true);

  if (!linkTypes || linkTypes.length === 0) {
    result.errors.push('No active link types found');
    return result;
  }

  let query = sb
    .from('pipeline_log')
    .select('id, org_id, project_id, file_name, extracted_data')
    .eq('org_id', orgId)
    .in('status', ['pending_review', 'tier2_validated', 'pushed'])
    .not('extracted_data', 'is', null);

  if (projectId) {
    query = query.eq('project_id', projectId);
  }

  const { data: pipelineDocs, error: pipelineError } = await query;

  if (pipelineError) {
    result.errors.push(`Failed to fetch pipeline docs: ${pipelineError.message}`);
    return result;
  }

  if (!pipelineDocs || pipelineDocs.length === 0) {
    result.errors.push('No processed documents found to link');
    return result;
  }

  const docs: PipelineDoc[] = pipelineDocs
    .filter((d: Record<string, unknown>) => {
      const ed = d.extracted_data as Record<string, unknown> | null;
      return ed?.skillId && ed?.fields;
    })
    .map((d: Record<string, unknown>) => {
      const ed = d.extracted_data as Record<string, unknown>;
      return {
        id: d.id as string,
        orgId: d.org_id as string,
        projectId: (d.project_id as string) || null,
        fileName: d.file_name as string,
        skillId: ed.skillId as string,
        fields: (ed.fields || {}) as Record<string, { value: string | number | null; confidence: number }>,
      };
    });

  const docsBySkill = new Map<string, PipelineDoc[]>();
  for (const doc of docs) {
    const existing = docsBySkill.get(doc.skillId) || [];
    existing.push(doc);
    docsBySkill.set(doc.skillId, existing);
  }

  const activeLinkTypes: LinkType[] = linkTypes.map((lt: Record<string, unknown>) => ({
    id: lt.id as string,
    linkTypeKey: lt.link_type_key as string,
    displayName: lt.display_name as string,
    sourceSkill: lt.source_skill as string,
    targetSkill: lt.target_skill as string,
    relationship: lt.relationship as string,
    matchFields: (lt.match_fields || []) as string[],
    description: (lt.description || '') as string,
  }));

  const MIN_CONFIDENCE = 0.3;

  for (const lt of activeLinkTypes) {
    const sourceDocs = docsBySkill.get(lt.sourceSkill) || [];
    const targetDocs = docsBySkill.get(lt.targetSkill) || [];

    if (sourceDocs.length === 0 || targetDocs.length === 0) continue;

    for (const source of sourceDocs) {
      for (const target of targetDocs) {
        if (source.id === target.id) continue;

        const { totalScore, matchedOn } = scoreFieldMatch(source, target, lt.matchFields, fieldMap);

        if (totalScore >= MIN_CONFIDENCE && Object.keys(matchedOn).length > 0) {
          result.candidates.push({
            sourceId: source.id,
            targetId: target.id,
            linkTypeId: lt.id,
            confidence: Math.round(totalScore * 100) / 100,
            matchedOn,
            notes: `${lt.displayName}: ${source.fileName} → ${target.fileName}`,
          });
        }
      }
    }
  }

  result.candidates.sort((a, b) => b.confidence - a.confidence);

  const { data: existingLinks } = await sb
    .from('document_links_v2')
    .select('source_record_id, target_record_id, link_type_id')
    .eq('org_id', orgId);

  const existingSet = new Set(
    (existingLinks || []).map((l: Record<string, unknown>) =>
      `${l.source_record_id}:${l.target_record_id}:${l.link_type_id}`
    )
  );

  for (const candidate of result.candidates) {
    const key = `${candidate.sourceId}:${candidate.targetId}:${candidate.linkTypeId}`;
    if (existingSet.has(key)) {
      result.linksSkipped++;
      continue;
    }

    const { error: insertError } = await sb.from('document_links_v2').insert({
      project_id: projectId || docs[0]?.projectId || '',
      org_id: orgId,
      source_record_id: candidate.sourceId,
      target_record_id: candidate.targetId,
      link_type_id: candidate.linkTypeId,
      confidence: candidate.confidence,
      method: 'auto',
      matched_on: candidate.matchedOn,
      notes: candidate.notes,
      created_by: 'system:linker',
    });

    if (insertError) {
      if (insertError.code === '23505') {
        result.linksSkipped++;
      } else {
        result.errors.push(`Insert failed for ${candidate.notes}: ${insertError.message}`);
      }
    } else {
      result.linksCreated++;
    }
  }

  return result;
}
