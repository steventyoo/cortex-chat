/**
 * JCR Model Engine — thin orchestrator.
 * Converts extracted JCR data into ExportRows via the generic derived-evaluator,
 * then writes them to computed_export.
 */

import { getSupabase } from './supabase';
import { evaluateDerivedFields, emitExtractedRows, buildContext } from './derived-evaluator';
import type { CheckResult } from './consistency-evaluator';
import { runPostExtractionValidation } from './post-extraction-validator';
import type { PatternParserMeta } from './pattern-extractor';
import type { ExtractionFile } from './sandbox';
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
      const budget = (fixed.revised_budget?.value as number) || (fixed.original_budget?.value as number) || 0;
      fixed.over_under_budget = {
        value: Math.round((actual - budget) * 100) / 100,
        confidence: ouRaw.confidence,
      };
    } else if (!needsSwap && jtdRaw) {
      const actual = (jtdRaw.value as number) || 0;
      const budget = (fixed.revised_budget?.value as number) || (fixed.original_budget?.value as number) || 0;
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

    // Derived: change_orders = revised_budget - original_budget
    const revisedBudget = (fixed.revised_budget?.value as number) || 0;
    const originalBudget = (fixed.original_budget?.value as number) || 0;
    if (revisedBudget !== 0 || originalBudget !== 0) {
      fixed.change_orders = { value: Math.round((revisedBudget - originalBudget) * 100) / 100, confidence: 0.9 };
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

  // Revenue: authoritative = abs(code 999 jtd_cost). Fall back to contract_value.
  const cv = fixed.contract_value?.value;
  const authRevenue = revenueFromCodes > 0
    ? revenueFromCodes
    : cv != null ? Math.abs(cv as number) : 0;

  if (authRevenue > 0) {
    const llmRevenue = fixed.job_totals_revenue?.value as number | null;
    if (llmRevenue != null && Math.abs(llmRevenue - authRevenue) > 1) {
      console.warn(
        `[jcr-model] job_totals_revenue: LLM extracted ${llmRevenue}, cost-code derived ${authRevenue} — using derived`,
      );
    }
    fixed.job_totals_revenue = { value: authRevenue, confidence: 0.95 };
  }

  // Expenses: authoritative = sum of non-revenue jtd_cost
  if (jtdSum > 0) {
    const llmExpenses = fixed.job_totals_expenses?.value as number | null;
    if (llmExpenses != null && Math.abs(llmExpenses - jtdSum) > 1) {
      console.warn(
        `[jcr-model] job_totals_expenses: LLM extracted ${llmExpenses}, cost-code derived ${jtdSum} — using derived`,
      );
    }
    fixed.job_totals_expenses = { value: jtdSum, confidence: 0.95 };
  }

  // Net: computed from authoritative revenue and expenses
  const finalRev = (fixed.job_totals_revenue?.value as number) || 0;
  const finalExp = (fixed.job_totals_expenses?.value as number) || 0;
  if (finalRev > 0) {
    const netVal = Math.round((finalRev - finalExp) * 100) / 100;
    const llmNet = fixed.job_totals_net?.value as number | null;
    if (llmNet != null && Math.abs(llmNet - netVal) > 1) {
      console.warn(
        `[jcr-model] job_totals_net: LLM extracted ${llmNet}, computed ${netVal} — using computed`,
      );
    }
    fixed.job_totals_net = { value: netVal, confidence: 0.95 };
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

  // PR amount = base wages from transactions + burden codes (995/998)
  // This matches the "Job Totals by Source" burdened PR total per JCR Schema v4
  let prTotal = 0;
  if (workerTransactions.length > 0) {
    prTotal = workerTransactions.reduce(
      (s, t) => s + ((t.actual_amount?.value as number) || 0), 0,
    );
  }
  const burdenRanges = codeRanges.burden ?? [995, 998];
  let burdenTotal = 0;
  for (const rec of costCodeRecords) {
    const code = parseInt(String(rec.cost_code?.value ?? '0'), 10);
    if (codeInRanges(code, burdenRanges)) {
      burdenTotal += (rec.jtd_cost?.value as number) || 0;
    }
  }
  prTotal = Math.round((prTotal + burdenTotal) * 100) / 100;
  fixed.pr_amount = { value: prTotal, confidence: 0.9 };

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

function aggregateWorkerRecords(transactions: RecordRow[]): { aggregated: RecordRow[] } {
  const groups = new Map<string, RecordRow>();
  const costCodeSets = new Map<string, Set<string>>();

  const SUM_FIELDS = new Set([
    'regular_hours', 'overtime_hours', 'doubletime_hours',
    'actual_amount', 'regular_amount', 'overtime_amount', 'doubletime_amount',
  ]);

  const HOUR_FIELDS = new Set([
    'regular_hours', 'overtime_hours', 'doubletime_hours',
  ]);

  for (const txn of transactions) {
    const rawName =
      txn.name?.value ?? txn.worker_name?.value ?? txn.employee_name?.value
      ?? txn.employee?.value ?? txn.emp_name?.value ?? txn.worker?.value ?? null;
    const workerName = rawName != null && String(rawName).trim() !== ''
      ? String(rawName).trim()
      : 'unknown';
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

    // Reversal detection: negative actual_amount means this is a payroll
    // correction. The PDF shows positive hours on reversals, but they should
    // cancel the original — negate hours so they net to zero.
    const amt = (txn.actual_amount?.value as number) || 0;
    const isReversal = amt < 0;

    for (const field of SUM_FIELDS) {
      const v = txn[field]?.value;
      if (v != null && typeof v === 'number') {
        let adjusted = v;
        if (isReversal && HOUR_FIELDS.has(field) && v > 0) {
          adjusted = -v;
        }
        (agg[field] as FieldVal).value = ((agg[field] as FieldVal).value as number) + adjusted;
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

  return { aggregated: results };
}

// ── Safety-net reconciliation (log-only) ─────────────────────

function reconcilePrTransactions(
  transactions: RecordRow[],
  costCodeRecords: RecordRow[],
  codeRanges: CodeRanges,
  runId: string,
): void {
  if (transactions.length === 0 || costCodeRecords.length === 0) return;

  const laborRanges = codeRanges.labor ?? [11, [100, 199]];
  const burdenRanges = codeRanges.burden ?? [995, 998];

  // ── Per-cost-code amount reconciliation ──
  // Sum PR txn amounts per cost code and compare against the cost code's JTD total.
  // For labor codes, JTD should equal the sum of PR transactions under that code.
  const txnSumByCode = new Map<string, number>();
  for (const txn of transactions) {
    const code = String(txn.cost_code?.value ?? '');
    if (!code) continue;
    const amt = (txn.actual_amount?.value as number) || 0;
    txnSumByCode.set(code, (txnSumByCode.get(code) || 0) + amt);
  }

  let laborCodesMatched = 0;
  let laborCodesTotal = 0;
  const mismatches: string[] = [];
  for (const rec of costCodeRecords) {
    const code = parseInt(String(rec.cost_code?.value ?? '0'), 10);
    if (!codeInRanges(code, laborRanges)) continue;
    laborCodesTotal++;
    const ccJtd = (rec.jtd_cost?.value as number) || 0;
    const txnSum = Math.round((txnSumByCode.get(String(code)) || 0) * 100) / 100;
    const jtdRounded = Math.round(ccJtd * 100) / 100;
    if (Math.abs(txnSum - jtdRounded) < 0.01) {
      laborCodesMatched++;
    } else {
      mismatches.push(`code=${code}: txn_sum=$${txnSum.toFixed(2)} vs jtd=$${jtdRounded.toFixed(2)} (Δ$${(txnSum - jtdRounded).toFixed(2)})`);
    }
  }

  if (mismatches.length > 0) {
    console.warn(
      `[jcr-model] PR per-code reconciliation run=${runId}: ${laborCodesMatched}/${laborCodesTotal} labor codes match. Mismatches:\n  ` +
      mismatches.join('\n  '),
    );
  } else {
    console.log(
      `[jcr-model] PR per-code reconciliation run=${runId}: ${laborCodesMatched}/${laborCodesTotal} labor codes match perfectly`,
    );
  }

  // ── Aggregate hours reconciliation ──
  let ccRegHours = 0;
  let ccOtHours = 0;
  for (const rec of costCodeRecords) {
    const code = parseInt(String(rec.cost_code?.value ?? '0'), 10);
    if (!codeInRanges(code, laborRanges)) continue;
    ccRegHours += (rec.regular_hours?.value as number) || 0;
    ccOtHours += (rec.overtime_hours?.value as number) || 0;
  }

  let txnRegHours = 0;
  let txnOtHours = 0;
  let txnAmountSum = 0;
  let txnWithHoursNoAmount = 0;
  for (const txn of transactions) {
    const amt = (txn.actual_amount?.value as number) || (txn.regular_amount?.value as number) || 0;
    const isReversal = amt < 0;
    const regH = (txn.regular_hours?.value as number) || 0;
    const otH = (txn.overtime_hours?.value as number) || 0;
    txnRegHours += isReversal && regH > 0 ? -regH : regH;
    txnOtHours += isReversal && otH > 0 ? -otH : otH;
    txnAmountSum += amt;
    if ((regH + otH) > 0 && amt === 0) txnWithHoursNoAmount++;
  }

  const totalCcHours = ccRegHours + ccOtHours;
  const totalTxnHours = txnRegHours + txnOtHours;
  const hoursCoverage = totalCcHours > 0 ? Math.round((totalTxnHours / totalCcHours) * 100) : 100;

  if (hoursCoverage < 90) {
    console.warn(
      `[jcr-model] RECONCILIATION WARNING run=${runId}: PR transactions account for only ${hoursCoverage}% of cost code hours ` +
      `(txn=${totalTxnHours.toFixed(1)}h vs cc=${totalCcHours.toFixed(1)}h). Gap may indicate missing transaction lines.`,
    );
  } else {
    console.log(
      `[jcr-model] Reconciliation OK run=${runId}: PR hours coverage ${hoursCoverage}% ` +
      `(txn=${totalTxnHours.toFixed(1)}h vs cc=${totalCcHours.toFixed(1)}h)`,
    );
  }

  // ── Doc-level PR source amount reconciliation ──
  let burdenTotal = 0;
  for (const rec of costCodeRecords) {
    const code = parseInt(String(rec.cost_code?.value ?? '0'), 10);
    if (codeInRanges(code, burdenRanges)) {
      burdenTotal += (rec.jtd_cost?.value as number) || 0;
    }
  }
  const computedPrBySource = Math.round((txnAmountSum + burdenTotal) * 100) / 100;

  console.log(
    `[jcr-model] Reconciliation summary run=${runId}: ${transactions.length} PR txns, ` +
    `txn_sum=$${txnAmountSum.toFixed(2)} + burden=$${burdenTotal.toFixed(2)} = computed_pr_source=$${computedPrBySource.toFixed(2)}, ` +
    `hours_coverage=${hoursCoverage}%, code_match=${laborCodesMatched}/${laborCodesTotal}`,
  );
}

// ── Orchestrator ─────────────────────────────────────────────

export async function runJcrModel(
  pipelineLogId: string,
  projectId: string,
  orgId: string,
  extractedData: { fields: FieldsMap; records: RecordRow[]; skillId?: string; workerRecords?: RecordRow[] },
  meta: ProjectMeta = {},
  options?: { tailText?: string; sourceText?: string; generatedCode?: string; formatFingerprint?: string; usedCachedParserId?: string; patternMeta?: PatternParserMeta; agentMeta?: { parser_type: 'agent'; confirmed_absent: string[]; agent_tool_calls: number; composite_score: number }; pages?: string[]; inputFiles?: ExtractionFile[] },
): Promise<{ runId: string; rowCount: number; reconciliationScore: number; identityScore: number; qualityScore: number; checkResults: CheckResult[] }> {
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
  const { aggregated: workerAgg } = aggregateWorkerRecords(extractedData.workerRecords ?? []);

  // Diagnostic: log sample transaction keys to debug worker aggregation
  const sampleTxns = extractedData.workerRecords ?? [];
  if (sampleTxns.length > 0 && workerAgg.length <= 1) {
    const sample = sampleTxns[0];
    const keys = Object.keys(sample);
    const nameVal = sample.name?.value ?? sample.worker_name?.value ?? sample.employee_name?.value;
    const uniqueNames = new Set(sampleTxns.slice(0, 50).map(t =>
      String(t.name?.value ?? t.worker_name?.value ?? t.employee_name?.value ?? t.employee?.value ?? t.emp_name?.value ?? t.worker?.value ?? '<none>')
    ));
    console.warn(
      `[jcr-model] Worker aggregation produced only ${workerAgg.length} worker(s) from ${sampleTxns.length} txns.` +
      ` Sample keys: [${keys.join(', ')}] first name=${nameVal}` +
      ` unique names (first 50 txns): [${[...uniqueNames].slice(0, 10).join(', ')}]`,
    );
  }

  let finalFields = computeSourceAmounts(fixedFields, extractedData.workerRecords ?? [], fixedRecords, codeRanges);

  // ── Safety-net reconciliation logging (log-only, no data changes) ──
  reconcilePrTransactions(extractedData.workerRecords ?? [], fixedRecords, codeRanges, runId);

  console.log(`[jcr-model] Fixed column swap for ${fixedRecords.length} cost codes, aggregated ${workerAgg.length} workers from ${extractedData.workerRecords?.length ?? 0} transactions`);

  const collections: Record<string, RecordRow[]> = {
    cost_code: fixedRecords,
    worker: workerAgg,
    payroll_transactions: extractedData.workerRecords ?? [],
  };

  // Use the generic post-extraction validator for consistency checks + auto-fix.
  // This runs for any skill, not just JCR — but JCR provides collections and meta.
  const validation = await runPostExtractionValidation({
    pipelineLogId,
    skillId,
    fields: finalFields,
    collections,
    meta: { ...meta, code_ranges: codeRanges } as Record<string, unknown>,
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

  // Apply any corrections from re-extraction back into our fields
  if (validation.correctedFields) {
    for (const [field, val] of Object.entries(validation.correctedFields)) {
      if (val && finalFields[field] && val.value !== finalFields[field].value) {
        console.log(`[jcr-model] Applying validated correction: ${field}: ${finalFields[field].value} → ${val.value}`);
        finalFields[field] = val;
      }
    }
  }

  // Prefer agent-extracted document "by Source" totals over pipeline-computed sums
  // when they pass a reconciliation sanity check (PR + AP + GL ≈ total direct cost).
  const SOURCE_FIELD_MAP: Record<string, string> = {
    job_totals_by_source_pr: 'pr_amount',
    job_totals_by_source_ap: 'ap_amount',
    job_totals_by_source_gl: 'gl_amount',
  };

  const docPr = parseFloat(String(finalFields.job_totals_by_source_pr?.value ?? 0));
  const docAp = parseFloat(String(finalFields.job_totals_by_source_ap?.value ?? 0));
  const docGl = parseFloat(String(finalFields.job_totals_by_source_gl?.value ?? 0));
  const docSourceSum = docPr + docAp + docGl;
  const totalDirectCost = (finalFields.total_jtd_cost?.value as number) || 0;

  const hasDocSourceValues = docPr > 0 || docAp > 0 || docGl > 0;
  const reconciles = totalDirectCost > 0
    && Math.abs(docSourceSum - totalDirectCost) / totalDirectCost < 0.05;

  if (hasDocSourceValues && reconciles) {
    for (const [docField, computedField] of Object.entries(SOURCE_FIELD_MAP)) {
      const docVal = finalFields[docField];
      if (docVal?.value != null && typeof docVal.value === 'number') {
        const oldVal = finalFields[computedField]?.value;
        finalFields[computedField] = { value: docVal.value, confidence: 0.95 };
        console.log(`[jcr-model] Using document "by Source" for ${computedField}: ${oldVal} → ${docVal.value}`);
      }
    }
  } else if (hasDocSourceValues && !reconciles) {
    console.warn(
      `[jcr-model] Document "by Source" values don't reconcile ` +
      `(sum=${docSourceSum.toFixed(2)} vs direct=${totalDirectCost.toFixed(2)}, ` +
      `delta=${totalDirectCost > 0 ? ((docSourceSum - totalDirectCost) / totalDirectCost * 100).toFixed(1) : '?'}%) ` +
      `— keeping computed values`,
    );
  }

  const extractedRows = emitExtractedRows(skillId, finalFields, collections);

  const derivedRows = await evaluateDerivedFields(
    skillId,
    { fields: finalFields, collections },
    { ...meta, code_ranges: codeRanges } as Record<string, unknown>,
  );

  const allRows = [...extractedRows, ...derivedRows];
  console.log(`[jcr-model] Generated ${allRows.length} export rows (${extractedRows.length} extracted, ${derivedRows.length} derived)`);

  await sb.from('computed_export').delete().eq('project_id', projectId).eq('org_id', orgId);

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

  for (let i = 0; i < dbRows.length; i += 100) {
    const batch = dbRows.slice(i, i + 100);
    const { error } = await sb.from('computed_export').insert(batch);
    if (error) {
      console.error(`[jcr-model] Insert batch ${i} failed:`, error.message);
    }
  }

  console.log(`[jcr-model] Done: run=${runId} rows=${allRows.length} identity=${identityScore}% quality=${qualityScore}%`);
  return { runId, rowCount: allRows.length, reconciliationScore, identityScore, qualityScore, checkResults };
}
