/**
 * Generic Skill Pipeline Runner.
 * Orchestrates post-extraction transforms, derived field evaluation,
 * consistency checks, and export — fully schema-driven with no
 * skill-specific hardcoding.
 *
 * Replaces jcr-model.ts for all document types.
 */

import { getSupabase } from './supabase';
import {
  evaluateAndMerge,
  emitExtractedRows,
} from './derived-evaluator';
import {
  type CheckResult,
} from './consistency-evaluator';
import { runPostExtractionValidation } from './post-extraction-validator';
import type { PatternParserMeta } from './pattern-extractor';
import type { ExtractionFile } from './sandbox';

// ── Types ────────────────────────────────────────────────────

type FieldVal = { value: string | number | null; confidence: number };
type RecordRow = Record<string, FieldVal>;
type FieldsMap = Record<string, FieldVal>;

type CodeRangeEntry = number | [number, number];
interface CodeRanges {
  revenue?: CodeRangeEntry[];
  labor?: CodeRangeEntry[];
  material?: CodeRangeEntry[];
  burden?: CodeRangeEntry[];
  subcontract?: CodeRangeEntry[];
  [key: string]: CodeRangeEntry[] | undefined;
}

interface PipelineOp {
  id: string;
  skill_id: string;
  op_name: string;
  op_type: string;
  scope: string;
  target_collection: string | null;
  config: Record<string, unknown>;
  priority: number;
}

export interface SkillPipelineResult {
  runId: string;
  rowCount: number;
  reconciliationScore: number;
  identityScore: number;
  qualityScore: number;
  checkResults: CheckResult[];
}

interface PipelineOptions {
  tailText?: string;
  sourceText?: string;
  generatedCode?: string;
  formatFingerprint?: string;
  usedCachedParserId?: string;
  patternMeta?: PatternParserMeta;
  agentMeta?: { parser_type: 'agent'; confirmed_absent: string[]; agent_tool_calls: number; composite_score: number };
  pages?: string[];
  inputFiles?: ExtractionFile[];
}

// ── Helpers ──────────────────────────────────────────────────

function codeInRanges(code: number, ranges: CodeRangeEntry[]): boolean {
  for (const entry of ranges) {
    if (typeof entry === 'number') {
      if (code === entry) return true;
    } else if (Array.isArray(entry) && entry.length === 2) {
      if (code >= entry[0] && code <= entry[1]) return true;
    }
  }
  return false;
}

// ── Pipeline Ops Execution ───────────────────────────────────

async function loadPipelineOps(skillId: string): Promise<PipelineOp[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('skill_pipeline_ops')
    .select('*')
    .eq('skill_id', skillId)
    .eq('is_active', true)
    .order('priority', { ascending: true });

  if (error) {
    console.error(`[skill-pipeline] Failed to load ops for ${skillId}:`, error.message);
    return [];
  }
  return (data || []) as PipelineOp[];
}

function executeColumnSwap(
  records: RecordRow[],
  config: Record<string, unknown>,
): RecordRow[] {
  const fieldA = config.field_a as string;
  const fieldB = config.field_b as string;
  const detection = config.detection as string;

  if (detection === 'majority_abs_greater') {
    let swappedCount = 0;
    let totalChecked = 0;
    for (const rec of records) {
      const a = rec[fieldA]?.value as number | null;
      const b = rec[fieldB]?.value as number | null;
      if (a != null && b != null) {
        totalChecked++;
        if (Math.abs(b) > Math.abs(a)) swappedCount++;
      }
    }
    if (totalChecked === 0 || swappedCount / totalChecked < 0.5) {
      return records;
    }
  }

  console.log(`[skill-pipeline] Applying column_swap: ${fieldA} <-> ${fieldB}`);
  const swapped = records.map(rec => {
    const newRec = { ...rec };
    const aVal = rec[fieldA];
    const bVal = rec[fieldB];
    newRec[fieldA] = bVal ? { ...bVal } : { value: null, confidence: 0 };
    newRec[fieldB] = aVal ? { ...aVal } : { value: null, confidence: 0 };

    const recompute = config.recompute_after_swap as Record<string, string> | undefined;
    if (recompute) {
      for (const [field, expr] of Object.entries(recompute)) {
        try {
          const ctx = Object.fromEntries(
            Object.entries(newRec).map(([k, v]) => [k, v?.value ?? null])
          );
          const fn = new Function('ctx', `"use strict"; return (${expr.replace(/(\w+)/g, 'ctx.$1')})`);
          const result = fn(ctx);
          if (typeof result === 'number' && Number.isFinite(result)) {
            newRec[field] = { value: Math.round(result * 100) / 100, confidence: 0.8 };
          }
        } catch { /* skip recompute on error */ }
      }
    }
    return newRec;
  });

  return swapped;
}

