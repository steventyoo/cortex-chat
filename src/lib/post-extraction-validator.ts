/**
 * Post-extraction validator — runs consistency checks for ANY document skill.
 *
 * This is the generic layer between extraction and export. It:
 *  1. Loads consistency_checks for the document's skill_id
 *  2. Evaluates them against the extracted data
 *  3. If doc-scoped Tier 1/2 checks fail (extraction_error), attempts
 *     targeted re-extraction using the PDF tail text
 *  4. Re-runs checks after corrections
 *  5. Returns results: which fields to withhold, which are anomalies,
 *     the reconciliation score, and updated field values
 *
 * Separated from any skill-specific model (JCR, change order, etc.)
 * so every document type gets validation automatically.
 */

import { buildContext, type EvalContext } from './derived-evaluator';
import {
  evaluateConsistencyChecks,
  computeReconciliationScore,
  type CheckResult,
} from './consistency-evaluator';
import { targetedFieldExtraction } from './codegen-extractor';
import { getSupabase } from './supabase';

type FieldVal = { value: string | number | null; confidence: number };
type FieldsMap = Record<string, FieldVal>;
type RecordRow = Record<string, FieldVal>;

export interface ValidationInput {
  pipelineLogId: string;
  skillId: string;
  fields: FieldsMap;
  collections: Record<string, RecordRow[]>;
  meta?: Record<string, unknown>;
  tailText?: string;
}

export interface ValidationOutput {
  checkResults: CheckResult[];
  reconciliationScore: number;
  withheldFields: Set<string>;
  anomalyFields: Set<string>;
  correctedFields: FieldsMap;
  reextractAttempts: number;
  resolvedChecks: string[];
}

const MAX_REEXTRACT_RETRIES = 1;

export async function runPostExtractionValidation(
  input: ValidationInput,
): Promise<ValidationOutput> {
  const { pipelineLogId, skillId, collections, meta, tailText } = input;
  let fields = { ...input.fields };
  let checkResults: CheckResult[] = [];
  let reconciliationScore = 100;
  let reextractAttempts = 0;
  const resolvedChecks: string[] = [];

  // Run check → fix → recheck loop
  for (let attempt = 0; attempt <= MAX_REEXTRACT_RETRIES; attempt++) {
    const evalCtx = buildContext(fields, collections, meta ?? {});

    try {
      checkResults = await evaluateConsistencyChecks(skillId, evalCtx);
      reconciliationScore = computeReconciliationScore(checkResults);
      console.log(
        `[validator] Checks for skill=${skillId} (attempt ${attempt + 1}): ` +
        `score=${reconciliationScore}% ` +
        `(${checkResults.filter(r => r.status === 'pass').length} passed, ` +
        `${checkResults.filter(r => r.status === 'fail').length} failed)`
      );
    } catch (err) {
      console.error(`[validator] Consistency checks failed (non-fatal):`, err);
      break;
    }

    // If no checks were loaded for this skill, skip the loop entirely
    if (checkResults.length === 0) break;

    const retriableErrors = checkResults.filter(r =>
      r.status === 'fail' &&
      r.classification === 'extraction_error' &&
      r.scope === 'doc' &&
      r.tier <= 2 &&
      r.affected_fields.length > 0
    );

    if (retriableErrors.length === 0 || attempt === MAX_REEXTRACT_RETRIES) {
      if (attempt > 0 && retriableErrors.length === 0) {
        console.log(`[validator] All extraction errors resolved after ${attempt} re-extraction(s)`);
      }
      break;
    }

    if (!tailText) {
      console.log(`[validator] ${retriableErrors.length} retriable error(s) but no tail text — skipping re-extraction`);
      break;
    }

    reextractAttempts++;
    console.log(
      `[validator] Targeted re-extraction (attempt ${reextractAttempts}) for: ` +
      retriableErrors.map(e => e.check_name).join(', ')
    );

    try {
      const currentValues: Record<string, number | string | null> = {};
      for (const err of retriableErrors) {
        for (const f of err.affected_fields) {
          currentValues[f] = (fields[f]?.value as number | string | null) ?? null;
        }
      }

      const result = await targetedFieldExtraction({
        failingChecks: retriableErrors.map(e => ({
          check_name: e.check_name,
          message: e.message,
          affected_fields: e.affected_fields,
          hint_template: e.hint_template,
          expected: e.expected,
          actual: e.actual,
        })),
        tailText,
        currentValues,
      });

      if (result.fieldsChanged.length > 0) {
        for (const [field, value] of Object.entries(result.correctedFields)) {
          if (value != null && fields[field]) {
            const oldVal = fields[field].value;
            fields[field] = { value, confidence: 0.85 };
            console.log(`[validator] Re-extracted ${field}: ${oldVal} → ${value}`);
          }
        }
        resolvedChecks.push(...result.fieldsChanged.map(f => `${f} corrected`));
      } else {
        console.log('[validator] Targeted re-extraction returned no changes');
        break;
      }
    } catch (err) {
      console.error(`[validator] Targeted re-extraction failed:`, err);
      break;
    }
  }

  // Classify final failures
  const extractionErrors = checkResults.filter(r => r.status === 'fail' && r.classification === 'extraction_error');
  const docAnomalies = checkResults.filter(r => r.status === 'fail' && r.classification === 'document_anomaly');

  const withheldFields = new Set<string>();
  for (const err of extractionErrors) {
    for (const f of err.affected_fields) withheldFields.add(f);
  }

  const anomalyFields = new Set<string>();
  for (const anomaly of docAnomalies) {
    for (const f of anomaly.affected_fields) anomalyFields.add(f);
  }

  if (extractionErrors.length > 0) {
    console.warn(
      `[validator] ${extractionErrors.length} unresolved extraction error(s) after ${reextractAttempts} retry(s): ` +
      extractionErrors.map(e => `${e.check_name}: ${e.message}`).join('; ')
    );
  }
  if (docAnomalies.length > 0) {
    console.log(
      `[validator] ${docAnomalies.length} document anomaly/anomalies: ` +
      docAnomalies.map(a => `${a.check_name}: ${a.message}`).join('; ')
    );
  }

  // Store results on pipeline_log
  try {
    const sb = getSupabase();
    const validationFlags = checkResults.map(r => ({
      field: r.check_name,
      issue: r.message,
      severity: r.status === 'fail' ? 'error' as const : 'info' as const,
      check_type: 'consistency',
      classification: r.classification,
      resolution: r.status === 'pass'
        ? (resolvedChecks.some(rc => r.affected_fields.some(f => rc.startsWith(f))) ? 'resolved' : 'passed')
        : (r.classification === 'document_anomaly' ? 'anomaly' : 'withheld'),
      tier: r.tier,
      expected: r.expected,
      actual: r.actual,
      ...(r.record_key ? { record_key: r.record_key } : {}),
    }));

    const pipelineStatus = extractionErrors.length > 0 ? 'pending_operator_review' : undefined;

    await sb.from('pipeline_log').update({
      reconciliation_score: reconciliationScore,
      ...(validationFlags.length > 0 ? { validation_flags: validationFlags } : {}),
      ...(pipelineStatus ? { status: pipelineStatus } : {}),
    }).eq('id', pipelineLogId);

    console.log(`[validator] Stored ${validationFlags.length} check results on pipeline_log, score=${reconciliationScore}%`);
  } catch (err) {
    console.error(`[validator] Failed to store check results:`, err);
  }

  return {
    checkResults,
    reconciliationScore,
    withheldFields,
    anomalyFields,
    correctedFields: fields,
    reextractAttempts,
    resolvedChecks,
  };
}
