/**
 * Pattern-First Extraction with Schema Mapping
 *
 * Two-step flow:
 *   1. generatePatternScript(): Opus writes a short regex Python script from a
 *      ~5K char document sample. The script uses the document's own terminology
 *      (not schema field names) and reads /tmp/source_text.txt.
 *   2. mapToSchema(): Opus maps raw extracted field names to schema field names.
 *      Fields with no match become confirmed_absent.
 *
 * The pattern script + mapping config are cached together in parser_cache.meta.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { ExtractionSandbox, type ExtractionFile } from './sandbox';
import type { LangfuseParent } from './langfuse';

// ── Zod Schemas ──────────────────────────────────────────────

const TableMappingSchema = z.object({
  raw_table: z.string(),
  schema_table: z.string(),
  field_mapping: z.record(z.string(), z.string()),
});

export const MappingConfigSchema = z.object({
  doc_field_mapping: z.record(z.string(), z.string()),
  tables: z.array(TableMappingSchema),
});
export type MappingConfig = z.infer<typeof MappingConfigSchema>;

export const TestCaseSchema = z.object({
  identifier: z.string(),
  field: z.string(),
  expected: z.union([z.number(), z.string()]),
});
export type TestCase = z.infer<typeof TestCaseSchema>;

export const PatternParserMetaSchema = z.object({
  parser_type: z.literal('pattern'),
  mapping_config: MappingConfigSchema,
  confirmed_absent: z.array(z.string()),
  sample_test_cases: z.array(TestCaseSchema),
});
export type PatternParserMeta = z.infer<typeof PatternParserMetaSchema>;

const SchemaMappingResponseSchema = z.object({
  doc_field_mapping: z.record(z.string(), z.string()).default({}),
  tables: z.array(z.object({
    raw_table: z.string(),
    schema_table: z.string(),
    field_mapping: z.record(z.string(), z.string()),
  })).default([]),
  confirmed_absent: z.array(z.string()).default([]),
});

const PatternScriptOutputSchema = z.object({
  doc_fields: z.record(z.string(), z.unknown()).optional().default({}),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).optional().default({}),
});

export const SchemaFieldInfoSchema = z.object({
  schemaName: z.string(),
  scope: z.string(),
  type: z.string(),
  description: z.string(),
  extractionHint: z.string().optional(),
  required: z.boolean(),
});
export type SchemaFieldInfo = z.infer<typeof SchemaFieldInfoSchema>;

export interface PatternExtractionResult {
  patternScript: string;
  rawOutput: Record<string, unknown>;
  mappingConfig: MappingConfig;
  confirmedAbsent: string[];
  testCases: TestCase[];
  tokens: { input: number; output: number };
}

// ── Pattern Script Generation ────────────────────────────────

const PATTERN_SCRIPT_SYSTEM = `You are a data extraction engineer. Your job is to write a short Python script that extracts ALL structured, recurring data from a document using regex and string parsing.

RULES:
- Read the full document from /tmp/source_text.txt
- Write output to /tmp/output.json using json.dump()
- Use the document's OWN terminology for field names (column headers, labels)
- Do NOT invent field names — use exactly what you see in the document
- Extract ALL recurring patterns: tables, line items, section summaries, totals
- For numeric values, extract exact numbers. Strip commas, handle negatives/parentheses.
- Keep the script under 200 lines. Use only: re, json, os, sys, collections
- Output structure: {"doc_fields": {...}, "tables": {"table_name": [rows...]}}
  where doc_fields are document-level values and tables hold repeating records
- Print a brief summary to stdout (counts, etc.) for debugging
- CRITICAL: Do NOT truncate or limit output. Extract ALL rows across ALL pages.`;

export async function generatePatternScript(
  sampleText: string,
  langfuseParent?: LangfuseParent,
): Promise<{ script: string; inputTokens: number; outputTokens: number }> {
  const client = new Anthropic();

  const trimmed = sampleText.slice(0, 5000);
  const userMessage = `Here is a sample from the document (~5K chars from the beginning). Identify ALL recurring structured patterns and write a Python regex script to extract them from the full document.

<document_sample>
${trimmed}
</document_sample>

Write the complete Python script now. Output ONLY Python code, no explanation.`;

  const generation = langfuseParent?.generation({
    name: 'pattern-script-generate',
    model: 'claude-opus-4-6',
    input: { sampleLength: trimmed.length },
    modelParameters: { maxTokens: 8192 },
  });

  const t0 = Date.now();
  console.log(`[pattern] Generating pattern script from ${trimmed.length} char sample`);

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 8192,
    system: PATTERN_SCRIPT_SYSTEM,
    messages: [{ role: 'user', content: userMessage }],
  });

  const elapsed = Date.now() - t0;
  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('[pattern] No text in pattern script response');
  }

  const script = extractPythonCode(textBlock.text);
  if (script.length < 20) {
    throw new Error(`[pattern] Generated script is suspiciously short (${script.length} chars)`);
  }

  generation?.end({
    output: script.slice(0, 2000),
    usage: { input: response.usage?.input_tokens ?? 0, output: response.usage?.output_tokens ?? 0 },
    metadata: { elapsedMs: elapsed, scriptLength: script.length },
  });

  console.log(
    `[pattern] Script generated in ${elapsed}ms (${script.length} chars) ` +
    `tokens=${response.usage?.input_tokens}in/${response.usage?.output_tokens}out`,
  );

  return {
    script,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
}

// ── Schema Mapping ───────────────────────────────────────────

const SCHEMA_MAPPING_SYSTEM = `You are a data mapping specialist. Your job is to map raw extracted field/column names to a target schema. Each table needs its OWN field mapping because different tables can have different columns that map to different schema fields.

RULES:
- Map doc-level fields separately from table-level fields.
- For each table, provide a per-table field_mapping from raw column names to schema field names.
- If a raw field has NO reasonable match in the schema, skip it.
- If a schema field has NO match anywhere in the raw output, add it to confirmed_absent.
- Be precise with matching: "Original Budget" → "original_budget", "JTD Cost" → "jtd_cost", etc.
- Case-insensitive matching is fine: "Cost Code" → "cost_code".
- Output ONLY valid JSON — no explanation.`;

export async function mapToSchema(
  rawOutput: Record<string, unknown>,
  schemaFields: SchemaFieldInfo[],
  langfuseParent?: LangfuseParent,
): Promise<{ mappingConfig: MappingConfig; confirmedAbsent: string[] }> {
  const client = new Anthropic();

  const rawKeys = describeRawOutput(rawOutput);

  // Group schema fields by scope for clarity in the prompt
  const byScope = new Map<string, SchemaFieldInfo[]>();
  for (const f of schemaFields) {
    const list = byScope.get(f.scope) || [];
    list.push(f);
    byScope.set(f.scope, list);
  }

  let schemaDesc = '';
  for (const [scope, fields] of byScope) {
    schemaDesc += `\n### Scope: "${scope}"${scope === 'doc' ? ' (document-level fields)' : ` (table records)`}\n`;
    schemaDesc += fields.map(f => {
      let line = `- "${f.schemaName}" (${f.type}): ${f.description}`;
      if (f.extractionHint) line += ` | Hint: ${f.extractionHint}`;
      return line;
    }).join('\n');
    schemaDesc += '\n';
  }

  const userMessage = `Map these raw extracted fields to the target schema.

## Raw output structure
${rawKeys}

## Target schema fields (grouped by scope)
${schemaDesc}

Respond with ONLY this JSON:
{
  "doc_field_mapping": { "raw_doc_field": "schema_field_name", ... },
  "tables": [
    {
      "raw_table": "raw_table_name_from_output",
      "schema_table": "schema_scope_name",
      "field_mapping": { "Raw Column Name": "schema_field_name", ... }
    }
  ],
  "confirmed_absent": ["schema_field_with_no_raw_match", ...]
}

IMPORTANT:
- "doc_field_mapping" maps raw doc_fields keys to "doc" scope schema fields.
- Each entry in "tables" maps a raw table to a schema scope AND provides per-column field_mapping.
- The first table entry is the "main records" table. Additional entries are secondary tables.
- field_mapping keys MUST be the EXACT column names from the raw table rows.`;

  const generation = langfuseParent?.generation({
    name: 'schema-mapping',
    model: 'claude-opus-4-6',
    input: { rawKeyCount: rawKeys.split('\n').length, schemaFieldCount: schemaFields.length },
    modelParameters: { maxTokens: 4096 },
  });

  const t0 = Date.now();
  console.log(`[pattern] Mapping raw output to schema: ${schemaFields.length} schema fields`);

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    system: SCHEMA_MAPPING_SYSTEM,
    messages: [{ role: 'user', content: userMessage }],
  });

  const elapsed = Date.now() - t0;
  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('[pattern] No text in schema mapping response');
  }

  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('[pattern] No JSON in schema mapping response');
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`[pattern] Invalid JSON in mapping response: ${e instanceof Error ? e.message : e}`);
  }

  const parsed = SchemaMappingResponseSchema.parse(rawJson);

  const mappingConfig: MappingConfig = {
    doc_field_mapping: parsed.doc_field_mapping,
    tables: parsed.tables,
  };

  generation?.end({
    output: parsed,
    usage: { input: response.usage?.input_tokens ?? 0, output: response.usage?.output_tokens ?? 0 },
    metadata: { elapsedMs: elapsed },
  });

  const totalFieldMappings = Object.keys(parsed.doc_field_mapping).length
    + parsed.tables.reduce((s, t) => s + Object.keys(t.field_mapping).length, 0);

  console.log(
    `[pattern] Mapping complete in ${elapsed}ms: ${totalFieldMappings} field mappings across ` +
    `${parsed.tables.length} table(s), ${parsed.confirmed_absent.length} confirmed absent`,
  );

  return {
    mappingConfig,
    confirmedAbsent: parsed.confirmed_absent,
  };
}

// ── Auto-Validation ──────────────────────────────────────────

/**
 * Validate the structure and quality of the pattern script's output.
 * Checks that the output has the expected shape and that tables aren't empty
 * or full of nulls. Returns failures (for retry) and test cases (for caching).
 */