function executeAggregate(
  sourceRecords: RecordRow[],
  config: Record<string, unknown>,
): RecordRow[] {
  const groupBy = (config.group_by as string[]) || ['name'];
  const nameAliases = (config.name_aliases as string[]) || [];
  const aggregations = (config.aggregations as Record<string, string>) || {};
  const computedFields = (config.computed_fields as Record<string, string>) || {};
  const reversalDetection = config.reversal_detection as { indicator_field: string; indicator_condition: string; negate_fields: string[] } | undefined;
  const filter = config.filter as { field: string; operator: string; value: string | number } | { field: string; operator: string; value: string | number }[] | undefined;

  let records = sourceRecords;
  if (filter) {
    const filters = Array.isArray(filter) ? filter : [filter];
    records = sourceRecords.filter(rec => {
      return filters.every(f => {
        const rawVal = rec[f.field]?.value;
        const fieldVal = String(rawVal ?? '').toUpperCase();
        const target = String(f.value).toUpperCase();
        switch (f.operator) {
          case '==': return fieldVal === target;
          case '!=': return fieldVal !== target;
          case 'in': return target.split(',').map(s => s.trim()).includes(fieldVal);
          case '<': return Number(rawVal ?? 0) < Number(f.value);
          case '>': return Number(rawVal ?? 0) > Number(f.value);
          case '<=': return Number(rawVal ?? 0) <= Number(f.value);
          case '>=': return Number(rawVal ?? 0) >= Number(f.value);
          default: return true;
        }
      });
    });
    const desc = filters.map(f => `${f.field} ${f.operator} ${f.value}`).join(' AND ');
    console.log(`[skill-pipeline] Aggregate filter: ${desc} → ${records.length}/${sourceRecords.length} records`);
  }

  const resolveGroupKey = (rec: RecordRow): string => {
    for (const field of [...groupBy, ...nameAliases]) {
      const val = rec[field]?.value;
      if (val != null && val !== '') return String(val).trim().toLowerCase();
    }
    return '<unknown>';
  };

  const groups = new Map<string, RecordRow[]>();
  for (const rec of records) {
    const key = resolveGroupKey(rec);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(rec);
  }

  const result: RecordRow[] = [];
  for (const [groupKey, recs] of groups.entries()) {
    const agg: RecordRow = {};

    const firstName = groupBy[0] || 'name';
    const displayName = recs[0][firstName]?.value
      ?? recs[0][nameAliases.find(a => recs[0][a]?.value != null) ?? '']?.value
      ?? groupKey;
    agg.name = { value: displayName, confidence: 1 };

    for (const [field, op] of Object.entries(aggregations)) {
      if (op === 'SUM') {
        let sum = 0;
        for (const rec of recs) {
          let val = (rec[field]?.value as number) || 0;
          if (reversalDetection) {
            const indicatorVal = (rec[reversalDetection.indicator_field]?.value as number) || 0;
            const isReversal = reversalDetection.indicator_condition === '< 0' && indicatorVal < 0;
            if (isReversal && reversalDetection.negate_fields.includes(field) && val > 0) {
              val = -val;
            }
          }
          sum += val;
        }
        agg[field] = { value: Math.round(sum * 100) / 100, confidence: 0.9 };
      }
    }

    for (const [field, expr] of Object.entries(computedFields)) {
      if (expr === 'COUNT') {
        agg[field] = { value: recs.length, confidence: 1 };
      } else if (expr.startsWith('COUNT_DISTINCT(')) {
        const innerField = expr.slice(15, -1);
        const unique = new Set(recs.map(r => String(r[innerField]?.value ?? '')).filter(Boolean));
        agg[field] = { value: unique.size, confidence: 1 };
      } else {
        try {
          const ctx = Object.fromEntries(
            Object.entries(agg).map(([k, v]) => [k, v?.value ?? 0])
          );
          const safeExpr = expr.replace(/safe\(([^,]+),\s*([^)]+)\)/g, '(($2) !== 0 ? ($1) / ($2) : 0)');
          const fn = new Function('ctx', `"use strict"; const {${Object.keys(ctx).join(',')}} = ctx; return (${safeExpr})`);
          const val = fn(ctx);
          agg[field] = { value: typeof val === 'number' && Number.isFinite(val) ? Math.round(val * 100) / 100 : null, confidence: 0.8 };
        } catch {
          agg[field] = { value: null, confidence: 0 };
        }
      }
    }

    result.push(agg);
  }

  return result;
}

