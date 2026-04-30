/**
 * Agentic Extraction: Opus as Developer
 *
 * Gives Opus 6 tools (search_text, read_page, read_lines, run_code,
 * validate_output, check_consistency) and lets it iteratively develop
 * an extraction script — exactly like a human developer in Cursor.
 *
 * Only runs on cache miss; the resulting script is cached for reuse.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { Sandbox } from '@vercel/sandbox';
import type { ExtractionFile } from './sandbox';
import {
  evaluateConsistencyChecks,
  computeIdentityScore,
  computeQualityScore,
  type CheckResult,
} from './consistency-evaluator';
import type { EvalContext } from './derived-evaluator';
import type { LangfuseParent } from './langfuse';
import { getSupabase } from './supabase';

// ── Types ────────────────────────────────────────────────────

export interface SchemaFieldDef {
  name: string;
  scope: string;
  type: string;
  description: string;
  extractionHint?: string | null;
  required: boolean;
}

export interface AgentExtractionResult {
  fields: Record<string, { value: unknown; confidence: number }>;
  records: Array<Record<string, unknown>>;
  secondaryTables: Record<string, Array<Record<string, unknown>>>;
  script: string;
  confirmedAbsent: string[];
  agentToolCalls: number;
  compositeScore: number;
  inputTokens: number;
  outputTokens: number;
  activityLog: ActivityEntry[];
}

interface IterationSnapshot {
  iteration: number;
  populatedFields: Set<string>;
  recordCounts: Record<string, number>;
  checksTotal: number;
  checksPassed: number;
  compositeScore: number;
  script: string;
  outputRaw: unknown;
}

interface AgentState {
  messages: Anthropic.Messages.MessageParam[];
  bestSnapshot: IterationSnapshot | null;
  iterationHistory: IterationSnapshot[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalToolCalls: number;
  activityLog: ActivityEntry[];
}

export interface ActivityEntry {
  round: number;
  timestamp: string;
  type: 'reasoning' | 'tool_call' | 'tool_result' | 'status';
  content: string;
  toolName?: string;
}

// ── Tool Definitions (Anthropic format) ──────────────────────

const AGENT_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'search_text',
    description:
      'Regex search across all pages of the document. Returns matching lines with line numbers, page numbers, and 1 line of surrounding context. Use this to find patterns, locate sections, and navigate the document without reading every page.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: {
          type: 'string',
          description: 'Regex pattern to search for across all pages.',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of matches to return. Default 20.',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'read_page',
    description:
      'Returns the full text of a specific page (1-based). Use for reading natural document sections like page 1 for headers or the last page for totals.',
    input_schema: {
      type: 'object' as const,
      properties: {
        page_number: {
          type: 'number',
          description: 'Page number (1-based).',
        },
      },
      required: ['page_number'],
    },
  },
  {
    name: 'read_lines',
    description:
      'Returns a range of lines from the full document (1-based, inclusive). Lines include their line numbers. Can span page boundaries. Use after search_text to zoom into specific areas.',
    input_schema: {
      type: 'object' as const,
      properties: {
        start_line: {
          type: 'number',
          description: 'First line number to return (1-based, inclusive).',
        },
        end_line: {
          type: 'number',
          description: 'Last line number to return (1-based, inclusive).',
        },
      },
      required: ['start_line', 'end_line'],
    },
  },
  {
    name: 'run_code',
    description:
      'Execute Python code in a persistent sandbox. The document text is at /tmp/source_text.txt. Write extraction output to /tmp/output.json. The sandbox persists between calls so you can build incrementally. Returns stdout, stderr, and exit code.',
    input_schema: {
      type: 'object' as const,
      properties: {
        code: {
          type: 'string',
          description: 'Python code to execute.',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'validate_output',
    description:
      'Reads /tmp/output.json from the sandbox and validates it against the schema. Reports per-scope field counts, null/zero rates, sample values from the first 3 records, and record counts. Also flags regressions vs the best iteration so far.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'check_consistency',
    description:
      'Runs identity and structural consistency checks against the current /tmp/output.json. Reports pass/fail for each check with specific values and error messages. Also reports the overall pass rate and flags regressions.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// ── Output schema ────────────────────────────────────────────

const AgentOutputSchema = z.object({
  fields: z.record(z.string(), z.unknown()).default({}),
  records: z.array(z.record(z.string(), z.unknown())).default([]),
  secondary_tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).default({}),
});

// ── Document holder ──────────────────────────────────────────

class DocumentContext {
  readonly pages: string[];
  readonly allLines: string[];
  readonly fullText: string;
  private readonly lineToPage: number[];

  constructor(pages: string[]) {
    this.pages = pages;
    this.allLines = [];
    this.lineToPage = [];

    for (let pi = 0; pi < pages.length; pi++) {
      this.allLines.push(`--- PAGE ${pi + 1} ---`);
      this.lineToPage.push(pi + 1);
      const pageLines = pages[pi].split('\n');
      for (const line of pageLines) {
        this.allLines.push(line);
        this.lineToPage.push(pi + 1);
      }
    }

    this.fullText = this.allLines.join('\n');
  }

  get pageCount(): number {
    return this.pages.length;
  }

  get lineCount(): number {
    return this.allLines.length;
  }

  searchText(pattern: string, maxResults = 20): string {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, 'gi');
    } catch {
      return `Error: Invalid regex pattern "${pattern}"`;
    }

    const matches: string[] = [];
    for (let i = 0; i < this.allLines.length && matches.length < maxResults; i++) {
      if (regex.test(this.allLines[i])) {
        const page = this.lineToPage[i];
        const ctx: string[] = [];
        if (i > 0) ctx.push(`  ${i}| ${this.allLines[i - 1]}`);
        ctx.push(`> ${i + 1}| ${this.allLines[i]}`);
        if (i < this.allLines.length - 1) ctx.push(`  ${i + 2}| ${this.allLines[i + 1]}`);
        matches.push(`Page ${page}, Line ${i + 1}:\n${ctx.join('\n')}`);
        regex.lastIndex = 0;
      }
    }

    if (matches.length === 0) return `No matches found for pattern "${pattern}".`;
    return `Found ${matches.length} match(es):\n\n${matches.join('\n\n')}`;
  }

  readPage(pageNumber: number): string {
    if (pageNumber < 1 || pageNumber > this.pages.length) {
      return `Error: Page ${pageNumber} out of range (1-${this.pages.length}).`;
    }
    return `--- PAGE ${pageNumber} ---\n${this.pages[pageNumber - 1]}`;
  }

  readLines(startLine: number, endLine: number): string {
    const s = Math.max(1, startLine) - 1;
    const e = Math.min(this.allLines.length, endLine);
    if (s >= e) return `Error: Invalid line range ${startLine}-${endLine}.`;
    const lines: string[] = [];
    for (let i = s; i < e; i++) {
      lines.push(`${String(i + 1).padStart(5)}| ${this.allLines[i]}`);
    }
    return lines.join('\n');
  }
}

// ── Validate output helper ───────────────────────────────────

function validateOutputJson(
  raw: unknown,
  schemaFields: SchemaFieldDef[],
  bestSnapshot: IterationSnapshot | null,
): string {
  const parsed = AgentOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return `Error: Output is not valid JSON or doesn't match expected shape.\n${parsed.error.message}`;
  }
  const fields = parsed.data.fields as Record<string, unknown>;
  const records = parsed.data.records as Array<Record<string, unknown>>;
  const secondaryTables = parsed.data.secondary_tables as Record<string, Array<Record<string, unknown>>>;

  const report: string[] = [];

  const docFields = schemaFields.filter(f => f.scope === 'doc');
  const populatedDoc = docFields.filter(f => fields[f.name] != null && fields[f.name] !== '');
  report.push(`## Document-level fields: ${populatedDoc.length}/${docFields.length} populated`);
  const nullDoc = docFields.filter(f => fields[f.name] == null || fields[f.name] === '');
  if (nullDoc.length > 0) {
    report.push(`  Null/empty: ${nullDoc.map(f => f.name).join(', ')}`);
  }
  if (populatedDoc.length > 0) {
    report.push(`  Sample values:`);
    for (const f of populatedDoc.slice(0, 8)) {
      report.push(`    ${f.name}: ${JSON.stringify(fields[f.name])}`);
    }
  }

  const scopes = [...new Set(schemaFields.filter(f => f.scope !== 'doc').map(f => f.scope))];
  for (const scope of scopes) {
    const scopeFields = schemaFields.filter(f => f.scope === scope);
    const scopeRecords: Record<string, unknown>[] = scope === 'records' ? records : (secondaryTables[scope] ?? []);
    report.push(`\n## ${scope}: ${scopeRecords.length} records, ${scopeFields.length} schema fields`);
    if (scopeRecords.length > 0) {
      const nullRates: Record<string, number> = {};
      for (const f of scopeFields) {
        const nullCount = scopeRecords.filter(
          (r: Record<string, unknown>) => r[f.name] == null || r[f.name] === '',
        ).length;
        nullRates[f.name] = nullCount / scopeRecords.length;
      }
      const nullFields = Object.entries(nullRates)
        .filter(([, r]) => r > 0)
        .sort((a, b) => b[1] - a[1]);
      if (nullFields.length > 0) {
        report.push(`  Fields with nulls:`);
        for (const [name, rate] of nullFields) {
          report.push(`    ${name}: ${Math.round(rate * 100)}% null (${Math.round(rate * scopeRecords.length)}/${scopeRecords.length})`);
        }
      }
      report.push(`  First record sample:`);
      for (const [k, v] of Object.entries(scopeRecords[0]).slice(0, 10)) {
        report.push(`    ${k}: ${JSON.stringify(v)}`);
      }
    }
  }

  const allPopulated = new Set<string>();
  for (const f of docFields) {
    if (fields[f.name] != null && fields[f.name] !== '') allPopulated.add(f.name);
  }
  for (const scope of scopes) {
    const scopeRecords: Record<string, unknown>[] = scope === 'records' ? records : (secondaryTables[scope] ?? []);
    const scopeFields = schemaFields.filter(f => f.scope === scope);
    for (const f of scopeFields) {
      const hasAny = scopeRecords.some((r: Record<string, unknown>) => r[f.name] != null && r[f.name] !== '');
      if (hasAny) allPopulated.add(`${scope}.${f.name}`);
    }
  }

  if (bestSnapshot) {
    const lost = [...bestSnapshot.populatedFields].filter(f => !allPopulated.has(f));
    const gained = [...allPopulated].filter(f => !bestSnapshot.populatedFields.has(f));
    if (lost.length > 0) {
      report.push(`\n## WARNING: REGRESSION detected`);
      report.push(`  Fields lost vs best iteration (${bestSnapshot.iteration}): ${lost.join(', ')}`);
      report.push(`  Best had ${bestSnapshot.populatedFields.size} populated fields, current has ${allPopulated.size}.`);
    }
    if (gained.length > 0) {
      report.push(`\n## Improvement: ${gained.length} new fields populated: ${gained.join(', ')}`);
    }
  }

  return report.join('\n');
}

// ── System prompt builder ────────────────────────────────────

function buildSystemPrompt(
  schemaFields: SchemaFieldDef[],
  pageCount: number,
  lineCount: number,
  contextHints?: string,
): string {
  const byScope = new Map<string, SchemaFieldDef[]>();
  for (const f of schemaFields) {
    const list = byScope.get(f.scope) ?? [];
    list.push(f);
    byScope.set(f.scope, list);
  }

  let schemaBlock = '';
  for (const [scope, fields] of byScope.entries()) {
    schemaBlock += `\n### Scope: ${scope}\n`;
    for (const f of fields) {
      schemaBlock += `- **${f.name}** (${f.type}${f.required ? ', required' : ''}): ${f.description}`;
      if (f.extractionHint) schemaBlock += ` | Hint: ${f.extractionHint}`;
      schemaBlock += '\n';
    }
  }

  return `You are an expert data extraction developer. Your task is to write a Python script that extracts structured data from a document.

## Document Info
- Pages: ${pageCount}
- Total lines: ${lineCount}
- The full document text is available at /tmp/source_text.txt in the sandbox (with --- PAGE N --- delimiters between pages).

## Target Schema
${schemaBlock}

## Output Format
Your script must write /tmp/output.json with this structure:
{
  "fields": { "<schema_field_name>": <value>, ... },
  "records": [ { "<schema_field_name>": <value>, ... }, ... ],
  "secondary_tables": { "<scope_name>": [ { "<schema_field_name>": <value>, ... }, ... ] }
}

- "fields" contains document-level (scope=doc) values.
- "records" contains the primary repeating records.
- "secondary_tables" contains any other scoped collections, keyed by scope name.
- Use the EXACT schema field names shown above.
- Fields that genuinely don't exist in this document should be null.
- Numeric values should be numbers, not strings. Remove commas and handle sign conventions.

## Your Workflow
1. Use search_text to find key patterns (headers, totals, section markers). Limit exploration to ~5 rounds.
2. Use read_page and read_lines to inspect specific sections you found.
3. Write a COMPLETE Python extraction script that writes JSON to /tmp/output.json. Do this EARLY — even if incomplete.
4. Call validate_output to check field coverage and spot nulls.
5. Call check_consistency to verify the extracted values satisfy mathematical relationships.
6. If there are issues, fix your script and re-run. Iterate until quality is acceptable.

## CRITICAL RULES
- You have LIMITED TIME. Your #1 priority is to produce /tmp/output.json with valid JSON.
- DO NOT spend all your time debugging with print(). Write the full output.json FIRST, then iterate.
- Every run_code call MUST write /tmp/output.json (even if partial). Never just print debug output.
- Your script must: read /tmp/source_text.txt, parse it, write a JSON dict to /tmp/output.json AND print it to stdout.
- After EVERY run_code that succeeds, call validate_output to check progress.
- Build your script incrementally. Start simple, then add complexity.
- The script must be deterministic — no randomness or external API calls.
- Pay attention to number formats: commas in thousands (1,234.56), negative signs, parenthesized negatives.
- Some documents have "smashed" numbers where two values run together without a separator.
- Always verify your record counts match what you see in the document.${contextHints ? `\n\n## Document-Type Specific Guidance\n${contextHints}` : ''}`;
}

// ── Build EvalContext from parsed output ──────────────────────

function buildEvalContext(
  parsed: z.infer<typeof AgentOutputSchema>,
  schemaFields: SchemaFieldDef[],
): EvalContext {
  const doc: Record<string, number | string | null> = {};
  for (const [k, v] of Object.entries(parsed.fields)) {
    doc[k] = v == null ? null : (typeof v === 'number' || typeof v === 'string' ? v : null);
  }

  const collections: Record<string, Record<string, number | string | null>[]> = {};
  const records = parsed.records as Array<Record<string, unknown>>;
  if (records.length > 0) {
    const primaryScope = schemaFields.find(f => f.scope !== 'doc')?.scope ?? 'records';
    collections[primaryScope] = records.map((r: Record<string, unknown>) => {
      const row: Record<string, number | string | null> = {};
      for (const [k, v] of Object.entries(r)) {
        row[k] = v == null ? null : (typeof v === 'number' || typeof v === 'string' ? v : null);
      }
      return row;
    });
  }
  const secondaryTables = parsed.secondary_tables as Record<string, Array<Record<string, unknown>>>;
  for (const [scope, rows] of Object.entries(secondaryTables)) {
    collections[scope] = rows.map((r: Record<string, unknown>) => {
      const row: Record<string, number | string | null> = {};
      for (const [k, v] of Object.entries(r)) {
        row[k] = v == null ? null : (typeof v === 'number' || typeof v === 'string' ? v : null);
      }
      return row;
    });
  }

  return { doc, collections, meta: {} };
}

// ── Main agent loop ──────────────────────────────────────────

const MAX_AGENT_ROUNDS = 40;
const RESULT_TRUNCATE = 30_000;

export interface RunExtractionAgentOptions {
  skillId: string;
  schemaFields: SchemaFieldDef[];
  pages: string[];
  inputFiles: ExtractionFile[];
  langfuseParent?: LangfuseParent;
  startedAt?: number;
  maxDurationMs?: number;
  resumeState?: AgentState;
  pipelineLogId?: string;
  /** Skill-specific extraction hints appended to the system prompt */
  contextHints?: string;
}

