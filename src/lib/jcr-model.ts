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

// ── Aggregate payroll transactions into per-cost-code worker summaries ──

function aggregateWorkerRecords(transactions: RecordRow[]): RecordRow[] {
  const groups = new Map<string, RecordRow>();

  const SUM_FIELDS = new Set([
    'regular_hours', 'overtime_hours', 'doubletime_hours',
    'actual_amount', 'regular_amount', 'overtime_amount', 'doubletime_amount',
  ]);
  const LABEL_FIELDS = new Set(['description', 'cost_category', 'cost_code', 'name', 'source', 'number']);

  for (const txn of transactions) {
    const codeVal = txn.cost_code?.value ?? txn.number?.value ?? 'unknown';
    const key = String(typeof codeVal === 'number' ? codeVal : codeVal);

    if (!groups.has(key)) {
      const seed: RecordRow = {};
      for (const field of LABEL_FIELDS) {
        if (txn[field]?.value != null) {
          seed[field] = { value: txn[field].value, confidence: txn[field].confidence };
        }
      }
      for (const field of SUM_FIELDS) {
        seed[field] = { value: 0, confidence: 0.9 };
      }
      seed.transaction_count = { value: 0, confidence: 1 };
      groups.set(key, seed);
    }

    const agg = groups.get(key)!;
    for (const field of SUM_FIELDS) {
      const v = txn[field]?.value;
      if (v != null && typeof v === 'number') {
        (agg[field] as FieldVal).value = ((agg[field] as FieldVal).value as number) + v;
      }
    }
    (agg.transaction_count as FieldVal).value = ((agg.transaction_count as FieldVal).value as number) + 1;
  }

  const results = Array.from(groups.values());
  for (const agg of results) {
    const regH = (agg.regular_hours?.value as number) || 0;
    const otH = (agg.overtime_hours?.value as number) || 0;
    const totalH = regH + otH + ((agg.doubletime_hours?.value as number) || 0);
    agg.worker_reg_hrs = { value: regH, confidence: 0.9 };
    agg.worker_ot_hrs = { value: otH, confidence: 0.9 };
    agg.worker_total_hrs = { value: totalH, confidence: 0.9 };
    agg.worker_wages = { value: (agg.actual_amount?.value as number) || 0, confidence: 0.9 };
    agg.worker_ot_pct = { value: totalH > 0 ? (otH / totalH) * 100 : 0, confidence: 0.9 };
    agg.worker_rate = { value: totalH > 0 ? ((agg.actual_amount?.value as number) || 0) / totalH : 0, confidence: 0.9 };
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

  const collections: Record<string, RecordRow[]> = {
    cost_code: extractedData.records,
    worker: aggregateWorkerRecords(extractedData.workerRecords ?? []),
  };

  const extractedRows = emitExtractedRows(skillId, extractedData.fields, collections);

  const derivedRows = await evaluateDerivedFields(
    skillId,
    { fields: extractedData.fields, collections },
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