function executePipelineOps(
  ops: PipelineOp[],
  collections: Record<string, RecordRow[]>,
): Record<string, RecordRow[]> {
  const result = { ...collections };

  for (const op of ops) {
    try {
      switch (op.op_type) {
        case 'column_swap': {
          const scope = op.scope;
          if (result[scope]) {
            result[scope] = executeColumnSwap(result[scope], op.config);
          }
          break;
        }
        case 'aggregate': {
          const source = op.scope;
          const target = op.target_collection || source;
          if (result[source]) {
            const aggregated = executeAggregate(result[source], op.config);
            result[target] = aggregated;
            console.log(`[skill-pipeline] Aggregated ${result[source].length} ${source} → ${aggregated.length} ${target}`);
          }
          break;
        }
        default:
          console.warn(`[skill-pipeline] Unknown op_type=${op.op_type} for op=${op.op_name}`);
      }
    } catch (err) {
      console.error(`[skill-pipeline] Error executing op=${op.op_name}:`, err);
    }
  }

  return result;
}

// ── Config Loading ───────────────────────────────────────────

async function loadSkillConfig(skillId: string, orgId?: string): Promise<{ codeRanges: CodeRanges }> {
  const sb = getSupabase();

  let codeRanges: CodeRanges = {};

  const { data: skillRow } = await sb
    .from('document_skills')
    .select('code_ranges')
    .eq('skill_id', skillId)
    .maybeSingle();

  if (skillRow?.code_ranges) {
    codeRanges = skillRow.code_ranges as CodeRanges;
  }

  if (orgId) {
    const { data: orgConfig } = await sb
      .from('org_skill_configs')
      .select('code_ranges')
      .eq('org_id', orgId)
      .eq('skill_id', skillId)
      .maybeSingle();

    if (orgConfig?.code_ranges) {
      codeRanges = { ...codeRanges, ...(orgConfig.code_ranges as CodeRanges) };
    }
  }

  return { codeRanges };
}

// ── Main Pipeline ────────────────────────────────────────────

