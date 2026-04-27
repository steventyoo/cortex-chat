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
  computeIdentityScore,
  computeQualityScore,
  getAnomalyFlags,
  type CheckResult,
} from './consistency-evaluator';
import { targetedFieldExtraction } from './codegen-extractor';
import { getSupabase } from './supabase';
import { promoteParser, incrementValidated, updateParserQualityGaps, type QualityGap, type GapEvidence } from './stores/parser-cache.store';
import { getSkillFieldDefinitionsScoped, type FieldDefinition } from './skills';

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
  sourceText?: string;
  generatedCode?: string;
  formatFingerprint?: string;
  usedCachedParserId?: string;
}

export interface ValidationOutput {
  checkResults: CheckResult[];
  reconciliationScore: number;
  identityScore: number;
  qualityScore: number;
  anomalyFlags: CheckResult[];
  withheldFields: Set<string>;
  anomalyFields: Set<string>;
  correctedFields: FieldsMap;
  reextractAttempts: number;
  resolvedChecks: string[];
}

const MAX_REEXTRACT_RETRIES = 1;

const SPARSE_THRESHOLD = 0.5;
const MIN_RECORDS_FOR_SPARSE = 5;

/**
 * Compare extracted data against the schema to detect missing fields.
 * Returns synthetic structural CheckResults for each gap found.
 */
async function checkFieldCoverage(
  skillId: string,
  fields: FieldsMap,
  collections: Record<string, RecordRow[]>,
): Promise<{ results: CheckResult[]; gaps: QualityGap[] }> {
  let scopedDefs: Map<string, FieldDefinition[]>;
  try {
    scopedDefs = await getSkillFieldDefinitionsScoped(skillId);
  } catch {
    return { results: [], gaps: [] };
  }
  if (scopedDefs.size === 0) return { results: [], gaps: [] };

  const results: CheckResult[] = [];
  const gaps: QualityGap[] = [];

  const docFields = scopedDefs.get('doc');
  if (docFields) {
    for (const def of docFields) {
      if (!def.required) continue;
      const val = fields[def.name];
      if (val === undefined || val === null || val.value === null || val.value === undefined) {
        gaps.push({ scope: 'doc', field: def.name, null_pct: 1, type: 'missing_doc_field', description: def.description, field_type: def.type });
        results.push({
          check_name: `schema_coverage_doc_${def.name}`,
          display_name: `Missing required field: ${def.name}`,
          tier: 2,
          classification: 'extraction_error',
          check_role: 'structural',
          scope: 'doc',
          status: 'fail',
          expected: 'non-null',
          actual: null,
          delta: null,
          message: `Required doc field "${def.name}" is null or missing`,
          affected_fields: [def.name],
          hint_template: null,
        });
      }
    }
  }

  for (const [scope, defs] of scopedDefs.entries()) {
    if (scope === 'doc') continue;
    const records = collections[scope];
    if (!records || records.length < MIN_RECORDS_FOR_SPARSE) continue;

    for (const def of defs) {
      let nullCount = 0;
      const isNumeric = def.type === 'number';
      for (const rec of records) {
        const val = rec[def.name];
        if (val === undefined || val === null || val.value === null || val.value === undefined) {
          nullCount++;
        } else if (isNumeric && val.value === 0) {
          // For numeric fields, 0 is suspicious when it appears in most records --
          // parsers often default to 0 when they can't extract a value.
          nullCount++;
        }
      }
      const nullPct = nullCount / records.length;
      if (nullPct > SPARSE_THRESHOLD) {
        const label = isNumeric ? 'null/zero' : 'null';
        gaps.push({ scope, field: def.name, null_pct: Math.round(nullPct * 100) / 100, type: 'sparse_collection_field', description: def.description, field_type: def.type });
        results.push({
          check_name: `schema_coverage_${scope}_${def.name}`,
          display_name: `Sparse field in ${scope}: ${def.name}`,
          tier: 2,
          classification: 'extraction_error',
          check_role: 'structural',
          scope,
          status: 'fail',
          expected: `<${Math.round(SPARSE_THRESHOLD * 100)}% ${label}`,
          actual: `${Math.round(nullPct * 100)}% ${label} (${nullCount}/${records.length})`,
          delta: null,
          message: `Field "${def.name}" is ${label} in ${Math.round(nullPct * 100)}% of ${scope} records (${nullCount}/${records.length}) — likely a parser gap`,
          affected_fields: [def.name],
          hint_template: null,
        });
      }
    }
  }

  if (gaps.length > 0) {
    console.log(
      `[validator] Schema coverage: ${gaps.length} gap(s) found — ` +
      gaps.map(g => `${g.scope}.${g.field} (${Math.round(g.null_pct * 100)}% null)`).join(', ')
    );
  }

  return { results, gaps };
}

