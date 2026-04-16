/**
 * Reconciliation Engine
 *
 * Compares data between linked document types using configurable rules.
 * Each rule specifies: which link type, which fields to compare, how to
 * aggregate (sum/count/latest/direct), and what tolerances are acceptable.
 *
 * Results are stored per (match_key_value, rule) with pass/warning/fail status.
 */

import { getSupabase } from './supabase';
import {
  getFieldMap as storeGetFieldMap,
  type FieldMapping,
} from './stores/field-catalog.store';

// ── Types ────────────────────────────────────────────────────

export interface ReconciliationRule {
  id: string;
  linkTypeKey: string;
  ruleName: string;
  description: string;
  sourceField: string;
  targetField: string;
  matchKey: string;
  aggregation: 'sum' | 'count' | 'latest' | 'direct';
  tolerancePct: number;
  toleranceAbs: number;
  severity: 'info' | 'warning' | 'error';
}

interface LinkType {
  sourceSkill: string;
  targetSkill: string;
}

interface DocRecord {
  id: string;
  fileName: string;
  skillId: string;
  fields: Record<string, { value: string | number | null; confidence: number }>;
  records?: Array<Record<string, { value: string | number | null; confidence: number }>>;
}

export interface ReconciliationCheck {
  ruleId: string;
  ruleName: string;
  matchKeyValue: string;
  sourceRecordId: string | null;
  targetRecordId: string | null;
  sourceValue: number | null;
  targetValue: number | null;
  difference: number | null;
  differencePct: number | null;
  status: 'pass' | 'warning' | 'fail' | 'no_match';
  message: string;
}

export interface ReconciliationRun {
  runId: string;
  projectId: string;
  orgId: string;
  totalChecks: number;
  passed: number;
  warnings: number;
  failures: number;
  noMatches: number;
  checks: ReconciliationCheck[];
  elapsedMs: number;
}

// ── Field Catalog Cache ──────────────────────────────────────

let _fieldMapCache: Map<string, FieldMapping[]> | null = null;
let _fieldMapCacheTime = 0;
const FIELD_MAP_TTL = 5 * 60 * 1000;

async function getFieldMap(): Promise<Map<string, FieldMapping[]>> {
  const now = Date.now();
  if (_fieldMapCache && now - _fieldMapCacheTime < FIELD_MAP_TTL) {
    return _fieldMapCache;
  }
  _fieldMapCache = await storeGetFieldMap();
  _fieldMapCacheTime = now;
  return _fieldMapCache;
}

// ── Field Resolution ─────────────────────────────────────────

function resolveFieldValue(
  doc: DocRecord,
  fieldName: string,
  fieldMap: Map<string, FieldMapping[]>,
): number | null {
  const hint = fieldName.toLowerCase();

  const skillMappings = fieldMap.get(doc.skillId);
  if (skillMappings) {
    const mapping = skillMappings.find(m => m.canonicalName === hint);
    if (mapping) {
      const displayName = mapping.displayOverride || mapping.catalogDisplayName;
      const val = doc.fields[displayName] ?? findFieldCI(doc.fields, displayName);
      if (val) return toNumeric(val.value);
    }
  }

  const direct = doc.fields[fieldName] ?? findFieldCI(doc.fields, fieldName);
  if (direct) return toNumeric(direct.value);

  for (const [key, val] of Object.entries(doc.fields)) {
    if (key.toLowerCase().includes(hint) || hint.includes(key.toLowerCase())) {
      return toNumeric(val.value);
    }
  }

  return null;
}

function resolveMatchKeyValue(
  doc: DocRecord,
  matchKey: string,
  fieldMap: Map<string, FieldMapping[]>,
): string | null {
  const hint = matchKey.toLowerCase();

  const skillMappings = fieldMap.get(doc.skillId);
  if (skillMappings) {
    const mapping = skillMappings.find(m => m.canonicalName === hint);
    if (mapping) {
      const displayName = mapping.displayOverride || mapping.catalogDisplayName;
      const val = doc.fields[displayName] ?? findFieldCI(doc.fields, displayName);
      if (val?.value != null) return String(val.value).toLowerCase().trim();
    }
  }

  const direct = doc.fields[matchKey] ?? findFieldCI(doc.fields, matchKey);
  if (direct?.value != null) return String(direct.value).toLowerCase().trim();

  for (const [key, val] of Object.entries(doc.fields)) {
    if (key.toLowerCase().includes(hint) || hint.includes(key.toLowerCase())) {
      if (val.value != null) return String(val.value).toLowerCase().trim();
    }
  }

  return null;
}

