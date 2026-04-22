/**
 * JCR Model Engine — thin orchestrator.
 * Converts extracted JCR data into ExportRows via the generic derived-evaluator,
 * then writes them to computed_export.
 */

import { getSupabase } from './supabase';
import { evaluateDerivedFields, emitExtractedRows } from './derived-evaluator';
import type { ExportRow } from '@/types/export';

export type { ExportRow };

// ── Types (kept for backward compat with callers) ────────────

export interface ProjectMeta {
  unitCount?: number;
  fixtureCount?: number;
  durationMonths?: number;
  gcName?: string;
  location?: string;
  projectType?: string;
}

type FieldVal = { value: string | number | null; confidence: number };
type RecordRow = Record<string, FieldVal>;
type FieldsMap = Record<string, FieldVal>;

// ── Fix extraction column swap ──────────────────────────────
// The codegen extractor swaps jtd_cost and over_under_budget:
//   extracted jtd_cost       = actual plus_minus_budget (actual − budget)
//   extracted over_under_budget = actual jtd_cost (the real cost)
// We swap them back here so downstream derived fields work correctly.

function fixCostCodeColumnSwap(records: RecordRow[]): RecordRow[] {
  return records.map(rec => {
    const fixed = { ...rec };
    const jtdRaw = rec.jtd_cost;
    const ouRaw = rec.over_under_budget;
    if (jtdRaw && ouRaw) {
      fixed.jtd_cost = { value: ouRaw.value, confidence: ouRaw.confidence };
      // Recompute over_under as actual − budget (positive = over budget)
      const actual = (ouRaw.value as number) || 0;
      const budget = (fixed.revised_budget?.value as number) || 0;
      fixed.over_under_budget = {
        value: Math.round((actual - budget) * 100) / 100,
        confidence: ouRaw.confidence,
      };
    }
    const budget = (fixed.revised_budget?.value as number) || 0;
    const actual = (fixed.jtd_cost?.value as number) || 0;
    if (budget > 0) {
      fixed.pct_budget_consumed = { value: Math.round((actual / budget) * 10000) / 100, confidence: 0.9 };
    }
    return fixed;
  });
}

function fixDocLevelFields(fields: FieldsMap): FieldsMap {
  const fixed = { ...fields };

  // total_jtd_cost and overunder_budget_line are also swapped
  const jtdRaw = fields.total_jtd_cost;
  const ouRaw = fields.overunder_budget_line;
  if (jtdRaw && ouRaw) {
    fixed.total_jtd_cost = { value: ouRaw.value, confidence: ouRaw.confidence };
    fixed.overunder_budget_line = { value: jtdRaw.value, confidence: jtdRaw.confidence };
  }

  // Recompute overall_pct_budget_consumed with corrected values
  const budget = (fixed.total_revised_budget?.value as number) || 0;
  const actual = (fixed.total_jtd_cost?.value as number) || 0;
  if (budget > 0) {
    fixed.overall_pct_budget_consumed = { value: Math.round((actual / budget) * 10000) / 100, confidence: 0.9 };
  }

  return fixed;
}

// Compute PR/GL/AP source amounts from transactions and cost code data
function computeSourceAmounts(
  fields: FieldsMap,
  workerTransactions: RecordRow[],
  costCodeRecords: RecordRow[],
): FieldsMap {
  const fixed = { ...fields };

  // PR amount = sum of all payroll transaction actual_amount
  if (workerTransactions.length > 0) {
    const prTotal = workerTransactions.reduce(
      (s, t) => s + ((t.actual_amount?.value as number) || 0), 0,
    );
    fixed.pr_amount = { value: Math.round(prTotal * 100) / 100, confidence: 0.9 };
  }

  // Total direct cost is from total_jtd_cost (already swapped)
  const totalDirect = (fixed.total_jtd_cost?.value as number) || 0;
  const prAmt = (fixed.pr_amount?.value as number) || 0;
  const apAmt = (fixed.ap_amount?.value as number) || 0;

  // GL = total_direct - PR - AP (residual)
  if (totalDirect > 0) {
    const glCalc = Math.round((totalDirect - prAmt - apAmt) * 100) / 100;
    fixed.gl_amount = { value: glCalc, confidence: 0.85 };
  }

  return fixed;
}

// ── Aggregate payroll transactions into per-worker summaries ──