export function autoValidate(
  _sampleText: string,
  rawOutput: Record<string, unknown>,
  _patternScript: string,
): { passed: boolean; failures: string[]; testCases: TestCase[] } {
  const testCases: TestCase[] = [];
  const failures: string[] = [];

  const parseResult = PatternScriptOutputSchema.safeParse(rawOutput);
  if (!parseResult.success) {
    failures.push(
      `Output shape invalid: ${parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
    return { passed: false, failures, testCases };
  }
  const { doc_fields: docFields, tables } = parseResult.data;

  for (const [key, val] of Object.entries(docFields)) {
    if (val === null || val === undefined) continue;
    const strVal = String(val).trim();
    if (strVal.length === 0) continue;
    testCases.push({ identifier: 'doc', field: key, expected: typeof val === 'number' ? val : strVal });
  }

  for (const [tableName, rows] of Object.entries(tables)) {
    if (rows.length === 0) {
      failures.push(`Table "${tableName}" has 0 rows — script likely failed to parse`);
      continue;
    }
    const firstRow = rows[0];
    const totalFields = Object.keys(firstRow).length;
    const nonNullCount = Object.values(firstRow).filter(v => v !== null && v !== undefined && v !== 0).length;
    if (totalFields > 0 && nonNullCount / totalFields < 0.3) {
      failures.push(
        `Table "${tableName}" first row has ${nonNullCount}/${totalFields} non-null fields — likely a parsing issue`,
      );
    }
  }

  if (Object.keys(docFields).length === 0 && Object.keys(tables).length === 0) {
    failures.push('Output has no doc_fields and no tables — script extracted nothing');
  }

  return { passed: failures.length === 0, failures, testCases };
}

// ── Apply Mapping ────────────────────────────────────────────

/**
 * Transform raw pattern script output using the scoped mapping config
 * into the pipeline's expected shape: { fields, records, secondary_tables }.
 *
 * Each table has its own field_mapping so columns like "Cost Code" in one table
 * and "Cost Code" in another can map to different schema fields independently.
 */
export function applyMapping(
  rawOutput: Record<string, unknown>,
  mapping: MappingConfig,
): {
  fields: Record<string, { value: unknown; confidence: number; source?: string }>;
  records: Array<Record<string, unknown>>;
  secondary_tables: Record<string, Array<Record<string, unknown>>>;
} {
  const fields: Record<string, { value: unknown; confidence: number; source?: string }> = {};
  const records: Array<Record<string, unknown>> = [];
  const secondary_tables: Record<string, Array<Record<string, unknown>>> = {};

  const parsed = PatternScriptOutputSchema.safeParse(rawOutput);
  const docFields = parsed.success ? parsed.data.doc_fields : (rawOutput.doc_fields as Record<string, unknown> | undefined) ?? {};
  const tables = parsed.success ? parsed.data.tables : (rawOutput.tables as Record<string, Array<Record<string, unknown>>> | undefined) ?? {};

  // Map doc-level fields using doc_field_mapping
  for (const [rawName, schemaName] of Object.entries(mapping.doc_field_mapping)) {
    if (rawName in docFields) {
      fields[schemaName] = { value: docFields[rawName], confidence: 1.0, source: 'pattern-extract' };
    }
  }

  // Map each table using its per-table field_mapping
  for (let i = 0; i < mapping.tables.length; i++) {
    const tableMap = mapping.tables[i];
    const rawRows = tables[tableMap.raw_table];
    if (!rawRows || !Array.isArray(rawRows)) continue;

    const mappedRows = rawRows.map(row => mapRow(row, tableMap.field_mapping));

    if (i === 0) {
      // First table entry = main records
      records.push(...mappedRows);
    } else {
      // Subsequent entries = secondary tables
      secondary_tables[tableMap.schema_table] = mappedRows;
    }
  }

  const totalMapped = Object.keys(fields).length
    + (records.length > 0 ? Object.keys(records[0] || {}).length : 0);
  console.log(
    `[pattern] applyMapping: ${Object.keys(fields).length} doc fields, ` +
    `${records.length} main records, ` +
    `${Object.entries(secondary_tables).map(([k, v]) => `${k}=${v.length}`).join(', ') || '0'} secondary rows`,
  );

  return { fields, records, secondary_tables };
}

/**
 * Map a single row's fields using a per-table field mapping.
 * Mapped fields take their schema name; unmapped fields pass through with raw name.
 */
function mapRow(
  rawRow: Record<string, unknown>,
  fieldMapping: Record<string, string>,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  const usedRawKeys = new Set<string>();

  for (const [rawField, schemaField] of Object.entries(fieldMapping)) {
    if (rawField in rawRow) {
      mapped[schemaField] = rawRow[rawField];
      usedRawKeys.add(rawField);
    }
  }

  for (const [key, val] of Object.entries(rawRow)) {
    if (!usedRawKeys.has(key) && !(key in mapped)) {
      mapped[key] = val;
    }
  }

  return mapped;
}

// ── Full Pattern Extraction Pipeline ─────────────────────────

const PATTERN_MAX_RETRIES = 1;

export async function runPatternExtraction(
  sourceText: string,
  schemaFields: SchemaFieldInfo[],
  inputFiles: ExtractionFile[],
  options?: { langfuseParent?: LangfuseParent },
): Promise<PatternExtractionResult> {
  const sampleText = sourceText.slice(0, 5000);

  let lastError: string | undefined;
  let script: string | undefined;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let attempt = 0; attempt <= PATTERN_MAX_RETRIES; attempt++) {
    const retryContext = lastError
      ? `\n\nPrevious script FAILED with this error:\n${lastError}\n\nFix the issues and try again.`
      : '';

    if (attempt === 0 || lastError) {
      const gen = await generatePatternScript(
        sampleText + retryContext,
        options?.langfuseParent,
      );
      script = gen.script;
      totalInputTokens += gen.inputTokens;
      totalOutputTokens += gen.outputTokens;
    }

    if (!script) throw new Error('[pattern] No script generated');

    const sandboxFiles: ExtractionFile[] = [
      ...inputFiles,
      { path: '/tmp/source_text.txt', content: Buffer.from(sourceText, 'utf-8') },
    ];

    console.log(`[pattern] Executing pattern script in sandbox (attempt ${attempt + 1})`);
    const tExec = Date.now();
    const result = await ExtractionSandbox.execute(script, sandboxFiles);
    const execMs = Date.now() - tExec;
    console.log(`[pattern] Script executed in ${execMs}ms: exitCode=${result.exitCode}`);

    if (result.exitCode !== 0) {
      console.warn(`[pattern] Script failed: ${result.stderr.slice(0, 500)}`);
      if (attempt < PATTERN_MAX_RETRIES) {
        lastError = result.stderr.slice(0, 2000);
        continue;
      }
      throw new Error(`[pattern] Script failed after ${PATTERN_MAX_RETRIES + 1} attempts: ${result.stderr.slice(0, 500)}`);
    }

    let rawJson: unknown;
    try {
      rawJson = JSON.parse(result.stdout);
    } catch {
      const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        if (attempt < PATTERN_MAX_RETRIES) {
          lastError = `No JSON in output. stdout: ${result.stdout.slice(0, 500)}`;
          continue;
        }
        throw new Error(`[pattern] No JSON in script output`);
      }
      try {
        rawJson = JSON.parse(jsonMatch[0]);
      } catch (e) {
        if (attempt < PATTERN_MAX_RETRIES) {
          lastError = `Invalid JSON: ${e instanceof Error ? e.message : e}`;
          continue;
        }
        throw new Error(`[pattern] Invalid JSON in script output: ${e instanceof Error ? e.message : e}`);
      }
    }

    const rawOutput = rawJson as Record<string, unknown>;

    const validation = autoValidate(sampleText, rawOutput, script);
    if (!validation.passed) {
      console.warn(`[pattern] Auto-validation failed: ${validation.failures.join('; ')}`);
      if (attempt < PATTERN_MAX_RETRIES) {
        lastError = `Auto-validation failed:\n${validation.failures.join('\n')}`;
        continue;
      }
    }

    const { mappingConfig, confirmedAbsent } = await mapToSchema(
      rawOutput,
      schemaFields,
      options?.langfuseParent,
    );

    MappingConfigSchema.parse(mappingConfig);

    const totalFieldMappings2 = Object.keys(mappingConfig.doc_field_mapping).length
      + mappingConfig.tables.reduce((s, t) => s + Object.keys(t.field_mapping).length, 0);
    console.log(
      `[pattern] Pattern extraction complete: ` +
      `${totalFieldMappings2} mapped fields across ${mappingConfig.tables.length} table(s), ` +
      `${confirmedAbsent.length} confirmed absent`,
    );

    return {
      patternScript: script,
      rawOutput,
      mappingConfig,
      confirmedAbsent,
      testCases: validation.testCases,
      tokens: { input: totalInputTokens, output: totalOutputTokens },
    };
  }

  throw new Error('[pattern] Exhausted all retry attempts');
}

// ── Helpers ──────────────────────────────────────────────────

function extractPythonCode(text: string): string {
  const fenced = text.match(/```(?:python)?\s*\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  const openIdx = text.lastIndexOf('```python');
  if (openIdx !== -1) return text.slice(openIdx + '```python'.length).trim();

  const openPlain = text.lastIndexOf('```\n');
  if (openPlain !== -1) return text.slice(openPlain + '```\n'.length).trim();

  return text.trim();
}

function describeRawOutput(raw: Record<string, unknown>): string {
  const lines: string[] = [];

  const docFields = raw.doc_fields as Record<string, unknown> | undefined;
  if (docFields) {
    lines.push('## doc_fields (document-level values):');
    for (const [key, val] of Object.entries(docFields)) {
      const preview = val === null ? 'null' : typeof val === 'string' ? `"${String(val).slice(0, 60)}"` : String(val);
      lines.push(`  - "${key}": ${preview}`);
    }
  }

  const tables = raw.tables as Record<string, unknown[]> | undefined;
  if (tables) {
    lines.push('## tables (repeating records):');
    for (const [tableName, rows] of Object.entries(tables)) {
      if (!Array.isArray(rows)) continue;
      lines.push(`  ### "${tableName}" (${rows.length} rows)`);
      if (rows.length > 0) {
        const firstRow = rows[0] as Record<string, unknown>;
        const colNames = Object.keys(firstRow);
        lines.push(`  Columns (${colNames.length}): ${colNames.map(k => `"${k}"`).join(', ')}`);
        const sample = Object.entries(firstRow).slice(0, 6).map(([k, v]) => {
          const preview = v === null ? 'null' : typeof v === 'string' ? `"${String(v).slice(0, 40)}"` : String(v);
          return `${k}=${preview}`;
        }).join(', ');
        lines.push(`  Sample row: { ${sample} }`);
      }
    }
  }

  return lines.join('\n');
}