export async function runExtractionAgent(
  options: RunExtractionAgentOptions,
): Promise<AgentExtractionResult> {
  const {
    skillId,
    schemaFields,
    pages,
    inputFiles,
    startedAt = Date.now(),
    maxDurationMs = 420_000,
    pipelineLogId,
  } = options;

  const sb_db = pipelineLogId ? getSupabase() : null;

  const EXTRACTION_PACKAGES = [
    'openpyxl', 'pdfplumber', 'pandas', 'numpy', 'xlrd',
    'python-docx', 'docx2txt', 'olefile', 'python-pptx', 'pymupdf',
  ];
  const EXEC_TIMEOUT = 120_000;

  const doc = new DocumentContext(pages);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt = buildSystemPrompt(schemaFields, doc.pageCount, doc.lineCount, options.contextHints);

  // Build sandbox input files: source_text.txt + any raw file (PDF bytes, etc.)
  const sandboxFiles: ExtractionFile[] = [
    ...inputFiles,
    { path: '/tmp/source_text.txt', content: Buffer.from(doc.fullText, 'utf-8') },
  ];

  // Persistent sandbox — boots once, reused across all run_code calls
  let sb: (Sandbox & AsyncDisposable) | null = null;
  let lastOutputRaw: unknown = null;
  let bestValidatedOutput: unknown = null;
  let lastScript = '';

  async function ensureSandbox(): Promise<Sandbox & AsyncDisposable> {
    if (sb) return sb;

    const creds = {
      apiKey: process.env.SANDBOX_API_KEY,
      teamId: process.env.SANDBOX_TEAM_ID,
    };
    const snapshotId = process.env.EXTRACTION_SNAPSHOT_ID;

    if (snapshotId) {
      sb = await Sandbox.create({
        ...creds,
        source: { type: 'snapshot', snapshotId },
        timeout: 10 * 60_000,
        networkPolicy: 'deny-all',
      });
    } else {
      sb = await Sandbox.create({
        ...creds,
        runtime: 'python3.13',
        timeout: 10 * 60_000,
      });
      const pipResult = await sb.runCommand('pip', ['install', '-q', ...EXTRACTION_PACKAGES]);
      if (pipResult.exitCode !== 0) {
        const stderr = await pipResult.stderr();
        throw new Error(`pip install failed: ${stderr.slice(0, 2000)}`);
      }
      await sb.updateNetworkPolicy('deny-all');
    }

    await sb.writeFiles(sandboxFiles.map(f => ({ path: f.path, content: f.content })));
    return sb;
  }

  const state: AgentState = options.resumeState ?? {
    messages: [{ role: 'user', content: 'Begin extracting data from this document. Start by exploring its structure.' }],
    bestSnapshot: null,
    iterationHistory: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalToolCalls: 0,
    activityLog: [],
  };

  function logActivity(round: number, type: ActivityEntry['type'], content: string, toolName?: string) {
    const entry: ActivityEntry = {
      round,
      timestamp: new Date().toISOString(),
      type,
      content: content.slice(0, 2000),
      ...(toolName ? { toolName } : {}),
    };
    state.activityLog.push(entry);
    const prefix = toolName ? `[${toolName}] ` : '';
    console.log(`[extraction-agent] R${round} ${type}: ${prefix}${content.slice(0, 300)}`);
  }

  async function checkpoint(round: number) {
    if (!sb_db || !pipelineLogId) return;
    try {
      await sb_db.from('pipeline_log').update({
        agent_activity_log: state.activityLog,
        agent_best_script: state.bestSnapshot?.script ?? lastScript ?? null,
        agent_best_output: state.bestSnapshot?.outputRaw ?? bestValidatedOutput ?? lastOutputRaw ?? null,
        agent_composite_score: state.bestSnapshot?.compositeScore ?? null,
        agent_rounds: round + 1,
        agent_tool_calls: state.totalToolCalls,
      }).eq('id', pipelineLogId);
    } catch (err) {
      console.warn(`[extraction-agent] Checkpoint write failed (non-fatal):`, err);
    }
  }

  async function handleToolCall(
    name: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    state.totalToolCalls++;

    switch (name) {
      case 'search_text': {
        const pattern = String(input.pattern ?? '');
        const max = typeof input.max_results === 'number' ? input.max_results : 20;
        return doc.searchText(pattern, max);
      }
      case 'read_page': {
        const page = typeof input.page_number === 'number' ? input.page_number : 1;
        return doc.readPage(page);
      }
      case 'read_lines': {
        const start = typeof input.start_line === 'number' ? input.start_line : 1;
        const end = typeof input.end_line === 'number' ? input.end_line : start + 50;
        return doc.readLines(start, end);
      }
      case 'run_code': {
        const code = String(input.code ?? '');
        lastScript = code;
        const sandbox = await ensureSandbox();
        await sandbox.writeFiles([{ path: '/tmp/extract.py', content: Buffer.from(code) }]);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), EXEC_TIMEOUT);
        let result;
        try {
          result = await sandbox.runCommand('python3', ['/tmp/extract.py'], {
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }

        let output = '';
        if (result.exitCode !== 0) {
          const stderr = await result.stderr();
          const stdout = await result.stdout();
          output = `Exit code: ${result.exitCode}\nSTDERR:\n${stderr.slice(0, 5000)}`;
          if (stdout) output += `\nSTDOUT:\n${stdout.slice(0, 2000)}`;
          console.log(`[extraction-agent] run_code FAILED: exit=${result.exitCode} stderr=${stderr.slice(0, 200)}`);
        } else {
          output = `Exit code: 0`;
          let captured = false;
          // Try to read /tmp/output.json
          try {
            const buf = await sandbox.readFileToBuffer({ path: '/tmp/output.json' });
            if (buf && buf.length > 0) {
              const jsonStr = buf.toString('utf-8');
              lastOutputRaw = JSON.parse(jsonStr);
              captured = true;
              output += `\nOutput written to /tmp/output.json (${jsonStr.length} bytes)`;
              console.log(`[extraction-agent] run_code OK: read /tmp/output.json (${jsonStr.length} bytes)`);
            }
          } catch (fileErr) {
            console.log(`[extraction-agent] run_code: /tmp/output.json read failed: ${fileErr instanceof Error ? fileErr.message : String(fileErr)}`);
          }
          // Fall back to stdout if no output.json
          if (!captured) {
            try {
              const stdout = await result.stdout();
              if (stdout) {
                output += `\nSTDOUT:\n${stdout.slice(0, 5000)}`;
                try {
                  lastOutputRaw = JSON.parse(stdout);
                  captured = true;
                  console.log(`[extraction-agent] run_code OK: parsed stdout as JSON (${stdout.length} chars)`);
                } catch {
                  console.log(`[extraction-agent] run_code OK: stdout not JSON (${stdout.length} chars)`);
                }
              } else {
                output += `\n(no stdout)`;
                console.log(`[extraction-agent] run_code OK: no stdout and no output.json`);
              }
            } catch (stdoutErr) {
              console.log(`[extraction-agent] run_code: stdout read failed: ${stdoutErr instanceof Error ? stdoutErr.message : String(stdoutErr)}`);
            }
          }
        }
        return output;
      }
      case 'validate_output': {
        if (!lastOutputRaw) {
          return 'No output.json found. Run your extraction script first (it should write to /tmp/output.json and print the JSON to stdout).';
        }
        const validationResult = validateOutputJson(lastOutputRaw, schemaFields, state.bestSnapshot);
        // Checkpoint the output when it has more populated fields than the previous best.
        // This prevents later debug run_code calls from clobbering a valid extraction.
        const validParsed = AgentOutputSchema.safeParse(lastOutputRaw);
        if (validParsed.success) {
          const validFields = validParsed.data.fields as Record<string, unknown>;
          const populatedCount = Object.values(validFields).filter(v => v != null && v !== '').length;
          const prevParsed = AgentOutputSchema.safeParse(bestValidatedOutput);
          const prevCount = prevParsed.success
            ? Object.values(prevParsed.data.fields as Record<string, unknown>).filter(v => v != null && v !== '').length
            : 0;
          if (populatedCount > prevCount) {
            bestValidatedOutput = structuredClone(lastOutputRaw);
          }
        }
        return validationResult;
      }
      case 'check_consistency': {
        if (!lastOutputRaw) {
          return 'No output to check. Run your extraction script and validate_output first.';
        }
        const parsed = AgentOutputSchema.safeParse(lastOutputRaw);
        if (!parsed.success) return `Output doesn't match expected schema: ${parsed.error.message}`;

        const evalCtx = buildEvalContext(parsed.data, schemaFields);
        let checkResults: CheckResult[];
        try {
          checkResults = await evaluateConsistencyChecks(skillId, evalCtx);
        } catch (err) {
          return `Error running consistency checks: ${err instanceof Error ? err.message : String(err)}`;
        }

        if (checkResults.length === 0) {
          return 'No consistency checks defined for this skill. Rely on validate_output for quality assessment.';
        }

        const identity = computeIdentityScore(checkResults);
        const quality = computeQualityScore(checkResults);
        const passed = checkResults.filter(r => r.status === 'pass').length;

        const report: string[] = [
          `Identity score: ${identity}% | Quality score: ${quality}%`,
          `Checks: ${passed}/${checkResults.length} passed\n`,
        ];

        for (const r of checkResults) {
          const icon = r.status === 'pass' ? 'PASS' : 'FAIL';
          report.push(`[${icon}] ${r.display_name} (${r.check_role}): ${r.message}`);
        }

        if (state.bestSnapshot && passed < state.bestSnapshot.checksPassed) {
          report.push(`\nWARNING: REGRESSION — ${state.bestSnapshot.checksPassed} checks passed in best iteration (${state.bestSnapshot.iteration}), now only ${passed}.`);
        }

        // Track this iteration
        const allPopulated = new Set<string>();
        const parsedFields = parsed.data.fields as Record<string, unknown>;
        const parsedRecords = parsed.data.records as Array<Record<string, unknown>>;
        const parsedSecondary = parsed.data.secondary_tables as Record<string, Array<Record<string, unknown>>>;
        for (const [k, v] of Object.entries(parsedFields)) {
          if (v != null && v !== '') allPopulated.add(k);
        }

        const snapshot: IterationSnapshot = {
          iteration: state.iterationHistory.length + 1,
          populatedFields: allPopulated,
          recordCounts: {
            records: parsedRecords.length,
            ...Object.fromEntries(
              Object.entries(parsedSecondary).map(([k, v]) => [k, v.length]),
            ),
          },
          checksTotal: checkResults.length,
          checksPassed: passed,
          compositeScore: quality,
          script: lastScript,
          outputRaw: lastOutputRaw,
        };
        state.iterationHistory.push(snapshot);

        if (!state.bestSnapshot || quality > state.bestSnapshot.compositeScore) {
          state.bestSnapshot = snapshot;
        }

        report.push(`\nComposite score: ${quality}% (best so far: ${state.bestSnapshot.compositeScore}%)`);
        return report.join('\n');
      }
      default:
        return `Unknown tool: ${name}`;
    }
  }

  // ── Agentic loop ─────────────────────────────────────────

  let timeNudgeSent = false;

  try {
    for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
      const elapsed = Date.now() - startedAt;
      if (elapsed > maxDurationMs - 60_000) {
        logActivity(round, 'status', `Approaching timeout at round ${round}, elapsed=${elapsed}ms — stopping loop`);
        console.log(`[extraction-agent] Approaching timeout at round ${round}, elapsed=${elapsed}ms`);
        break;
      }

      // Time-aware nudge: when past 60% of budget and no output yet, push the agent to produce results
      if (!timeNudgeSent && elapsed > maxDurationMs * 0.6 && !lastOutputRaw) {
        timeNudgeSent = true;
        const remaining = Math.round((maxDurationMs - elapsed) / 1000);
        const nudge = `URGENT: You have ~${remaining} seconds remaining. You MUST write /tmp/output.json NOW with your best extraction so far. ` +
          `Write a complete script that outputs valid JSON with fields, records, and secondary_tables. ` +
          `You can iterate after, but produce output FIRST. Every subsequent run_code MUST write /tmp/output.json.`;
        state.messages.push({ role: 'user', content: nudge });
        logActivity(round, 'status', `Time nudge sent: ${remaining}s remaining, no output yet`);
        console.log(`[extraction-agent] Time nudge sent at round ${round}: ${remaining}s remaining`);
      }

      const response = await client.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 16384,
        system: systemPrompt,
        messages: state.messages,
        tools: AGENT_TOOLS,
      });

      state.totalInputTokens += response.usage.input_tokens;
      state.totalOutputTokens += response.usage.output_tokens;

      state.messages.push({ role: 'assistant', content: response.content });

      // Log reasoning text from this round
      for (const block of response.content) {
        if (block.type === 'text' && block.text.trim()) {
          logActivity(round, 'reasoning', block.text);
        }
      }

      if (response.stop_reason === 'end_turn') {
        logActivity(round, 'status', `Agent finished (stop_reason=end_turn, tokens: ${response.usage.input_tokens}in/${response.usage.output_tokens}out)`);
        console.log(`[extraction-agent] Agent finished at round ${round}, stop_reason=end_turn`);
        break;
      }

      const toolBlocks = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
      );

      if (toolBlocks.length === 0) {
        logActivity(round, 'status', 'No tool calls in response, stopping');
        console.log(`[extraction-agent] No tool calls at round ${round}, stopping`);
        break;
      }

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const block of toolBlocks) {
        const inputSummary = block.name === 'run_code'
          ? `(${(String((block.input as Record<string, unknown>).code ?? '')).length} chars of Python)`
          : JSON.stringify(block.input).slice(0, 200);
        logActivity(round, 'tool_call', inputSummary, block.name);
        console.log(`[extraction-agent] Tool call: ${block.name}`);
        try {
          const result = await handleToolCall(block.name, block.input as Record<string, unknown>);
          const truncated = result.length > RESULT_TRUNCATE
            ? result.slice(0, RESULT_TRUNCATE) + '\n...[truncated]'
            : result;
          logActivity(round, 'tool_result', result.slice(0, 1000), block.name);
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: truncated });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logActivity(round, 'tool_result', `ERROR: ${msg}`, block.name);
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${msg}`, is_error: true });
        }
      }

      state.messages.push({ role: 'user', content: toolResults });

      // Checkpoint to Supabase after every round with a run_code or check_consistency
      const hadSignificantTool = toolBlocks.some(b => b.name === 'check_consistency' || b.name === 'run_code');
      if (hadSignificantTool) {
        await checkpoint(round);
      }
    }
  } finally {
    if (sb) await sb.stop({ blocking: true }).catch(() => {});
  }

  // Final checkpoint with complete state
  await checkpoint(state.iterationHistory.length - 1);

  // ── Build result from best validated output (fall back to last output) ──

  console.log(`[extraction-agent] Final state: rounds=${state.activityLog.filter(e => e.type === 'reasoning').length} toolCalls=${state.totalToolCalls} lastOutputRaw=${lastOutputRaw ? 'present' : 'null'} bestValidatedOutput=${bestValidatedOutput ? 'present' : 'null'}`);

  // Priority: bestSnapshot.outputRaw (from check_consistency) > bestValidatedOutput (from validate_output) > lastOutputRaw
  // This prevents the agent from clobbering good output with debug code in later run_code calls.
  const finalOutputRaw = state.bestSnapshot?.outputRaw ?? bestValidatedOutput ?? lastOutputRaw;

  let parsed = AgentOutputSchema.safeParse(finalOutputRaw);
  if (!parsed.success && finalOutputRaw !== lastOutputRaw) {
    // Best validated output was invalid; fall back to lastOutputRaw
    console.log(`[extraction-agent] Best output parse failed, trying lastOutputRaw: ${parsed.error.message.slice(0, 200)}`);
    parsed = AgentOutputSchema.safeParse(lastOutputRaw);
  }
  if (!parsed.success) {
    console.log(`[extraction-agent] Output parse failed: ${parsed.error.message.slice(0, 300)}`);
    console.log(`[extraction-agent] finalOutputRaw type=${typeof finalOutputRaw}, keys=${finalOutputRaw && typeof finalOutputRaw === 'object' ? Object.keys(finalOutputRaw as Record<string, unknown>).join(',') : 'n/a'}`);
  }

  const dataFields = (parsed.success ? parsed.data.fields : {}) as Record<string, unknown>;
  const dataRecords = (parsed.success ? parsed.data.records : []) as Array<Record<string, unknown>>;
  const dataSecondary = (parsed.success ? parsed.data.secondary_tables : {}) as Record<string, Array<Record<string, unknown>>>;

  console.log(`[extraction-agent] Result: ${Object.keys(dataFields).length} fields, ${dataRecords.length} records, ${Object.keys(dataSecondary).length} secondary tables`);
  const fields: Record<string, { value: unknown; confidence: number }> = {};
  for (const [k, v] of Object.entries(dataFields)) {
    fields[k] = { value: v, confidence: 1.0 };
  }

  const confirmedAbsent = schemaFields
    .filter(f => f.scope === 'doc' && (dataFields[f.name] == null || dataFields[f.name] === ''))
    .map(f => f.name);

  return {
    fields,
    records: dataRecords,
    secondaryTables: dataSecondary,
    script: state.bestSnapshot?.script || lastScript,
    confirmedAbsent,
    agentToolCalls: state.totalToolCalls,
    compositeScore: state.bestSnapshot?.compositeScore ?? 0,
    inputTokens: state.totalInputTokens,
    outputTokens: state.totalOutputTokens,
    activityLog: state.activityLog,
  };
}
