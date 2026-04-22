/**
 * Generic derived-field evaluator.
 * Loads formula specs from derived_fields table, builds an evaluation context
 * from extracted data, topologically sorts by dependencies, and evaluates
 * each expression in a sandboxed Function constructor.
 *
 * NOT tied to any specific document type — works for JCR, change orders, POs, etc.
 */

import { getSupabase } from './supabase';
import type { ExportRow } from '@/types/export';

export type { ExportRow };

// ── Types ────────────────────────────────────────────────────

export interface DerivedFieldSpec {
  id: string;
  canonical_name: string;
  display_name: string;
  source_skill_ids: string[];
  primary_skill_id: string;
  tab: string;
  section: string;
  data_type: ExportRow['data_type'];
  status: ExportRow['status'];
  scope: string;
  formula: string;
  expression: string;
  depends_on: string[];
  is_active: boolean;
}

export interface EvalContext {
  doc: Record<string, number | string | null>;
  collections: Record<string, Record<string, number | string | null>[]>;
  current?: Record<string, number | string | null>;
  meta: Record<string, unknown>;
}

type RecordRow = Record<string, { value: string | number | null; confidence: number }>;

// ── Sandbox helpers exposed to expressions ───────────────────

function safe(
  first: number | null | undefined | (() => unknown),
  denominator?: number | null | undefined,
): number | null {
  // Overload 1: safe(() => expr) — try/catch wrapper, returns null on error or non-number
  if (typeof first === 'function') {
    try {
      const result = first();
      return typeof result === 'number' && Number.isFinite(result) ? result : null;
    } catch {
      return null;
    }
  }
  // Overload 2: safe(numerator, denominator) — guarded division
  if (first == null || denominator == null || denominator === 0) return null;
  return first / denominator;
}

function rd(n: number | null | undefined): number | null {
  if (n == null) return null;
  return Math.round(n * 100) / 100;
}

// ── Core evaluation ──────────────────────────────────────────

function topologicalSort(specs: DerivedFieldSpec[]): DerivedFieldSpec[] {
  const nameMap = new Map(specs.map(s => [s.canonical_name, s]));
  const visited = new Set<string>();
  const result: DerivedFieldSpec[] = [];

  function visit(name: string) {
    if (visited.has(name)) return;
    visited.add(name);
    const spec = nameMap.get(name);
    if (!spec) return;
    for (const dep of spec.depends_on) {
      visit(dep);
    }
    result.push(spec);
  }

  for (const spec of specs) {
    visit(spec.canonical_name);
  }

  return result;
}

type SafeFn = (first: number | null | undefined | (() => unknown), d?: number | null | undefined) => number | null;
type RdFn = (n: number | null | undefined) => number | null;

function createEvaluator(expression: string): (ctx: EvalContext, safeFn: SafeFn, rdFn: RdFn) => unknown {
  try {
    return new Function('ctx', 'safe', 'rd', `"use strict"; return (${expression})`) as
      (ctx: EvalContext, safeFn: SafeFn, rdFn: RdFn) => unknown;
  } catch (err) {
    console.error(`[derived-evaluator] Failed to compile expression: ${expression}`, err);
    return () => null;
  }
}

const STRING_FIELDS = new Set(['cost_code', 'description', 'cost_category', 'name', 'source', 'check_number', 'number']);

function flattenRecord(rec: RecordRow): Record<string, number | string | null> {
  const flat: Record<string, number | string | null> = {};
  for (const [key, field] of Object.entries(rec)) {
    if (!field?.value && field?.value !== 0) {
      flat[key] = null;
      continue;
    }
    if (STRING_FIELDS.has(key)) {
      flat[key] = String(field.value);
      continue;
    }
    if (typeof field.value === 'number') {
      flat[key] = field.value;
    } else {
      const cleaned = String(field.value).replace(/[$,%\s]/g, '');
      const n = parseFloat(cleaned);
      flat[key] = isNaN(n) ? String(field.value) : n;
    }
  }
  return flat;
}

// ── Public API ───────────────────────────────────────────────

export async function loadDerivedSpecs(skillId: string): Promise<DerivedFieldSpec[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('derived_fields')
    .select('*')
    .eq('primary_skill_id', skillId)
    .eq('is_active', true);

  if (error) {
    console.error(`[derived-evaluator] Failed to load specs for ${skillId}:`, error.message);
    return [];
  }
  return (data || []) as DerivedFieldSpec[];
}

export function buildContext(
  fields: Record<string, { value: string | number | null; confidence: number }>,
  collections: Record<string, RecordRow[]>,
  meta: Record<string, unknown> = {},
): EvalContext {
  const doc: Record<string, number | string | null> = {};
  for (const [key, field] of Object.entries(fields)) {
    if (!field?.value && field?.value !== 0) {
      doc[key] = null;
      continue;
    }
    if (typeof field.value === 'number') {
      doc[key] = field.value;
    } else {
      const cleaned = String(field.value).replace(/[$,%\s]/g, '');
      const n = parseFloat(cleaned);
      doc[key] = isNaN(n) ? String(field.value) : n;
    }
  }

  const flatCollections: Record<string, Record<string, number | string | null>[]> = {};
  for (const [name, rows] of Object.entries(collections)) {
    flatCollections[name] = rows.map(flattenRecord);
  }

  return { doc, collections: flatCollections, meta };
}