/**
 * Build a human-readable gap description for the "improve parser" prompt.
 * When evidence is available, includes concrete document excerpts and
 * input/output mismatches — turning abstract gap reports into debugging test cases.
 */
export function buildGapDescription(gaps: QualityGap[]): string {
  const byScope = new Map<string, QualityGap[]>();
  for (const g of gaps) {
    const list = byScope.get(g.scope) || [];
    list.push(g);
    byScope.set(g.scope, list);
  }

  const lines: string[] = [];
  for (const [scope, scopeGaps] of byScope) {
    const fieldList = scopeGaps.map(g => {
      const desc = g.description ? ` — ${g.description}` : '';
      return `"${g.field}" (${g.field_type || 'unknown'}, ${Math.round(g.null_pct * 100)}% null${desc})`;
    }).join(', ');
    if (scope === 'doc') {
      lines.push(`- Doc scope: required fields ${fieldList} are missing`);
    } else {
      lines.push(`- Collection "${scope}": fields ${fieldList} are null in most records — the parser is not extracting them`);
    }
  }

  // Append concrete evidence (failing test cases) when available
  const evidenceGaps = gaps.filter(g => g.evidence && g.evidence.length > 0);
  if (evidenceGaps.length > 0) {
    lines.push('');
    lines.push('## Concrete failing test cases');
    lines.push('Below are actual document sections where the parser SHOULD extract a value but currently returns null/zero.');
    lines.push('Use these as debugging targets — the text clearly contains the values.');
    lines.push('');
    for (const gap of evidenceGaps) {
      for (const ev of gap.evidence!) {
        lines.push(`### ${gap.scope}.${gap.field} — record "${ev.record_identifier}"`);
        lines.push(`Current extraction: ${ev.extracted_value === null || ev.extracted_value === undefined ? 'null' : ev.extracted_value === 0 ? '0 (should be non-zero)' : String(ev.extracted_value)}`);
        lines.push(`Hint: ${ev.expected_hint}`);
        lines.push('Document excerpt where this value appears:');
        lines.push('```');
        lines.push(ev.document_excerpt);
        lines.push('```');
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

/**
 * Given detected quality gaps, find 1-2 concrete document sections where
 * each missing field SHOULD appear but doesn't get extracted.
 * Returns the same gaps array with `evidence` populated.
 */
export function attachGapEvidence(
  gaps: QualityGap[],
  sourceText: string,
  collections: Record<string, RecordRow[]>,
): QualityGap[] {
  if (!sourceText || sourceText.length === 0) return gaps;

  const EXCERPT_RADIUS = 600;
  const MAX_EVIDENCE_PER_GAP = 2;

  for (const gap of gaps) {
    if (gap.scope === 'doc') continue;

    const records = collections[gap.scope];
    if (!records || records.length === 0) continue;

    const evidence: GapEvidence[] = [];

    // Find records where this field is null/zero (the "failing" cases)
    for (const rec of records) {
      if (evidence.length >= MAX_EVIDENCE_PER_GAP) break;

      const fieldVal = rec[gap.field];
      const isGap = fieldVal === undefined
        || fieldVal === null
        || fieldVal.value === null
        || fieldVal.value === undefined
        || (typeof fieldVal.value === 'number' && fieldVal.value === 0);

      if (!isGap) continue;

      // Find an identifying value from the record (cost_code, name, id, etc.)
      const identifier = findRecordIdentifier(rec);
      if (!identifier) continue;

      // Search sourceText for this identifier
      const excerpt = findDocumentExcerpt(sourceText, identifier, EXCERPT_RADIUS);
      if (!excerpt) continue;

      evidence.push({
        record_identifier: identifier,
        document_excerpt: excerpt,
        extracted_value: fieldVal?.value ?? null,
        expected_hint: buildFieldHint(gap.scope, gap.field, identifier, gap.description),
      });
    }

    if (evidence.length > 0) {
      gap.evidence = evidence;
    }
  }

  return gaps;
}

/**
 * Extract an identifying value from a record to search for in the document.
 * Tries common ID-like fields in priority order.
 */
function findRecordIdentifier(rec: RecordRow): string | null {
  const candidates = ['cost_code', 'name', 'id', 'code', 'number', 'description', 'ref_number'];
  for (const key of candidates) {
    const val = rec[key];
    if (!val) continue;
    const raw = val.value;
    if (raw === null || raw === undefined) continue;
    const str = String(raw).trim();
    if (str.length > 0 && str.length < 100) return str;
  }
  // Fallback: first non-null string/number field
  for (const [, val] of Object.entries(rec)) {
    if (!val || val.value === null || val.value === undefined) continue;
    const str = String(val.value).trim();
    if (str.length > 2 && str.length < 50) return str;
  }
  return null;
}

/**
 * Search sourceText for an identifier and return surrounding context.
 * Uses section-header heuristics for numeric IDs, plain text search otherwise.
 */
function findDocumentExcerpt(sourceText: string, identifier: string, radius: number): string | null {
  const numericId = /^\d{1,4}$/.test(identifier) ? identifier.padStart(3, '0') : null;

  let searchIdx = -1;
  if (numericId) {
    // Numeric identifiers often appear as section headers ("011 - Description")
    const headerPattern = new RegExp(`^\\s*${numericId}\\s*-\\s*`, 'm');
    const match = headerPattern.exec(sourceText);
    if (match) {
      searchIdx = match.index;
    }
  }

  // Fallback: plain text search
  if (searchIdx === -1) {
    searchIdx = sourceText.indexOf(identifier);
  }
  if (searchIdx === -1) return null;

  let excerptStart = Math.max(0, searchIdx - 100);
  let excerptEnd = Math.min(sourceText.length, searchIdx + radius);

  if (numericId) {
    // For numbered sections, try to find a totals/summary row within the section
    const sectionText = sourceText.slice(searchIdx, Math.min(sourceText.length, searchIdx + 5000));
    const totalsIdx = sectionText.search(/totals?\b/i);
    if (totalsIdx !== -1) {
      const absoluteTotals = searchIdx + totalsIdx;
      excerptStart = Math.max(0, absoluteTotals - 200);
      excerptEnd = Math.min(sourceText.length, absoluteTotals + radius);
    }
  }

  return sourceText.slice(excerptStart, excerptEnd).trim();
}

/**
 * Build a human-readable hint for what value should be extracted.
 * Uses the schema description when available, falling back to a generic message.
 */
function buildFieldHint(_scope: string, field: string, identifier: string, schemaDescription?: string): string {
  if (schemaDescription) {
    return `Extract "${field}" (${schemaDescription}) from this section for record "${identifier}".`;
  }
  return `This field should have a real value extracted from the document section for "${identifier}".`;
}

export async function runPostExtractionValidation(
  input: ValidationInput,
): Promise<ValidationOutput> {
  const { pipelineLogId, skillId, collections, meta, tailText, sourceText } = input;
  let fields = { ...input.fields };
  let checkResults: CheckResult[] = [];
  let reconciliationScore = 100;
  let identityScore = 100;
  let qualityScore = 100;
  let reextractAttempts = 0;
  const resolvedChecks: string[] = [];

  // ── Schema coverage check (before consistency checks) ──
  let { results: coverageResults, gaps: qualityGaps } = await checkFieldCoverage(skillId, fields, collections);

  // Attach concrete document evidence to each gap for better "improve parser" prompts
  if (qualityGaps.length > 0 && sourceText) {
    qualityGaps = attachGapEvidence(qualityGaps, sourceText, collections);
    const withEvidence = qualityGaps.filter(g => g.evidence && g.evidence.length > 0).length;
    if (withEvidence > 0) {
      console.log(`[validator] Evidence attached to ${withEvidence}/${qualityGaps.length} gap(s)`);
    }
  }

  // Store quality gaps on parser cache entry for future "improve parser" runs
  if (qualityGaps.length > 0 && input.usedCachedParserId) {
    try {
      await updateParserQualityGaps(input.usedCachedParserId, qualityGaps);
    } catch { /* non-fatal */ }
  }

  // Run check → fix → recheck loop
  for (let attempt = 0; attempt <= MAX_REEXTRACT_RETRIES; attempt++) {
    const evalCtx = buildContext(fields, collections, meta ?? {});

    try {
      checkResults = await evaluateConsistencyChecks(skillId, evalCtx);
      reconciliationScore = computeReconciliationScore(checkResults);
      identityScore = computeIdentityScore(checkResults);
      qualityScore = computeQualityScore(checkResults);
      console.log(
        `[validator] Checks for skill=${skillId} (attempt ${attempt + 1}): ` +
        `identity=${identityScore}% quality=${qualityScore}% overall=${reconciliationScore}% ` +
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
      r.check_role !== 'anomaly' &&
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

  // Classify final failures using check_role (three-tier) rather than the legacy classification column
  // Merge schema coverage results with consistency check results
  checkResults = [...coverageResults, ...checkResults];
  // Recompute scores including coverage checks
  if (coverageResults.length > 0) {
    reconciliationScore = computeReconciliationScore(checkResults);
    identityScore = computeIdentityScore(checkResults);
    qualityScore = computeQualityScore(checkResults);
  }

  const extractionErrors = checkResults.filter(r => r.status === 'fail' && r.check_role !== 'anomaly');
  const docAnomalies = checkResults.filter(r => r.status === 'fail' && r.check_role === 'anomaly');

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
        : (r.check_role === 'anomaly' ? 'anomaly' : 'withheld'),
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

    console.log(`[validator] Stored ${validationFlags.length} check results on pipeline_log, identity=${identityScore}% quality=${qualityScore}%`);
  } catch (err) {
    console.error(`[validator] Failed to store check results:`, err);
  }

  // ── Parser cache promotion ──
  // Promote when all identity checks pass (accounting equations hold).
  const anomalyFlagsList = getAnomalyFlags(checkResults);

  if (identityScore === 100 && input.generatedCode && input.formatFingerprint && !input.usedCachedParserId) {
    try {
      const checksPassed = checkResults.filter(r => r.status === 'pass').length;
      await promoteParser({
        skill_id: skillId,
        format_fingerprint: input.formatFingerprint,
        parser_code: input.generatedCode,
        promoted_from: pipelineLogId,
        identity_score: identityScore,
        quality_score: qualityScore,
        checks_passed: checksPassed,
        checks_total: checkResults.length,
        meta: qualityGaps.length > 0 ? { quality_gaps: qualityGaps } : {},
      });
      console.log(`[validator] Parser promoted to cache: skill=${skillId} format=${input.formatFingerprint}`);
    } catch (err) {
      console.error(`[validator] Parser promotion failed (non-fatal):`, err);
    }
  }

  if (identityScore === 100 && input.usedCachedParserId) {
    try {
      await incrementValidated(input.usedCachedParserId);
      console.log(`[validator] Cached parser validated: id=${input.usedCachedParserId}`);
    } catch (err) {
      console.error(`[validator] Cache increment failed (non-fatal):`, err);
    }
  }

  return {
    checkResults,
    reconciliationScore,
    identityScore,
    qualityScore,
    anomalyFlags: anomalyFlagsList,
    withheldFields,
    anomalyFields,
    correctedFields: fields,
    reextractAttempts,
    resolvedChecks,
  };
}