function findFieldCI(
  fields: Record<string, { value: string | number | null; confidence: number }>,
  name: string,
): { value: string | number | null; confidence: number } | undefined {
  const lower = name.toLowerCase();
  for (const [key, val] of Object.entries(fields)) {
    if (key.toLowerCase() === lower) return val;
  }
  return undefined;
}

function toNumeric(val: string | number | null | undefined): number | null {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  const str = String(val);
  // Handle labor hours format like "183.00 hours (Reg: 155.00, O/T: 28.00)"
  const hoursMatch = str.match(/([\d,.]+)\s*hours/i);
  if (hoursMatch) {
    const num = parseFloat(hoursMatch[1].replace(/,/g, ''));
    return isNaN(num) ? null : num;
  }
  const cleaned = str.replace(/[$,%\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// ── Aggregation ──────────────────────────────────────────────

function aggregate(
  values: number[],
  method: 'sum' | 'count' | 'latest' | 'direct',
): number | null {
  if (values.length === 0) return null;
  switch (method) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'count':
      return values.length;
    case 'latest':
      return values[values.length - 1];
    case 'direct':
      return values[0];
  }
}

// ── Comparison ───────────────────────────────────────────────

function compareValues(
  sourceVal: number | null,
  targetVal: number | null,
  rule: ReconciliationRule,
): Pick<ReconciliationCheck, 'status' | 'difference' | 'differencePct' | 'message'> {
  if (sourceVal == null && targetVal == null) {
    return { status: 'no_match', difference: null, differencePct: null, message: 'Both values are null' };
  }
  if (sourceVal == null) {
    return { status: 'no_match', difference: null, differencePct: null, message: `Source field "${rule.sourceField}" not found` };
  }
  if (targetVal == null) {
    return { status: 'no_match', difference: null, differencePct: null, message: `Target field "${rule.targetField}" not found` };
  }

  const diff = sourceVal - targetVal;
  const absDiff = Math.abs(diff);
  const base = Math.max(Math.abs(sourceVal), Math.abs(targetVal));
  const pct = base > 0 ? (absDiff / base) * 100 : (absDiff === 0 ? 0 : 100);

  const withinTolerance =
    absDiff <= rule.toleranceAbs || pct <= rule.tolerancePct;

  if (withinTolerance) {
    return {
      status: 'pass',
      difference: Math.round(diff * 100) / 100,
      differencePct: Math.round(pct * 100) / 100,
      message: `Within tolerance (${rule.tolerancePct}% / $${rule.toleranceAbs})`,
    };
  }

  const status = rule.severity === 'error' ? 'fail' : 'warning';
  return {
    status,
    difference: Math.round(diff * 100) / 100,
    differencePct: Math.round(pct * 100) / 100,
    message: `Difference of ${Math.round(pct)}% ($${Math.round(absDiff).toLocaleString()}) exceeds tolerance`,
  };
}

// ── Main Entry Point ─────────────────────────────────────────

export async function reconcileProject(
  projectId: string,
  orgId: string,
): Promise<ReconciliationRun> {
  const t0 = Date.now();
  const sb = getSupabase();
  const runId = crypto.randomUUID();

  console.log(`[reconciliation] Starting run=${runId} project=${projectId} org=${orgId}`);

  const { data: rulesData } = await sb
    .from('reconciliation_rules')
    .select('*')
    .eq('is_active', true);

  if (!rulesData || rulesData.length === 0) {
    console.log('[reconciliation] No active rules found');
    return { runId, projectId, orgId, totalChecks: 0, passed: 0, warnings: 0, failures: 0, noMatches: 0, checks: [], elapsedMs: Date.now() - t0 };
  }

  const rules: ReconciliationRule[] = rulesData.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    linkTypeKey: r.link_type_key as string,
    ruleName: r.rule_name as string,
    description: r.description as string,
    sourceField: r.source_field as string,
    targetField: r.target_field as string,
    matchKey: r.match_key as string,
    aggregation: r.aggregation as 'sum' | 'count' | 'latest' | 'direct',
    tolerancePct: Number(r.tolerance_pct) || 0,
    toleranceAbs: Number(r.tolerance_abs) || 0,
    severity: r.severity as 'info' | 'warning' | 'error',
  }));

  const { data: linkTypesData } = await sb
    .from('document_link_types')
    .select('link_type_key, source_skill, target_skill')
    .eq('is_active', true);

  const linkTypeMap = new Map<string, LinkType>();
  for (const lt of (linkTypesData || [])) {
    linkTypeMap.set(lt.link_type_key as string, {
      sourceSkill: lt.source_skill as string,
      targetSkill: lt.target_skill as string,
    });
  }

  const { data: pipelineDocs } = await sb
    .from('pipeline_log')
    .select('id, file_name, extracted_data')
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .in('status', ['pending_review', 'tier2_validated', 'approved', 'queued'])
    .not('extracted_data', 'is', null);

  if (!pipelineDocs || pipelineDocs.length === 0) {
    console.log('[reconciliation] No documents found for project');
    return { runId, projectId, orgId, totalChecks: 0, passed: 0, warnings: 0, failures: 0, noMatches: 0, checks: [], elapsedMs: Date.now() - t0 };
  }

  const docs: DocRecord[] = pipelineDocs
    .filter((d: Record<string, unknown>) => {
      const ed = d.extracted_data as Record<string, unknown> | null;
      return ed?.skillId && ed?.fields;
    })
    .map((d: Record<string, unknown>) => {
      const ed = d.extracted_data as Record<string, unknown>;
      return {
        id: d.id as string,
        fileName: d.file_name as string,
        skillId: ed.skillId as string,
        fields: (ed.fields || {}) as Record<string, { value: string | number | null; confidence: number }>,
        records: (ed.records || undefined) as Array<Record<string, { value: string | number | null; confidence: number }>> | undefined,
      };
    });

  const docsBySkill = new Map<string, DocRecord[]>();
  for (const doc of docs) {
    const existing = docsBySkill.get(doc.skillId) || [];
    existing.push(doc);

    // For multi-record documents (like JCR), also create per-record DocRecords
    // so reconciliation can match individual line items by cost code
    if (doc.records && doc.records.length > 0) {
      for (const rec of doc.records) {
        existing.push({
          id: doc.id,
          fileName: doc.fileName,
          skillId: doc.skillId,
          fields: rec,
        });
      }
    }

    docsBySkill.set(doc.skillId, existing);
  }

  const fieldMap = await getFieldMap();
  const allChecks: ReconciliationCheck[] = [];

  for (const rule of rules) {
    const lt = linkTypeMap.get(rule.linkTypeKey);
    if (!lt) {
      console.warn(`[reconciliation] Link type "${rule.linkTypeKey}" not found for rule "${rule.ruleName}"`);
      continue;
    }

    const sourceDocs = docsBySkill.get(lt.sourceSkill) || [];
    const targetDocs = docsBySkill.get(lt.targetSkill) || [];

    if (sourceDocs.length === 0 || targetDocs.length === 0) {
      allChecks.push({
        ruleId: rule.id,
        ruleName: rule.ruleName,
        matchKeyValue: '*',
        sourceRecordId: null,
        targetRecordId: null,
        sourceValue: null,
        targetValue: null,
        difference: null,
        differencePct: null,
        status: 'no_match',
        message: `No ${sourceDocs.length === 0 ? 'source' : 'target'} documents for skill "${sourceDocs.length === 0 ? lt.sourceSkill : lt.targetSkill}"`,
      });
      continue;
    }

    if (rule.aggregation === 'direct') {
      for (const src of sourceDocs) {
        const srcMatchKey = resolveMatchKeyValue(src, rule.matchKey, fieldMap);
        const srcValue = resolveFieldValue(src, rule.sourceField, fieldMap);

        let bestTarget: DocRecord | null = null;
        let bestTargetValue: number | null = null;

        for (const tgt of targetDocs) {
          const tgtMatchKey = resolveMatchKeyValue(tgt, rule.matchKey, fieldMap);
          if (srcMatchKey && tgtMatchKey && srcMatchKey === tgtMatchKey) {
            bestTarget = tgt;
            bestTargetValue = resolveFieldValue(tgt, rule.targetField, fieldMap);
            break;
          }
        }

        if (!bestTarget && targetDocs.length === 1) {
          bestTarget = targetDocs[0];
          bestTargetValue = resolveFieldValue(bestTarget, rule.targetField, fieldMap);
        }

        const comparison = compareValues(srcValue, bestTargetValue, rule);
        allChecks.push({
          ruleId: rule.id,
          ruleName: rule.ruleName,
          matchKeyValue: srcMatchKey || src.fileName,
          sourceRecordId: src.id,
          targetRecordId: bestTarget?.id || null,
          sourceValue: srcValue,
          targetValue: bestTargetValue,
          ...comparison,
        });
      }
    } else {
      const sourceByKey = new Map<string, number[]>();
      const sourceDocByKey = new Map<string, string>();
      for (const src of sourceDocs) {
        const key = resolveMatchKeyValue(src, rule.matchKey, fieldMap) || '__all__';
        const val = resolveFieldValue(src, rule.sourceField, fieldMap);
        if (val != null) {
          const arr = sourceByKey.get(key) || [];
          arr.push(val);
          sourceByKey.set(key, arr);
          if (!sourceDocByKey.has(key)) sourceDocByKey.set(key, src.id);
        }
      }

      const targetByKey = new Map<string, number[]>();
      const targetDocByKey = new Map<string, string>();
      for (const tgt of targetDocs) {
        const key = resolveMatchKeyValue(tgt, rule.matchKey, fieldMap) || '__all__';
        const val = resolveFieldValue(tgt, rule.targetField, fieldMap);
        if (val != null) {
          const arr = targetByKey.get(key) || [];
          arr.push(val);
          targetByKey.set(key, arr);
          if (!targetDocByKey.has(key)) targetDocByKey.set(key, tgt.id);
        }
      }

      const allKeys = new Set([...sourceByKey.keys(), ...targetByKey.keys()]);
      for (const key of allKeys) {
        const srcValues = sourceByKey.get(key) || [];
        const tgtValues = targetByKey.get(key) || [];
        const srcAgg = aggregate(srcValues, rule.aggregation);
        const tgtAgg = aggregate(tgtValues, rule.aggregation);

        const comparison = compareValues(srcAgg, tgtAgg, rule);
        allChecks.push({
          ruleId: rule.id,
          ruleName: rule.ruleName,
          matchKeyValue: key === '__all__' ? '*' : key,
          sourceRecordId: sourceDocByKey.get(key) || null,
          targetRecordId: targetDocByKey.get(key) || null,
          sourceValue: srcAgg,
          targetValue: tgtAgg,
          ...comparison,
        });
      }
    }
  }

  // Filter out noise: skip checks where both values are null (no data to compare)
  const meaningfulChecks = allChecks.filter(c =>
    c.sourceValue != null || c.targetValue != null || c.message.startsWith('No ')
  );

  const resultsToInsert = meaningfulChecks.map(c => ({
    org_id: orgId,
    project_id: projectId,
    rule_id: c.ruleId,
    match_key_value: c.matchKeyValue,
    source_record_id: c.sourceRecordId,
    target_record_id: c.targetRecordId,
    source_value: c.sourceValue,
    target_value: c.targetValue,
    difference: c.difference,
    difference_pct: c.differencePct,
    status: c.status,
    message: c.message,
    run_id: runId,
  }));

  if (resultsToInsert.length > 0) {
    for (let i = 0; i < resultsToInsert.length; i += 100) {
      const batch = resultsToInsert.slice(i, i + 100);
      const { error } = await sb.from('reconciliation_results').insert(batch);
      if (error) {
        console.error(`[reconciliation] Failed to insert batch:`, error.message);
      }
    }
  }

  const passed = meaningfulChecks.filter(c => c.status === 'pass').length;
  const warnings = meaningfulChecks.filter(c => c.status === 'warning').length;
  const failures = meaningfulChecks.filter(c => c.status === 'fail').length;
  const noMatches = meaningfulChecks.filter(c => c.status === 'no_match').length;

  console.log(
    `[reconciliation] Run complete: run=${runId} checks=${meaningfulChecks.length} ` +
    `pass=${passed} warn=${warnings} fail=${failures} no_match=${noMatches} ` +
    `elapsed=${Date.now() - t0}ms`
  );

  return {
    runId,
    projectId,
    orgId,
    totalChecks: meaningfulChecks.length,
    passed,
    warnings,
    failures,
    noMatches,
    checks: meaningfulChecks,
    elapsedMs: Date.now() - t0,
  };
}