export async function evaluateDerivedFields(
  skillId: string,
  extractedData: {
    fields: Record<string, { value: string | number | null; confidence: number }>;
    collections: Record<string, RecordRow[]>;
  },
  meta: Record<string, unknown> = {},
): Promise<ExportRow[]> {
  const specs = await loadDerivedSpecs(skillId);
  if (specs.length === 0) {
    console.warn(`[derived-evaluator] No active derived_fields for skill=${skillId}`);
    return [];
  }

  const ctx = buildContext(extractedData.fields, extractedData.collections, meta);
  const sorted = topologicalSort(specs);
  const rows: ExportRow[] = [];

  for (const spec of sorted) {
    const evalFn = createEvaluator(spec.expression);

    try {
      if (spec.scope === 'doc') {
        const result = evalFn(ctx, safe, rd);
        const numVal = typeof result === 'number' ? rd(result) : null;
        const textVal = typeof result === 'string' ? result : null;

        ctx.doc[spec.canonical_name] = numVal ?? textVal;

        rows.push({
          skill_id: skillId,
          tab: spec.tab,
          section: spec.section,
          record_key: 'project',
          field: spec.canonical_name,
          canonical_name: spec.canonical_name,
          display_name: spec.display_name,
          data_type: spec.data_type,
          status: spec.status,
          value_number: numVal,
          value_text: textVal,
          notes: spec.formula,
        });
      } else {
        const collection = ctx.collections[spec.scope];
        if (!collection) {
          console.warn(`[derived-evaluator] No collection for scope=${spec.scope}, skipping ${spec.canonical_name}`);
          continue;
        }

        for (let i = 0; i < collection.length; i++) {
          const record = collection[i];
          ctx.current = record;

          const result = evalFn(ctx, safe, rd);
          const numVal = typeof result === 'number' ? rd(result) : null;
          const textVal = typeof result === 'string' ? result : null;

          record[spec.canonical_name] = numVal ?? textVal;

          const recordKey = String(record.cost_code || record.name || record.id || `${spec.scope}_${i}`);

          rows.push({
            skill_id: skillId,
            tab: spec.tab,
            section: spec.section,
            record_key: `${spec.scope}=${recordKey}`,
            field: spec.canonical_name,
            canonical_name: spec.canonical_name,
            display_name: spec.display_name,
            data_type: spec.data_type,
            status: spec.status,
            value_number: numVal,
            value_text: textVal,
            notes: spec.formula,
          });
        }

        ctx.current = undefined;
      }
    } catch (err) {
      console.error(`[derived-evaluator] Error evaluating ${spec.canonical_name}:`, err);
    }
  }

  console.log(`[derived-evaluator] Evaluated ${rows.length} derived rows for skill=${skillId}`);
  return rows;
}

/**
 * Emit ExportRow[] for extracted (non-derived) fields.
 * Pass-through from pipeline_log.extracted_data into computed_export format.
 */
export function emitExtractedRows(
  skillId: string,
  fields: Record<string, { value: string | number | null; confidence: number }>,
  collections: Record<string, RecordRow[]>,
): ExportRow[] {
  const rows: ExportRow[] = [];

  for (const [key, field] of Object.entries(fields)) {
    if (field.value == null) continue;
    const isNum = typeof field.value === 'number';
    rows.push({
      skill_id: skillId,
      tab: 'Overview',
      section: 'Extracted',
      record_key: 'project',
      field: key,
      canonical_name: key,
      display_name: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      data_type: isNum ? 'number' : 'string',
      status: 'Extracted',
      value_number: isNum ? (field.value as number) : null,
      value_text: isNum ? null : String(field.value),
      notes: null,
    });
  }

  for (const [collectionName, records] of Object.entries(collections)) {
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      const recKey = String(
        rec.cost_code?.value || rec.name?.value || rec.id?.value || `${collectionName}_${i}`
      );

      for (const [key, field] of Object.entries(rec)) {
        if (field.value == null) continue;
        const isNum = typeof field.value === 'number';
        rows.push({
          skill_id: skillId,
          tab: collectionName === 'cost_code' ? 'Budget vs Actual' : 'Crew Analytics',
          section: 'Extracted',
          record_key: `${collectionName}=${recKey}`,
          field: key,
          canonical_name: key,
          display_name: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          data_type: isNum ? 'number' : 'string',
          status: 'Extracted',
          value_number: isNum ? (field.value as number) : null,
          value_text: isNum ? null : String(field.value),
          notes: null,
        });
      }
    }
  }

  return rows;
}