export async function runSkillPipeline(
  pipelineLogId: string,
  projectId: string,
  orgId: string,
  skillId: string,
  extractedData: {
    fields: FieldsMap;
    collections: Record<string, RecordRow[]>;
  },
  options?: PipelineOptions,
): Promise<SkillPipelineResult> {
  const sb = getSupabase();
  const runId = crypto.randomUUID();

  console.log(`[skill-pipeline] Starting run=${runId} skill=${skillId} project=${projectId} pipeline_log=${pipelineLogId}`);

  // 1. Load skill config (code_ranges with org override)
  const { codeRanges } = await loadSkillConfig(skillId, orgId);
  const meta: Record<string, unknown> = { code_ranges: codeRanges };

  // 2. Load and execute pipeline ops (transforms, aggregations)
  const ops = await loadPipelineOps(skillId);
  const transformedCollections = executePipelineOps(ops, extractedData.collections);

  console.log(
    `[skill-pipeline] Executed ${ops.length} pipeline ops. Collections: ` +
    Object.entries(transformedCollections).map(([k, v]) => `${k}=${v.length}`).join(', ')
  );

  // 3. Evaluate derived fields (first pass — before checks)
  const { derivedRows, derivedFieldNames, ctx } = await evaluateAndMerge(
    skillId,
    extractedData.fields,
    transformedCollections,
    meta,
  );

  // Inject doc-scoped derived values into fields so consistency checks can reference them
  // Derived values always override raw extracted values for fields declared as derived
  const fieldsWithDerived: FieldsMap = { ...extractedData.fields };
  for (const [key, val] of Object.entries(ctx.doc)) {
    if (derivedFieldNames.has(key) && val != null) {
      fieldsWithDerived[key] = {
        value: val,
        confidence: 0.9,
      };
    }
  }

  // 4. Run post-extraction validation (consistency checks + auto-fix)
  const validation = await runPostExtractionValidation({
    pipelineLogId,
    skillId,
    fields: fieldsWithDerived,
    collections: transformedCollections,
    meta,
    tailText: options?.tailText,
    sourceText: options?.sourceText,
    generatedCode: options?.generatedCode,
    formatFingerprint: options?.formatFingerprint,
    usedCachedParserId: options?.usedCachedParserId,
    patternMeta: options?.patternMeta,
    agentMeta: options?.agentMeta,
    pages: options?.pages,
    inputFiles: options?.inputFiles,
  });

  const { withheldFields, anomalyFields, checkResults, reconciliationScore, identityScore, qualityScore } = validation;

  // Apply corrections from validation
  let correctedFields = fieldsWithDerived;
  if (validation.correctedFields) {
    correctedFields = { ...fieldsWithDerived };
    for (const [field, val] of Object.entries(validation.correctedFields)) {
      if (val && correctedFields[field] && val.value !== correctedFields[field].value) {
        console.log(`[skill-pipeline] Applying correction: ${field}: ${correctedFields[field].value} → ${val.value}`);
        correctedFields[field] = val;
      }
    }
  }

  // 5. Re-evaluate derived fields after corrections
  let finalDerivedRows = derivedRows;
  let finalDerivedFieldNames = derivedFieldNames;
  const hasActualCorrections = validation.correctedFields &&
    Object.entries(validation.correctedFields).some(([field, val]) =>
      val && fieldsWithDerived[field] && val.value !== fieldsWithDerived[field].value
    );

  if (hasActualCorrections) {
    const reEval = await evaluateAndMerge(skillId, correctedFields, transformedCollections, meta);
    finalDerivedRows = reEval.derivedRows;
    finalDerivedFieldNames = reEval.derivedFieldNames;
    console.log(`[skill-pipeline] Re-evaluated derived fields after corrections: ${finalDerivedRows.length} rows`);
  }

  // Debug: log key derived values before persistence
  const keyDerived = finalDerivedRows.filter(r =>
    ['pr_amount', 'ap_amount', 'gl_amount'].includes(r.canonical_name)
  );
  if (keyDerived.length > 0) {
    console.log(`[skill-pipeline] Derived field values for persistence:`,
      keyDerived.map(r => `${r.canonical_name}=${r.value_number}`).join(', ')
    );
  }

  // 6. Emit extracted rows (excluding derived field names to prevent double-counting)
  const extractedRows = emitExtractedRows(skillId, correctedFields, transformedCollections);
  const filteredExtracted = extractedRows.filter(r => !finalDerivedFieldNames.has(r.canonical_name));

  const allRows = [...filteredExtracted, ...finalDerivedRows];
  console.log(
    `[skill-pipeline] Generated ${allRows.length} export rows ` +
    `(${filteredExtracted.length} extracted, ${finalDerivedRows.length} derived)`
  );

  // 7. Write to computed_export
  // Strategy: find the current "good" run_id (if any), insert new rows,
  // then swap by deleting the old run. If we timeout mid-insert, the next
  // run will detect orphaned rows (multiple run_ids) and clean them up.

  // Clean up orphaned rows from any previously failed/partial runs
  const { data: existingRuns } = await sb
    .from('computed_export')
    .select('run_id')
    .eq('project_id', projectId)
    .eq('org_id', orgId)
    .limit(1);
  const previousRunId = existingRuns?.[0]?.run_id;

  // If there are multiple run_ids, a prior run failed mid-write — clean up non-primary
  if (previousRunId) {
    await sb.from('computed_export')
      .delete()
      .eq('project_id', projectId)
      .eq('org_id', orgId)
      .neq('run_id', previousRunId);
  }

  const dbRows = allRows.map(r => {
    let confidence = 'Verified';
    const scopedKey = `${r.record_key}:${r.field}`;
    if (withheldFields.has(scopedKey) || withheldFields.has(r.field)) {
      confidence = 'Withheld';
    } else if (anomalyFields.has(r.field)) {
      confidence = 'Anomaly';
    }

    return {
      org_id: orgId,
      project_id: projectId,
      run_id: runId,
      pipeline_log_id: pipelineLogId,
      skill_id: r.skill_id,
      tab: r.tab,
      section: r.section,
      record_key: r.record_key,
      field: r.field,
      canonical_name: r.canonical_name,
      display_name: r.display_name,
      data_type: r.data_type,
      status: r.status,
      value_text: confidence === 'Withheld' ? null : r.value_text,
      value_number: confidence === 'Withheld' ? null : r.value_number,
      notes: r.notes,
      confidence,
    };
  });

  let insertSuccess = true;
  for (let i = 0; i < dbRows.length; i += 500) {
    const batch = dbRows.slice(i, i + 500);
    const { error } = await sb.from('computed_export').insert(batch);
    if (error) {
      console.error(`[skill-pipeline] Insert batch ${i} failed:`, error.message);
      insertSuccess = false;
      break;
    }
  }

  if (insertSuccess) {
    // All inserts succeeded — remove old run's rows
    if (previousRunId && previousRunId !== runId) {
      await sb.from('computed_export')
        .delete()
        .eq('project_id', projectId)
        .eq('org_id', orgId)
        .eq('run_id', previousRunId);
    }
  } else {
    // Insert failed — rollback partial new rows, old data remains intact
    await sb.from('computed_export')
      .delete()
      .eq('project_id', projectId)
      .eq('run_id', runId);
  }

  console.log(`[skill-pipeline] Done: run=${runId} rows=${allRows.length} identity=${identityScore}% quality=${qualityScore}%`);
  return { runId, rowCount: allRows.length, reconciliationScore, identityScore, qualityScore, checkResults };
}