function aggregateWorkerRecords(transactions: RecordRow[]): RecordRow[] {
  const groups = new Map<string, RecordRow>();
  const costCodeSets = new Map<string, Set<string>>();

  const SUM_FIELDS = new Set([
    'regular_hours', 'overtime_hours', 'doubletime_hours',
    'actual_amount', 'regular_amount', 'overtime_amount', 'doubletime_amount',
  ]);

  for (const txn of transactions) {
    const workerName = String(txn.name?.value ?? 'unknown');
    const key = workerName;

    if (!groups.has(key)) {
      const seed: RecordRow = {};
      seed.name = { value: workerName, confidence: 0.9 };
      if (txn.source?.value) seed.source = { value: txn.source.value, confidence: 0.9 };
      for (const field of SUM_FIELDS) {
        seed[field] = { value: 0, confidence: 0.9 };
      }
      seed.transaction_count = { value: 0, confidence: 1 };
      groups.set(key, seed);
      costCodeSets.set(key, new Set());
    }

    const agg = groups.get(key)!;
    const codes = costCodeSets.get(key)!;

    if (txn.cost_code?.value) codes.add(String(txn.cost_code.value));

    for (const field of SUM_FIELDS) {
      const v = txn[field]?.value;
      if (v != null && typeof v === 'number') {
        (agg[field] as FieldVal).value = ((agg[field] as FieldVal).value as number) + v;
      }
    }
    (agg.transaction_count as FieldVal).value = ((agg.transaction_count as FieldVal).value as number) + 1;
  }

  const results: RecordRow[] = [];
  for (const [key, agg] of groups) {
    const regH = (agg.regular_hours?.value as number) || 0;
    const otH = (agg.overtime_hours?.value as number) || 0;
    const dtH = (agg.doubletime_hours?.value as number) || 0;
    const totalH = regH + otH + dtH;
    const wages = (agg.actual_amount?.value as number) || 0;
    const otA = (agg.overtime_amount?.value as number) || 0;
    const dtA = (agg.doubletime_amount?.value as number) || 0;
    const codes = costCodeSets.get(key)!;

    // regular_amount = total actual minus OT/DT amounts (includes burden)
    const regA = Math.round((wages - otA - dtA) * 100) / 100;
    agg.regular_amount = { value: regA, confidence: 0.9 };

    agg.worker_reg_hrs = { value: regH, confidence: 0.9 };
    agg.worker_ot_hrs = { value: otH, confidence: 0.9 };
    agg.worker_total_hrs = { value: totalH, confidence: 0.9 };
    agg.worker_wages = { value: wages, confidence: 0.9 };
    agg.worker_ot_pct = { value: totalH > 0 ? (otH / totalH) * 100 : 0, confidence: 0.9 };
    agg.worker_rate = { value: totalH > 0 ? wages / totalH : 0, confidence: 0.9 };
    agg.worker_nominal_rate = { value: regH > 0 ? regA / regH : 0, confidence: 0.9 };
    agg.worker_codes = { value: codes.size, confidence: 0.9 };

    results.push(agg);
  }

  return results;
}

// ── Orchestrator ─────────────────────────────────────────────

export async function runJcrModel(
  pipelineLogId: string,
  projectId: string,
  orgId: string,
  extractedData: { fields: FieldsMap; records: RecordRow[]; skillId?: string; workerRecords?: RecordRow[] },
  meta: ProjectMeta = {},
): Promise<{ runId: string; rowCount: number }> {
  const sb = getSupabase();
  const runId = crypto.randomUUID();
  const skillId = 'job_cost_report';

  console.log(`[jcr-model] Starting run=${runId} project=${projectId} pipeline_log=${pipelineLogId}`);

  const fixedFields = fixDocLevelFields(extractedData.fields);
  const fixedRecords = fixCostCodeColumnSwap(extractedData.records);
  const workerAgg = aggregateWorkerRecords(extractedData.workerRecords ?? []);

  // Compute corrected source amounts from PR transactions
  const finalFields = computeSourceAmounts(fixedFields, extractedData.workerRecords ?? [], fixedRecords);

  console.log(`[jcr-model] Fixed column swap for ${fixedRecords.length} cost codes, aggregated ${workerAgg.length} workers from ${extractedData.workerRecords?.length ?? 0} transactions`);

  const collections: Record<string, RecordRow[]> = {
    cost_code: fixedRecords,
    worker: workerAgg,
  };

  const extractedRows = emitExtractedRows(skillId, finalFields, collections);

  const derivedRows = await evaluateDerivedFields(
    skillId,
    { fields: finalFields, collections },
    meta as Record<string, unknown>,
  );

  const allRows = [...extractedRows, ...derivedRows];
  console.log(`[jcr-model] Generated ${allRows.length} export rows (${extractedRows.length} extracted, ${derivedRows.length} derived)`);

  await sb.from('computed_export').delete().eq('project_id', projectId).eq('org_id', orgId);

  const dbRows = allRows.map(r => ({
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
    value_text: r.value_text,
    value_number: r.value_number,
    notes: r.notes,
    confidence: 'Verified',
  }));

  for (let i = 0; i < dbRows.length; i += 100) {
    const batch = dbRows.slice(i, i + 100);
    const { error } = await sb.from('computed_export').insert(batch);
    if (error) {
      console.error(`[jcr-model] Insert batch ${i} failed:`, error.message);
    }
  }

  console.log(`[jcr-model] Done: run=${runId} rows=${allRows.length}`);
  return { runId, rowCount: allRows.length };
}
