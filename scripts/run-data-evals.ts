#!/usr/bin/env tsx
/**
 * Data accuracy eval runner for Cortex.
 *
 * Compares computed_export values against ground-truth labels and reports
 * per-field scores to Langfuse datasets.
 *
 * Usage:
 *   npx tsx scripts/run-data-evals.ts --skill job_cost_report            # both suites
 *   npx tsx scripts/run-data-evals.ts --skill job_cost_report --suite derived
 *   npx tsx scripts/run-data-evals.ts --skill job_cost_report --suite extraction
 *   npx tsx scripts/run-data-evals.ts --skill job_cost_report --record "cost_code=120"
 *
 * Required env vars (in .env.local or .env):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local', override: true });
dotenv.config({ path: '.env' });

import { createClient } from '@supabase/supabase-js';
import { getLangfuse, shutdownLangfuse } from '../src/lib/langfuse';
import type { SkillEvalLabels, DerivedLabel, RecordLabel } from '../src/lib/eval-labels/types';

const RUN_LABEL = `data-eval-${new Date().toISOString().slice(0, 19).replace(/[:]/g, '-')}`;

/* ── CLI args ──────────────────────────────────────────────── */

function parseArgs() {
  const args = process.argv.slice(2);
  let skill = '';
  let suite: 'all' | 'derived' | 'extraction' = 'all';
  let record: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--skill' && args[i + 1]) skill = args[i + 1];
    if (args[i] === '--suite' && args[i + 1]) suite = args[i + 1] as typeof suite;
    if (args[i] === '--record' && args[i + 1]) record = args[i + 1];
  }

  if (!skill) {
    console.error('Usage: npx tsx scripts/run-data-evals.ts --skill <skill_id> [--suite derived|extraction|all] [--record <record_key>]');
    process.exit(1);
  }

  return { skill, suite, record };
}

/* ── Load labels dynamically ───────────────────────────────── */

async function loadLabels(skillId: string): Promise<SkillEvalLabels> {
  try {
    const mod = await import(`../src/lib/eval-labels/${skillId}`);
    return mod.default as SkillEvalLabels;
  } catch (err) {
    console.error(`No labels file found for skill "${skillId}". Expected: src/lib/eval-labels/${skillId}.ts`);
    throw err;
  }
}

/* ── Fetch computed_export ─────────────────────────────────── */

type ExportPivot = Map<string, Map<string, number>>;

