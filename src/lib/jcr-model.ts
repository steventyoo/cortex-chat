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

// Schema-driven code range definitions loaded from document_skills.code_ranges
type CodeRangeEntry = number | [number, number];
interface CodeRanges {
  revenue?: CodeRangeEntry[];
  labor?: CodeRangeEntry[];
  material?: CodeRangeEntry[];
  burden?: CodeRangeEntry[];
  gl_overhead?: CodeRangeEntry[];
  subcontract?: CodeRangeEntry[];
  [key: string]: CodeRangeEntry[] | undefined;
}

const DEFAULT_CODE_RANGES: CodeRanges = {
  revenue: [999],
  labor: [11, [100, 199]],
  material: [39, [200, 299]],
  burden: [995, 998],
  gl_overhead: [11, 100],
  subcontract: [[600, 699]],
};

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

// ── Fix extraction column swap (auto-detecting) ─────────────
// Some extractions swap jtd_cost and over_under_budget.
// Heuristic: if abs(jtd_cost) < abs(over_under_budget) for the majority
// of records, the columns are swapped and need fixing.

function fixCostCodeColumnSwap(records: RecordRow[]): RecordRow[] {
  // Detect whether columns are swapped by checking the majority pattern.
  // Costs (jtd_cost) are generally larger in absolute value than variances.
  let swappedCount = 0;
  let totalChecked = 0;
  for (const rec of records) {
    const jtd = rec.jtd_cost?.value as number | null;
    const ou = rec.over_under_budget?.value as number | null;
    if (jtd != null && ou != null) {
      totalChecked++;
      if (Math.abs(ou) > Math.abs(jtd)) swappedCount++;
    }
  }

  const needsSwap = totalChecked > 0 && swappedCount > totalChecked / 2;

  return records.map(rec => {
    const fixed = { ...rec };
    const jtdRaw = rec.jtd_cost;
    const ouRaw = rec.over_under_budget;

    if (needsSwap && jtdRaw && ouRaw) {
      fixed.jtd_cost = { value: ouRaw.value, confidence: ouRaw.confidence };
      const actual = (ouRaw.value as number) || 0;
      const budget = (fixed.revised_budget?.value as number) || 0;
      fixed.over_under_budget = {
        value: Math.round((actual - budget) * 100) / 100,
        confidence: ouRaw.confidence,
      };
    } else if (!needsSwap && jtdRaw) {
      // Columns are correct — just recompute over_under for consistency
      const actual = (jtdRaw.value as number) || 0;
      const budget = (fixed.revised_budget?.value as number) || 0;
      fixed.over_under_budget = {
        value: Math.round((actual - budget) * 100) / 100,
        confidence: jtdRaw.confidence,
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

function fixDocLevelFields(fields: FieldsMap, costCodeRecords: RecordRow[], codeRanges: CodeRanges): FieldsMap {
  const fixed = { ...fields };

  // Compute authoritative doc-level totals from cost-code sums,
  // excluding revenue codes defined in the skill's code_ranges.
  const revRanges = codeRanges.revenue ?? [999];
  let budgetSum = 0;
  let jtdSum = 0;
  let revenueFromCodes = 0;
  for (const rec of costCodeRecords) {
    const code = parseInt(String(rec.cost_code?.value ?? '0'), 10);
    if (codeInRanges(code, revRanges)) {
      revenueFromCodes += Math.abs((rec.jtd_cost?.value as number) || 0);
      continue;
    }
    budgetSum += (rec.revised_budget?.value as number) || 0;
    jtdSum += (rec.jtd_cost?.value as number) || 0;
  }

  budgetSum = Math.round(budgetSum * 100) / 100;
  jtdSum = Math.round(jtdSum * 100) / 100;
  revenueFromCodes = Math.round(revenueFromCodes * 100) / 100;
  const overUnder = Math.round((budgetSum - jtdSum) * 100) / 100;

  fixed.total_revised_budget = { value: budgetSum, confidence: 0.95 };
  fixed.total_jtd_cost = { value: jtdSum, confidence: 0.95 };
  fixed.overunder_budget_line = { value: overUnder, confidence: 0.95 };

  // Map job_totals_revenue: prefer extracted field, fall back to contract_value, then revenue code sum
  if (!fixed.job_totals_revenue?.value) {
    const cv = fixed.contract_value?.value;
    const revenue = cv != null ? Math.abs(cv as number) : revenueFromCodes;
    if (revenue > 0) {
      fixed.job_totals_revenue = { value: revenue, confidence: 0.9 };
    }
  }

  // Map job_totals_expenses: prefer extracted, fall back to computed total_jtd_cost
  if (!fixed.job_totals_expenses?.value && jtdSum > 0) {
    fixed.job_totals_expenses = { value: jtdSum, confidence: 0.9 };
  }

  // Map job_totals_net: prefer extracted, compute from revenue - expenses
  if (!fixed.job_totals_net?.value) {
    const rev = (fixed.job_totals_revenue?.value as number) || 0;
    const exp = (fixed.job_totals_expenses?.value as number) || jtdSum;
    if (rev > 0) {
      fixed.job_totals_net = { value: Math.round((rev - exp) * 100) / 100, confidence: 0.9 };
    }
  }

  if (budgetSum > 0) {
    fixed.overall_pct_budget_consumed = {
      value: Math.round((jtdSum / budgetSum) * 10000) / 100,
      confidence: 0.95,
    };
  }

  return fixed;
}

// Compute PR/GL/AP source amounts from transactions and cost code data
function computeSourceAmounts(
  fields: FieldsMap,
  workerTransactions: RecordRow[],
  costCodeRecords: RecordRow[],
  codeRanges: CodeRanges,
): FieldsMap {
  const fixed = { ...fields };

  if (workerTransactions.length > 0) {
    const prTotal = workerTransactions.reduce(
      (s, t) => s + ((t.actual_amount?.value as number) || 0), 0,
    );
    fixed.pr_amount = { value: Math.round(prTotal * 100) / 100, confidence: 0.9 };
  }

  const totalDirect = (fixed.total_jtd_cost?.value as number) || 0;
  const prAmt = (fixed.pr_amount?.value as number) || 0;

  // GL = sum of jtd_cost for gl_overhead codes (configurable via code_ranges)
  const glRanges = codeRanges.gl_overhead ?? [100];
  let glAmount = 0;
  for (const rec of costCodeRecords) {
    const code = parseInt(String(rec.cost_code?.value ?? '0'), 10);
    if (codeInRanges(code, glRanges)) {
      glAmount += (rec.jtd_cost?.value as number) || 0;
    }
  }
  glAmount = Math.round(glAmount * 100) / 100;
  fixed.gl_amount = { value: glAmount, confidence: 0.85 };

  // AP = residual: total direct cost - PR - GL
  if (totalDirect > 0) {
    const apCalc = Math.round((totalDirect - prAmt - glAmount) * 100) / 100;
    fixed.ap_amount = { value: apCalc, confidence: 0.85 };
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
    const workerName = String(
      txn.name?.value ?? txn.worker_name?.value ?? txn.employee_name?.value ?? txn.employee?.value ?? 'unknown'
    ).trim();
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

  // Load code_ranges from the skill config (falls back to Sage defaults)
  let codeRanges: CodeRanges = DEFAULT_CODE_RANGES;
  const { data: skillRow } = await sb
    .from('document_skills')
    .select('code_ranges')
    .eq('skill_id', skillId)
    .maybeSingle();
  if (skillRow?.code_ranges) {
    codeRanges = skillRow.code_ranges as CodeRanges;
  }

  const fixedRecords = fixCostCodeColumnSwap(extractedData.records);
  const fixedFields = fixDocLevelFields(extractedData.fields, fixedRecords, codeRanges);
  const workerAgg = aggregateWorkerRecords(extractedData.workerRecords ?? []);

  // Diagnostic: log sample transaction keys to debug worker aggregation
  const sampleTxns = extractedData.workerRecords ?? [];
  if (sampleTxns.length > 0 && workerAgg.length <= 1) {
    const sample = sampleTxns[0];
    const keys = Object.keys(sample);
    const nameVal = sample.name?.value ?? sample.worker_name?.value ?? sample.employee_name?.value;
    console.warn(`[jcr-model] Worker aggregation produced only ${workerAgg.length} worker(s) from ${sampleTxns.length} txns. Sample txn keys: [${keys.join(', ')}] name=${nameVal}`);
  }

  const finalFields = computeSourceAmounts(fixedFields, extractedData.workerRecords ?? [], fixedRecords, codeRanges);

  console.log(`[jcr-model] Fixed column swap for ${fixedRecords.length} cost codes, aggregated ${workerAgg.length} workers from ${extractedData.workerRecords?.length ?? 0} transactions`);

  const collections: Record<string, RecordRow[]> = {
    cost_code: fixedRecords,
    worker: workerAgg,
    payroll_transactions: extractedData.workerRecords ?? [],
  };

  const extractedRows = emitExtractedRows(skillId, finalFields, collections);

  const derivedRows = await evaluateDerivedFields(
    skillId,
    { fields: finalFields, collections },
    { ...meta, code_ranges: codeRanges } as Record<string, unknown>,
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