async function fetchExportPivot(projectId: string, skillId: string): Promise<ExportPivot> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE env vars');

  const sb = createClient(url, key);
  const pivot: ExportPivot = new Map();

  let from = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await sb
      .from('computed_export')
      .select('record_key, canonical_name, value_number')
      .eq('project_id', projectId)
      .eq('skill_id', skillId)
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`Supabase query failed: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (row.value_number == null) continue;
      const rk = String(row.record_key);
      const cn = String(row.canonical_name);
      if (!pivot.has(rk)) pivot.set(rk, new Map());
      pivot.get(rk)!.set(cn, Number(row.value_number));
    }

    hasMore = data.length === pageSize;
    from += pageSize;
  }

  return pivot;
}

/* ── Scoring ───────────────────────────────────────────────── */

interface FieldResult {
  key: string;
  field: string;
  expected: number;
  actual: number | null;
  delta: number | null;
  status: 'pass' | 'fail' | 'missing' | 'not_computable';
  score: number;
}

function scoreDerived(label: DerivedLabel, pivot: ExportPivot): FieldResult {
  const key = `project:${label.field}`;
  const pipeField = label.pipelineField || label.field;
  const projectMap = pivot.get('project');
  const actual = projectMap?.get(pipeField) ?? null;

  if (label.notYetComputable && actual == null) {
    return { key, field: label.field, expected: label.expected, actual: null, delta: null, status: 'not_computable', score: 0 };
  }

  if (actual == null) {
    return { key, field: label.field, expected: label.expected, actual: null, delta: null, status: 'missing', score: 0 };
  }

  // If not-yet-computable but we got a value, score it normally (coverage improved)
  const tolerance = label.tolerance ?? 0.05;
  return compareNumeric(key, label.field, label.expected, actual, tolerance);
}

function scoreRecord(label: RecordLabel, pivot: ExportPivot): FieldResult {
  const key = `${label.recordKey}:${label.field}`;
  const rkMap = pivot.get(label.recordKey);
  const actual = rkMap?.get(label.field) ?? null;

  if (actual == null) {
    return { key, field: label.field, expected: label.expected, actual: null, delta: null, status: 'missing', score: 0 };
  }

  const tolerance = label.tolerance ?? 0.05;
  return compareNumeric(key, label.field, label.expected, actual, tolerance);
}

function compareNumeric(key: string, field: string, expected: number, actual: number, tolerance: number): FieldResult {
  if (expected === 0) {
    const pass = Math.abs(actual) <= (tolerance > 0 ? tolerance : 0.01);
    return { key, field, expected, actual, delta: actual, status: pass ? 'pass' : 'fail', score: pass ? 1 : 0 };
  }

  const delta = (actual - expected) / Math.abs(expected);
  const pass = Math.abs(delta) <= tolerance;
  return { key, field, expected, actual, delta, status: pass ? 'pass' : 'fail', score: pass ? 1 : 0 };
}

/* ── Langfuse sync ─────────────────────────────────────────── */

const LANGFUSE_BATCH_SIZE = 20;
const LANGFUSE_BATCH_DELAY_MS = 500;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncToLangfuse(datasetName: string, results: FieldResult[]): Promise<void> {
  const lf = getLangfuse();

  try {
    await lf.getDataset(datasetName);
  } catch {
    await lf.createDataset({ name: datasetName });
    console.log(`  Created Langfuse dataset: ${datasetName}`);
  }

  // Batch dataset item creation to avoid 429s
  for (let i = 0; i < results.length; i += LANGFUSE_BATCH_SIZE) {
    const batch = results.slice(i, i + LANGFUSE_BATCH_SIZE);
    for (const r of batch) {
      lf.createDatasetItem({
        datasetName,
        id: `${datasetName}--${r.key}`,
        input: { field: r.field, key: r.key },
        expectedOutput: { value: r.expected },
        metadata: { status: r.status },
      });
    }
    await lf.flushAsync();
    if (i + LANGFUSE_BATCH_SIZE < results.length) await sleep(LANGFUSE_BATCH_DELAY_MS);
  }

  const trace = lf.trace({
    name: RUN_LABEL,
    metadata: { dataset: datasetName, totalFields: results.length },
  });

  const dataset = await lf.getDataset(datasetName);

  // Batch item linking and scoring
  for (let i = 0; i < results.length; i += LANGFUSE_BATCH_SIZE) {
    const batch = results.slice(i, i + LANGFUSE_BATCH_SIZE);
    for (const r of batch) {
      const dsItem = dataset.items.find(
        (di: { id?: string }) => di.id === `${datasetName}--${r.key}`,
      );
      if (dsItem) {
        dsItem.link(trace, RUN_LABEL);
      }

      lf.score({
        traceId: trace.id,
        name: 'field_accuracy',
        value: r.score,
        comment: `${r.key}: ${r.status}${r.delta != null ? ` (delta=${(r.delta * 100).toFixed(2)}%)` : ''}`,
      });
    }
    await lf.flushAsync();
    if (i + LANGFUSE_BATCH_SIZE < results.length) await sleep(LANGFUSE_BATCH_DELAY_MS);
  }

  const passCount = results.filter((r) => r.status === 'pass').length;
  lf.score({
    traceId: trace.id,
    name: 'suite_accuracy',
    value: results.length > 0 ? passCount / results.length : 0,
    comment: `${passCount}/${results.length} fields pass`,
  });

  await lf.flushAsync();
}

/* ── CLI output ────────────────────────────────────────────── */

function printSummary(title: string, datasetName: string, results: FieldResult[]): void {
  const pass = results.filter((r) => r.status === 'pass');
  const fail = results.filter((r) => r.status === 'fail');
  const missing = results.filter((r) => r.status === 'missing');
  const notComputable = results.filter((r) => r.status === 'not_computable');
  const computable = results.filter((r) => r.status !== 'not_computable');

  console.log(`\n${'═'.repeat(64)}`);
  console.log(`${title} (${datasetName})`);
  console.log('═'.repeat(64));
  console.log(`  Total fields:     ${results.length}`);
  console.log(`  Computable:       ${computable.length}/${results.length}`);
  console.log(`  Accurate:         ${pass.length}/${computable.length} (${computable.length > 0 ? ((pass.length / computable.length) * 100).toFixed(1) : 0}%)`);
  console.log(`  Failed:           ${fail.length}`);
  console.log(`  Missing:          ${missing.length}`);
  console.log(`  Not yet compute:  ${notComputable.length}`);

  if (fail.length > 0) {
    console.log('\n  FAILURES:');
    for (const r of fail) {
      const deltaPct = r.delta != null ? `${(r.delta * 100).toFixed(2)}%` : 'N/A';
      console.log(`    ${r.key.padEnd(50)} expected=${fmt(r.expected)}  actual=${fmt(r.actual)}  delta=${deltaPct}`);
    }
  }

  if (missing.length > 0 && missing.length <= 20) {
    console.log('\n  MISSING:');
    for (const r of missing) {
      console.log(`    ${r.key}`);
    }
  } else if (missing.length > 20) {
    console.log(`\n  MISSING: ${missing.length} fields (showing first 10)`);
    for (const r of missing.slice(0, 10)) {
      console.log(`    ${r.key}`);
    }
    console.log(`    ... and ${missing.length - 10} more`);
  }

  if (notComputable.length > 0) {
    console.log('\n  NOT YET COMPUTABLE:');
    for (const r of notComputable) {
      console.log(`    ${r.key}`);
    }
  }
}

function fmt(v: number | null): string {
  if (v == null) return 'null';
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}

/* ── Main ──────────────────────────────────────────────────── */

async function main() {
  const { skill, suite, record } = parseArgs();

  console.log(`\nData Accuracy Eval — ${RUN_LABEL}`);
  console.log(`Skill:  ${skill}`);
  console.log(`Suite:  ${suite}`);
  if (record) console.log(`Record: ${record}`);

  const labels = await loadLabels(skill);
  console.log(`\nLoaded labels for ${labels.skillId} (project: ${labels.projectId})`);
  console.log(`  Derived labels:     ${labels.derivedLabels.length}`);
  console.log(`  Extraction labels:  ${labels.extractionLabels.length}`);

  const pivot = await fetchExportPivot(labels.projectId, labels.skillId);
  const totalRecordKeys = pivot.size;
  let totalValues = 0;
  pivot.forEach((m) => { totalValues += m.size; });
  console.log(`\nFetched ${totalValues} values across ${totalRecordKeys} record keys from computed_export\n`);

  // Run derived suite
  if (suite === 'all' || suite === 'derived') {
    const derivedResults = labels.derivedLabels.map((l) => scoreDerived(l, pivot));
    printSummary('DERIVED FIELDS ACCURACY', labels.langfuse.derivedDataset, derivedResults);
    await syncToLangfuse(labels.langfuse.derivedDataset, derivedResults);
    console.log(`  → Synced to Langfuse dataset: ${labels.langfuse.derivedDataset}\n`);
  }

  // Run extraction suite
  if (suite === 'all' || suite === 'extraction') {
    let extractionLabels = labels.extractionLabels;
    if (record) {
      extractionLabels = extractionLabels.filter((l) => l.recordKey === record);
      if (extractionLabels.length === 0) {
        console.error(`No extraction labels match record="${record}". Available record keys:`);
        const keys = Array.from(new Set(labels.extractionLabels.map((l) => l.recordKey)));
        keys.slice(0, 20).forEach((k) => console.error(`  ${k}`));
        if (keys.length > 20) console.error(`  ... and ${keys.length - 20} more`);
        process.exit(1);
      }
    }

    const extractionResults = extractionLabels.map((l) => scoreRecord(l, pivot));

    // Sub-group by type for display
    const ccResults = extractionResults.filter((r) => r.key.startsWith('cost_code='));
    const wkResults = extractionResults.filter((r) => r.key.startsWith('worker='));
    const otherResults = extractionResults.filter((r) => !r.key.startsWith('cost_code=') && !r.key.startsWith('worker='));

    if (ccResults.length > 0) printSummary('COST CODE EXTRACTION', labels.langfuse.extractionDataset, ccResults);
    if (wkResults.length > 0) printSummary('WORKER EXTRACTION', labels.langfuse.extractionDataset, wkResults);
    if (otherResults.length > 0) printSummary('REPORT RECORD EXTRACTION', labels.langfuse.extractionDataset, otherResults);

    await syncToLangfuse(labels.langfuse.extractionDataset, extractionResults);
    console.log(`  → Synced to Langfuse dataset: ${labels.langfuse.extractionDataset}\n`);
  }

  console.log(`\nRun label: ${RUN_LABEL}`);
  console.log('View results in Langfuse → Datasets\n');

  await shutdownLangfuse();
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
