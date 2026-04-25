/**
 * Code-gen extraction: Claude writes a Python parser, the sandbox executes it.
 *
 * Flow:
 *   1. Build a meta-prompt with skill fields + context card fields + discovery instructions
 *   2. Ask Claude Sonnet to generate a Python script that extracts data from the document
 *   3. Run the script in an ExtractionSandbox (openpyxl, pdfplumber, pandas pre-installed)
 *   4. Parse the JSON output, retry once on failure with the error message
 *   5. Normalize into ExtractionResult + discovered_fields
 */

import Anthropic from '@anthropic-ai/sdk';
import { ExtractionSandbox, type ExtractionFile } from './sandbox';
import { ExtractionResult, type ExtractedField } from './pipeline';
import type { FieldDefinition, DocumentSkill } from './skills';
import type { LangfuseParent } from './langfuse';
import { fingerprintDocument } from './format-fingerprint';
import { getActiveParser, recordCacheFailure } from './stores/parser-cache.store';

const MAX_RETRIES = 2;

export interface CodegenExtractionResult {
  extraction: ExtractionResult;
  discoveredFields: Record<string, unknown>;
  metadata: {
    pagesProcessed?: number;
    parserMethod?: string;
    warnings?: string[];
    retries: number;
    generatedCode?: string;
    formatFingerprint?: string;
    formatLabel?: string;
    usedCachedParserId?: string;
    codegenInputTokens?: number;
    codegenOutputTokens?: number;
    sandboxElapsedMs?: number;
  };
}

// ── Meta-prompt builder ──────────────────────────────────────

function buildMetaPrompt(
  skill: DocumentSkill,
  catalogFields: FieldDefinition[],
  contextCardFields: string[],
  fileExt: string,
  scopedFields?: Map<string, FieldDefinition[]>,
): string {
  const fieldDescriptions = catalogFields.map(f => {
    let line = `- "${f.name}" (${f.type}${f.required ? ', REQUIRED' : ''}): ${f.description}`;
    if (Array.isArray(f.options) && f.options.length) line += ` | Valid values: ${f.options.join(', ')}`;
    if (f.disambiguationRules) line += ` | Note: ${f.disambiguationRules}`;
    return line;
  }).join('\n');

  const contextOnlyFields = contextCardFields.filter(
    cf => !catalogFields.some(sf => sf.name === cf)
  );

  const contextFieldSection = contextOnlyFields.length > 0
    ? `\n## Context Card Fields (also required)\nThese fields are referenced by downstream analytics cards and MUST be extracted:\n${contextOnlyFields.map(f => `- "${f}"`).join('\n')}\n`
    : '';

  const fileTypeHint = getFileTypeHint(fileExt);

  const recordScopes = scopedFields
    ? [...scopedFields.entries()].filter(([s]) => s !== 'doc')
    : null;

  let secondaryTableSection = '';
  let recordsFieldList = '';

  if (recordScopes && recordScopes.length > 0) {
    const primaryScope = recordScopes[0];
    recordsFieldList = JSON.stringify(primaryScope[1].map(f => f.name));

    if (recordScopes.length > 1) {
      secondaryTableSection = `\n## Secondary Tables (REQUIRED)\nIn addition to the main "records" array, you MUST also extract these secondary data tables and include them under "secondary_tables" in the output JSON.\n`;

      for (const [scope, scopeFields] of recordScopes.slice(1)) {
        secondaryTableSection += `\n### Table: "${scope}"\nExtract one row per line item. Columns:\n`;
        secondaryTableSection += scopeFields.map(f => `- "${f.name}": ${f.description}`).join('\n');
        secondaryTableSection += '\n';
      }
    }

    if (skill.skillId === 'job_cost_report') {
      secondaryTableSection += `
### JCR-Specific Parsing Hints for "payroll_transactions"
This is a **Sage 300 Construction (Timberline) Job Cost Report (JDR)** PDF. It contains cost-code sections, payroll transactions, and Job Totals.

## Document Structure (Sage JDR)
1. **Header**: Job number, job name, company, report period, report date
2. **Cost Code Sections** (100+ pages): Each section starts with a header line like:
   \`\`\`
   011 - DS & RD Labor                Original Budget    Revised Budget    Open Commits    JTD Cost    Over/Under Budget
   \`\`\`
3. **Cost Code Totals Row**: At the end of each cost code section, the totals row has columns:
   \`Original Budget | Revised Budget | Open Commits | JTD Cost | Over/Under Budget | Regular Hours | Overtime Hours\`
   - Hours columns are ONLY present for labor codes (011, 100-199) — material/subcontract codes have no hours
   - **CRITICAL**: The column order matters! Over/Under Budget = actual − budget (positive = over budget). Do NOT swap JTD Cost and Over/Under.
4. **Payroll (PR) Transaction Lines**: Inside each cost code section, PR lines have this format:
   \`\`\`
   PR  <ref_number>  <date>  <employee_code>  <Worker Name>
   MM/DD/YY  Regular: <hours> hours  <AMOUNT>
   \`\`\`
   - The **worker name** is the LAST element on the PR header line — it MUST be captured as the \`name\` field. Example:
     \`PR  166  09/11/13  4235  John Smith\` → name="John Smith"
     Regex: \`r'PR\\s+\\d+\\s+\\d{2}/\\d{2}/\\d{2}\\s+\\d+\\s+(.+)'\` — group(1) is the name. NEVER leave name as null.
   - The hours/amounts appear on the NEXT line(s)
   - \`<AMOUNT>\` after "Regular:" is the **BASE WAGE** (not burdened)
   - Overtime lines appear as: \`MM/DD/YY  Overtime: <hours> hours  <AMOUNT>\`
   - Some workers span multiple cost codes — group by worker name
   - **CRITICAL — DOLLAR AMOUNTS**: Every hours line has a dollar amount as the LAST number. Do NOT default to 0.
   - Example regex for parsing hours lines:
     \`\`\`python
     # "09/13/13  Regular: 7.00 hours    192.50"
     hours_pat = re.compile(r'(\\d{2}/\\d{2}/\\d{2})\\s+(Regular|Overtime|Double Time):\\s*([\\d.]+)\\s*hours?\\s+([\\d,.]+)')
     m = hours_pat.search(line)
     if m:
         hours = float(m.group(3))
         amount = float(m.group(4).replace(',', ''))  # NEVER default to 0
     \`\`\`
5. **Burden Codes** (995, 998): Special cost codes for payroll burden and taxes
   - 995 = Payroll Burden (benefits, insurance)
   - 998 = Payroll Taxes (FICA, FUTA, SUTA)
   - These have budget and actual amounts but NO individual PR transaction lines
6. **Revenue Code 999**: Negative in Sage (credit). Use abs() for revenue-related fields.
7. **Job Totals Section** (end of document):
   - "Revenue" or "Total AR Billings": negative number in Sage → use abs()
   - "Total Expenses": positive, sum of all cost code actuals
   - "Net" or "Net Profit": Revenue − Expenses
   - "Retainage": amount held back
   - **"by Source"** subsection: breaks expenses into PR, AP, GL totals
     - PR total here is BURDENED (includes 995/998 burden allocation)

## Parsing Strategy
1. Iterate every page with pdfplumber
2. Extract text line by line; detect cost-code section headers (pattern: 3-digit code + " - " + description)
3. Track the current cost code as you move through pages
4. For each PR line, extract: name, number, regular_hours, overtime_hours, regular_amount, overtime_amount, actual_amount, cost_code, source, document_date, posted_date, check_number, description
5. Include ALL PR lines from ALL cost codes — there may be thousands across 100+ pages
6. Do NOT stop early or truncate — capture every single payroll transaction line
7. At the end, parse the "Job Totals" section for revenue, expenses, net, retainage, and by-source breakdowns
`;
    }
  } else {
    secondaryTableSection = buildSecondaryTableSection(skill);
    if (skill.multiRecordConfig?.fields) {
      recordsFieldList = JSON.stringify(skill.multiRecordConfig.fields);
    }
  }

  return `You are a data extraction engineer. Your job is to write a Python script that extracts structured data from a document.

## Document Type
This document is a "${skill.displayName}" (skill: ${skill.skillId}).
${skill.systemPrompt ? `\nContext: ${skill.systemPrompt}` : ''}

## Required Fields (from schema)
Extract these fields with confidence scores and source citations:
${fieldDescriptions}
${contextFieldSection}
## Output Format
Your Python script MUST print a single JSON object to stdout with this structure:

\`\`\`json
{
  "fields": {
    "Field Name": {"value": <extracted_value>, "confidence": 0.0-1.0, "source": "where in the document this was found"},
    ...
  },
  "records": [
    {"column_a": <val>, "column_b": <val>, ...},
    ...
  ],${secondaryTableSection ? `
  "secondary_tables": {
    "table_name": [
      {"col_a": <val>, "col_b": <val>, ...},
      ...
    ]
  },` : ''}
  "discovered_fields": {
    "descriptive_key": <any structured data found beyond required fields>,
    ...
  },
  "metadata": {
    "pages_parsed": <int or null>,
    "parser_method": "regex|structured_text|table_parsing|...",
    "warnings": ["any issues encountered"]
  }
}
\`\`\`

Rules:
- "fields" MUST contain ALL required fields listed above. Use \`null\` value and low confidence if not found.
- "records" is for multi-row data (line items, cost codes, pay apps, workers, etc.). Omit if the document has no tabular data.${recordsFieldList ? `
- "records" MUST use EXACTLY these column names (verbatim, case-sensitive): ${recordsFieldList}. Each record object must use these as keys. Do NOT rename, abbreviate, or rephrase them.` : ''}${secondaryTableSection ? `
- "secondary_tables" MUST be populated with the tables described below. Each table is an array of flat row objects (no nested {value, confidence} wrappers — just plain values).` : ''}
- "discovered_fields" is for ANY other valuable structured data you find that isn't in the required fields. Examples: breakdowns, subtotals, cross-references, summary tables, metadata. Be generous — extract everything useful.
- confidence: 1.0 = copied verbatim from document, 0.9 = calculated/derived from document data, 0.7-0.8 = inferred with high certainty, <0.7 = uncertain
- source: brief description of where in the document the value was found (page number, section, table header, etc.)
- IMPORTANT: Write the JSON to the file \`/tmp/output.json\` using compact encoding (no indent). Do NOT print large JSON to stdout — it will be truncated for large documents. Use: \`with open("/tmp/output.json", "w") as f: json.dump(output, f, default=str)\`
- You may print short progress/status messages to stdout for debugging.
${secondaryTableSection || ''}
## File Handling
${fileTypeHint}
The document content is available at \`/tmp/input${fileExt ? '.' + fileExt : ''}\`.

## Parsing Strategy
1. First, read and inspect the document structure
2. Identify sections, tables, headers, and key data points
3. Use regex and string parsing for structured text; use openpyxl for Excel; use pdfplumber for PDFs with tables
4. For numerical values: extract EXACT numbers from the document. Do NOT estimate or round.
5. For totals: verify by summing components when possible. Include both the stated total and calculated total if they differ.
6. Cross-reference values across sections when the same data appears in multiple places.

Write the complete Python script now. Use only the standard library plus: pandas, numpy, openpyxl, pdfplumber, xlrd, python-docx, docx2txt, olefile, python-pptx.`;
}

/** @deprecated Fallback for skills not yet migrated to scoped skill_fields. */
function buildSecondaryTableSection(skill: DocumentSkill): string {
  const secondaryTables = skill.multiRecordConfig?.secondaryTables;
  if (!secondaryTables?.length) return '';

  let section = `\n## Secondary Tables (REQUIRED)\nIn addition to the main "records" array, you MUST also extract these secondary data tables and include them under "secondary_tables" in the output JSON.\n`;

  for (const st of secondaryTables) {
    section += `\n### Table: "${st.table}"\nExtract one row per line item. Columns:\n`;
    section += st.fields.map(f => `- "${f}"`).join('\n');
    section += '\n';
  }

  if (skill.skillId === 'job_cost_report') {
    section += `
### JCR-Specific Parsing Hints for "payroll_transactions"
This is a **Sage 300 Construction (Timberline) Job Cost Report (JDR)** PDF.

## Document Structure
- Cost code sections start with: \`<3-digit code> - <Description>\`
- Cost Code Totals columns: Original Budget | Revised Budget | Open Commits | JTD Cost | Over/Under Budget | Regular Hours | Overtime Hours
- PR transaction lines: worker name on one line, hours/amounts on the next line(s)
- Format: \`PR <ref> <date> <emp_code> <Name>\` then \`MM/DD/YY Regular: N hours AMOUNT\`
- regular_amount = BASE WAGE (not burdened). Do NOT include burden codes 995/998.
- Burden codes: 995 = Payroll Burden, 998 = Payroll Taxes (have totals but no PR lines)
- Revenue code 999 is NEGATIVE in Sage — use abs() for revenue fields
- Job Totals section at end: Revenue, Expenses, Net, Retainage, "by Source" (PR/AP/GL)

Parsing strategy:
1. Iterate every page with pdfplumber
2. Detect cost-code headers (pattern: 3-digit code + " - " + description)
3. Track current cost code across pages
4. Extract ALL PR lines: name, hours, amounts, cost_code, source
5. Do NOT stop early or truncate — capture every payroll transaction
6. Parse Job Totals section at the end for summary fields
`;
  }

  return section;
}

function getFileTypeHint(fileExt: string): string {
  switch (fileExt.toLowerCase()) {
    case 'pdf':
      return `This is a PDF file. A pre-extracted text version is available at \`/tmp/source_text.txt\` (extracted with a fast local parser, covers ALL pages). You can use it for string/regex parsing:
\`\`\`python
with open("/tmp/source_text.txt", "r") as f:
    full_text = f.read()
\`\`\`
For higher-fidelity table extraction, you can also use pdfplumber on the original PDF:
\`\`\`python
import pdfplumber
with pdfplumber.open("/tmp/input.pdf") as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        tables = page.extract_tables()
\`\`\`
Tip: For large PDFs (100+ pages), prefer /tmp/source_text.txt for initial parsing — it's instant. Use pdfplumber selectively for pages that need table structure.`;
    case 'xlsx':
      return `This is an Excel (.xlsx) file. Use openpyxl to preserve cell types, merged cells, and formulas:
\`\`\`python
import openpyxl
wb = openpyxl.load_workbook("/tmp/input.xlsx", data_only=True)
for sheet_name in wb.sheetnames:
    ws = wb[sheet_name]
    for row in ws.iter_rows(values_only=True):
        ...
\`\`\`
Tips: Use data_only=True to get computed values instead of formulas. Check ws.merged_cells.ranges for merged regions. Iterate ws.iter_rows(min_row=, max_row=) for specific ranges.`;
    case 'xls':
      return `This is a legacy Excel (.xls) file. Use xlrd:
\`\`\`python
import xlrd
wb = xlrd.open_workbook("/tmp/input.xls")
for sheet in wb.sheets():
    for row_idx in range(sheet.nrows):
        row = [sheet.cell_value(row_idx, col) for col in range(sheet.ncols)]
\`\`\`
Tips: xlrd only supports .xls (BIFF format). Date cells need xlrd.xldate_as_tuple() conversion.`;
    case 'docx':
      return `This is a Word (.docx) file. Use python-docx to extract paragraphs AND tables with full structure:
\`\`\`python
from docx import Document
doc = Document("/tmp/input.docx")
for para in doc.paragraphs:
    text = para.text
    style = para.style.name  # e.g. 'Heading 1', 'Normal'
for table in doc.tables:
    for row in table.rows:
        cells = [cell.text for cell in row.cells]
\`\`\`
Tips: Tables often contain the key structured data. Check para.style.name for headings vs body text. Use doc.sections for page layout info.`;
    case 'doc':
      return `This is a legacy Word (.doc) file. Use docx2txt for text extraction, or olefile for raw OLE access:
\`\`\`python
import docx2txt
text = docx2txt.process("/tmp/input.doc")
\`\`\`
If docx2txt fails, fall back to olefile:
\`\`\`python
import olefile
ole = olefile.OleFileIO("/tmp/input.doc")
if ole.exists("WordDocument"):
    stream = ole.openstream("WordDocument").read()
\`\`\`
Tips: Legacy .doc files may lose table formatting. Extract what you can from the raw text and use regex for structured fields.`;
    case 'pptx':
      return `This is a PowerPoint (.pptx) file. Use python-pptx to extract text from slides and tables:
\`\`\`python
from pptx import Presentation
prs = Presentation("/tmp/input.pptx")
for slide in prs.slides:
    for shape in slide.shapes:
        if shape.has_text_frame:
            for para in shape.text_frame.paragraphs:
                text = para.text
        if shape.has_table:
            table = shape.table
            for row in table.rows:
                cells = [cell.text for cell in row.cells]
\`\`\`
Tips: Check shape.shape_type for charts, images, etc. Slide notes are in slide.notes_slide.notes_text_frame.`;
    case 'csv':
      return `This is a CSV file. Use pandas:
\`\`\`python
import pandas as pd
df = pd.read_csv("/tmp/input.csv")
\`\`\`
Tips: Try different encodings (encoding='utf-8-sig' or 'latin-1') if parsing fails. Use df.to_dict('records') for row iteration.`;
    case 'txt':
    case 'md':
      return `This is a plain text file. Read directly:
\`\`\`python
with open("/tmp/input.${fileExt}", "r", encoding="utf-8") as f:
    content = f.read()
lines = content.splitlines()
\`\`\`
Tips: Use regex for structured extraction. Look for key-value patterns like "Field: Value" or tabular data separated by tabs/pipes.`;
    case 'html':
    case 'htm':
      return `This is an HTML file. Parse with the standard library:
\`\`\`python
from html.parser import HTMLParser
import re
with open("/tmp/input.${fileExt}", "r", encoding="utf-8") as f:
    content = f.read()
text = re.sub(r'<[^>]+>', ' ', content)  # strip tags for simple extraction
\`\`\`
Tips: For tables, use regex to find <table>...</table> blocks and parse <tr>/<td> elements. Consider extracting data attributes from tags.`;
    case 'eml':
    case 'msg':
      return `This is an email file. Parse headers, body, and attachments:
\`\`\`python
import email
from email import policy
with open("/tmp/input.${fileExt}", "rb") as f:
    msg = email.message_from_binary_file(f, policy=policy.default)
subject = msg["subject"]
from_addr = msg["from"]
date = msg["date"]
body = msg.get_body(preferencelist=("plain", "html")).get_content()
\`\`\`
Tips: Check for attachments with msg.iter_attachments(). HTML body may need tag stripping.`;
    case 'json':
      return `This is a JSON file. Parse directly:
\`\`\`python
import json
with open("/tmp/input.json", "r") as f:
    data = json.load(f)
\`\`\``;
    case 'xml':
      return `This is an XML file. Use ElementTree:
\`\`\`python
import xml.etree.ElementTree as ET
tree = ET.parse("/tmp/input.xml")
root = tree.getroot()
\`\`\`
Tips: Handle namespaces with {namespace}tag syntax. Use root.iter() for recursive element search.`;
    default:
      return `Read the file as text (best effort):
\`\`\`python
with open("/tmp/input${fileExt ? '.' + fileExt : ''}", "r", errors="replace") as f:
    content = f.read()
\`\`\`
Tips: If the file is binary, try reading as bytes and decoding what you can.`;
  }
}

// ── Claude code generation ───────────────────────────────────

interface CodegenGenerationResult {
  code: string;
  inputTokens: number;
  outputTokens: number;
}

async function generateParserCode(
  client: Anthropic,
  metaPrompt: string,
  documentPreview: string,
  previousError?: string,
  langfuseParent?: LangfuseParent,
  previousCode?: string,
): Promise<CodegenGenerationResult> {
  const messages: Anthropic.MessageParam[] = [];

  if (previousError) {
    messages.push({
      role: 'user',
      content: `${metaPrompt}\n\nHere is a preview of the document content (head and tail sections):\n\`\`\`\n${documentPreview}\n\`\`\``,
    });
    messages.push({
      role: 'assistant',
      content: previousCode
        ? `I'll write a Python script to extract the data.\n\n\`\`\`python\n${previousCode}\n\`\`\``
        : 'I\'ll write a Python script to extract the data.',
    });
    messages.push({
      role: 'user',
      content: `The previous script failed with this error:\n\`\`\`\n${previousError}\n\`\`\`\n\nPlease fix the script. Output ONLY the corrected Python code.`,
    });
  } else {
    messages.push({
      role: 'user',
      content: `${metaPrompt}\n\nHere is a preview of the document content (head and tail sections):\n\`\`\`\n${documentPreview}\n\`\`\`\n\nWrite the complete Python extraction script now. Output ONLY Python code, no explanation.`,
    });
  }

  const generation = langfuseParent?.generation({
    name: previousError ? 'codegen-retry' : 'codegen-generate',
    model: 'claude-opus-4-6',
    input: {
      promptSummary: metaPrompt.slice(0, 500),
      documentPreviewLength: documentPreview.length,
      isRetry: !!previousError,
      ...(previousError ? { previousError: previousError.slice(0, 1000) } : {}),
    },
    modelParameters: { maxTokens: 32768 },
  });

  const stream = await client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 32768,
    messages,
  });

  const response = await stream.finalMessage();

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('[codegen] No text block in Claude response');
  }

  const code = extractPythonCode(textBlock.text);

  generation?.end({
    output: code,
    usage: { input: response.usage?.input_tokens ?? 0, output: response.usage?.output_tokens ?? 0 },
    metadata: {
      stopReason: response.stop_reason,
      codeLength: code.length,
      elapsedMs: Date.now() - (generation as any)?._startTime || 0,
    },
  });

  return {
    code,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
}

function extractPythonCode(text: string): string {
  // Match a complete fenced block anywhere in the response
  const fenced = text.match(/```(?:python)?\s*\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  // Handle truncated responses (max_tokens hit) — find the LAST ```python
  // fence even if it's not at the start (LLM often prefixes with explanation)
  const openIdx = text.lastIndexOf('```python');
  if (openIdx !== -1) {
    return text.slice(openIdx + '```python'.length).trim();
  }
  const openPlain = text.lastIndexOf('```\n');
  if (openPlain !== -1) {
    return text.slice(openPlain + '```\n'.length).trim();
  }

  return text.trim();
}

// ── Output parsing ───────────────────────────────────────────

interface RawCodegenOutput {
  fields: Record<string, { value: unknown; confidence: number; source?: string }>;
  records?: Array<Record<string, unknown>>;
  secondary_tables?: Record<string, Array<Record<string, unknown>>>;
  discovered_fields?: Record<string, unknown>;
  metadata?: {
    pages_parsed?: number;
    parser_method?: string;
    warnings?: string[];
  };
}

function parseCodegenOutput(stdout: string): RawCodegenOutput {
  // Try direct parse first (output file path — entire string is JSON)
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // Fall back to regex extraction (stdout may contain debug messages around the JSON)
    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`[codegen] No JSON object found in script output. stdout: ${stdout.slice(0, 500)}`);
    }
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      throw new Error(`[codegen] Failed to parse JSON from script output (${stdout.length} chars): ${e instanceof Error ? e.message : e}`);
    }
  }

  if (!parsed || typeof parsed !== 'object' || !('fields' in parsed)) {
    throw new Error('[codegen] Script output missing required "fields" key');
  }

  return parsed as RawCodegenOutput;
}

// ── Normalization ────────────────────────────────────────────

function normalizeToExtractionResult(
  raw: RawCodegenOutput,
  skill: DocumentSkill,
  classifierConfidence: number,
): CodegenExtractionResult {
  const fields: Record<string, ExtractedField> = {};

  for (const [key, val] of Object.entries(raw.fields)) {
    fields[key] = {
      value: val.value === undefined ? null : (val.value as string | number | null),
      confidence: typeof val.confidence === 'number' ? val.confidence : 0.5,
    };
  }

  const records = raw.records?.map(rec => {
    const normalized: Record<string, ExtractedField> = {};
    for (const [key, val] of Object.entries(rec)) {
      if (val && typeof val === 'object' && 'value' in val && 'confidence' in val) {
        normalized[key] = val as ExtractedField;
      } else {
        normalized[key] = { value: val as string | number | null, confidence: 0.9 };
      }
    }
    return normalized;
  });

  const extraction: ExtractionResult = {
    documentType: skill.skillId,
    documentTypeConfidence: classifierConfidence,
    fields,
    records,
    skillId: skill.skillId,
    skillVersion: skill.version,
    classifierConfidence,
  };

  if (raw.secondary_tables) {
    const targetTables: ExtractionResult['targetTables'] = [];
    for (const [tableName, rows] of Object.entries(raw.secondary_tables)) {
      if (!Array.isArray(rows)) continue;
      targetTables.push({
        table: tableName,
        records: rows.map(rec => {
          const normalized: Record<string, ExtractedField> = {};
          for (const [key, val] of Object.entries(rec)) {
            normalized[key] = { value: val as string | number | null, confidence: 0.9 };
          }
          return normalized;
        }),
      });
    }
    if (targetTables.length > 0) {
      extraction.targetTables = targetTables;
    }
  }

  return {
    extraction,
    discoveredFields: raw.discovered_fields ?? {},
    metadata: {
      pagesProcessed: raw.metadata?.pages_parsed ?? undefined,
      parserMethod: raw.metadata?.parser_method ?? 'codegen',
      warnings: raw.metadata?.warnings,
      retries: 0,
    },
  };
}

// ── JCR Post-Extraction Validation ───────────────────────────
// Quick self-consistency checks on the extracted data. Failures trigger
// an informed retry that includes the generated code + a structured report.

interface JcrValidationCheck {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  expected?: number;
  actual?: number;
  hint?: string;
}

function validateJcrExtraction(raw: RawCodegenOutput): { passed: boolean; checks: JcrValidationCheck[] } {
  const checks: JcrValidationCheck[] = [];

  const getFieldNum = (name: string): number | null => {
    const f = raw.fields[name];
    if (!f || f.value == null) return null;
    return typeof f.value === 'number' ? f.value : parseFloat(String(f.value));
  };

  const records = raw.records || [];
  const prTable = raw.secondary_tables?.payroll_transactions || [];

  // Check 1: Cost code records exist
  if (records.length === 0) {
    checks.push({ name: 'cost_code_records_exist', status: 'fail', hint: 'No cost code records extracted. Look for "Cost Code Totals" rows with columns: Original Budget | Revised Budget | Open Commits | JTD Cost | Over/Under Budget | Reg Hours | OT Hours' });
  } else {
    checks.push({ name: 'cost_code_records_exist', status: 'pass', actual: records.length });
  }

  // Check 2: PR transactions exist AND have dollar amounts
  if (prTable.length === 0) {
    checks.push({ name: 'payroll_transactions_exist', status: 'fail', hint: 'No payroll transactions extracted. PR lines appear inside each cost code section with format: "PR <ref> <date> <emp_code> <Name>" followed by hours/amounts on next lines.' });
  } else {
    checks.push({ name: 'payroll_transactions_exist', status: 'pass', actual: prTable.length });

    // Check 2b: PR transactions should have non-zero amounts
    const sampleSize = Math.min(prTable.length, 50);
    let withAmount = 0;
    for (let i = 0; i < sampleSize; i++) {
      const amt = toNum(prTable[i].actual_amount) || toNum(prTable[i].regular_amount) || toNum(prTable[i].amount);
      if (amt != null && amt !== 0) withAmount++;
    }
    if (withAmount === 0) {
      checks.push({ name: 'pr_transactions_have_amounts', status: 'fail', actual: 0, expected: sampleSize,
        hint: `All ${sampleSize} sampled PR transactions have zero/null dollar amounts. Each PR line should have actual_amount (the dollar figure after "Regular: N hours AMOUNT" or "Overtime: N hours AMOUNT"). The amount appears as the LAST number on the hours line, e.g. "09/13/13 Regular: 7.00 hours    192.50" → actual_amount=192.50, regular_amount=192.50. Parse the number after "hours" on each line.` });
    } else {
      checks.push({ name: 'pr_transactions_have_amounts', status: 'pass', actual: withAmount });
    }
  }

  // Check 3: JTD Cost should NOT equal Over/Under Budget for most codes (column swap detection)
  if (records.length > 5) {
    let swapCount = 0;
    for (const rec of records.slice(0, 20)) {
      const jtd = toNum(rec.jtd_cost);
      const oub = toNum(rec.over_under_budget);
      const orig = toNum(rec.original_budget);
      if (jtd != null && oub != null && orig != null && orig !== 0) {
        if (Math.abs(jtd - (orig - oub)) < 1 && Math.abs(oub - (orig - jtd)) > 10) {
          swapCount++;
        }
      }
    }
    if (swapCount > 3) {
      checks.push({ name: 'column_swap_detection', status: 'fail', actual: swapCount, hint: 'Likely JTD Cost / Over/Under Budget column swap. In Sage JDR, column order is: Original Budget | Revised Budget | Open Commits | JTD Cost | Over/Under Budget. Over/Under = actual − budget.' });
    } else {
      checks.push({ name: 'column_swap_detection', status: 'pass' });
    }
  }

  // Check 4: Job Totals — log if missing but don't fail (computed from cost codes in post-processing)
  const revenue = getFieldNum('job_totals_revenue');
  const expenses = getFieldNum('job_totals_expenses');
  if (revenue == null || expenses == null) {
    checks.push({ name: 'job_totals_populated', status: 'skip', hint: 'job_totals_revenue/expenses not extracted — will be computed from cost code sums in post-processing.' });
  } else {
    checks.push({ name: 'job_totals_populated', status: 'pass', actual: revenue });

    // Check 5: Revenue should be positive (abs of Sage negative)
    if (revenue < 0) {
      checks.push({ name: 'revenue_sign', status: 'fail', expected: Math.abs(revenue), actual: revenue, hint: 'Revenue should be positive. Sage shows revenue as negative (credit). Apply abs().' });
    } else {
      checks.push({ name: 'revenue_sign', status: 'pass' });
    }

    // Check 6: Expenses should roughly equal sum of cost code JTD costs (excl. 999)
    if (records.length > 0) {
      let sumJtd = 0;
      for (const rec of records) {
        const code = toNum(rec.cost_code);
        const jtd = toNum(rec.jtd_cost);
        if (jtd != null && code !== 999) sumJtd += jtd;
      }
      const diff = Math.abs(expenses - sumJtd);
      const pct = expenses > 0 ? (diff / expenses) * 100 : 0;
      if (pct > 5) {
        checks.push({ name: 'expenses_vs_cost_code_sum', status: 'fail', expected: expenses, actual: sumJtd, hint: `Job Totals Expenses (${expenses}) differs from sum of cost code JTD costs excl. 999 (${sumJtd.toFixed(2)}) by ${pct.toFixed(1)}%. Check for missing cost codes or incorrect JTD values.` });
      } else {
        checks.push({ name: 'expenses_vs_cost_code_sum', status: 'pass' });
      }
    }
  }

  // Check 7: Burden codes should be present
  if (records.length > 0) {
    const has995 = records.some(r => toNum(r.cost_code) === 995);
    const has998 = records.some(r => toNum(r.cost_code) === 998);
    if (!has995 || !has998) {
      checks.push({ name: 'burden_codes_present', status: 'fail', hint: `Missing burden codes: ${!has995 ? '995 (Payroll Burden)' : ''} ${!has998 ? '998 (Payroll Taxes)' : ''}. These are special cost codes near the end of the cost code listing, before code 999.` });
    } else {
      checks.push({ name: 'burden_codes_present', status: 'pass' });
    }
  }

  // Check 8: Labor codes should have hours
  if (records.length > 0) {
    const laborNoHours = records.filter(r => {
      const code = toNum(r.cost_code);
      if (code == null) return false;
      const isLabor = (code >= 100 && code < 200) || code === 11;
      if (!isLabor) return false;
      const regH = toNum(r.regular_hours);
      const otH = toNum(r.overtime_hours);
      return (regH == null || regH === 0) && (otH == null || otH === 0);
    });
    if (laborNoHours.length > 3) {
      checks.push({ name: 'labor_codes_have_hours', status: 'fail', actual: laborNoHours.length, hint: `${laborNoHours.length} labor codes (011, 1xx) have no hours. Hours appear in the last two columns of Cost Code Totals rows: "Regular Hours | Overtime Hours".` });
    } else {
      checks.push({ name: 'labor_codes_have_hours', status: 'pass' });
    }
  }

  // Check 9: PR transaction hours vs cost code hours (aggregate cross-check)
  if (records.length > 0 && prTable.length > 0) {
    const isLabor = (code: number) => (code >= 100 && code < 200) || code === 11;
    let ccRegHours = 0;
    for (const rec of records) {
      const code = toNum(rec.cost_code);
      if (code != null && isLabor(code)) {
        ccRegHours += toNum(rec.regular_hours) || 0;
      }
    }
    let txnRegHours = 0;
    for (const txn of prTable) {
      txnRegHours += toNum(txn.regular_hours) || 0;
    }
    if (ccRegHours > 0) {
      const coveragePct = Math.round((txnRegHours / ccRegHours) * 100);
      if (coveragePct < 80) {
        checks.push({ name: 'pr_hours_vs_cost_code_hours', status: 'fail', expected: ccRegHours, actual: txnRegHours,
          hint: `Only ${txnRegHours.toFixed(1)} of ${ccRegHours.toFixed(1)} total regular hours are accounted for in PR transactions (${coveragePct}%). You're missing transaction lines. Make sure you parse PR lines from ALL cost code sections across all pages, not just the first few.` });
      } else {
        checks.push({ name: 'pr_hours_vs_cost_code_hours', status: 'pass', actual: coveragePct });
      }
    }
  }

  // Check 10: Per-cost-code hours consistency
  if (records.length > 0 && prTable.length > 0) {
    const isLabor = (code: number) => (code >= 100 && code < 200) || code === 11;
    const txnHoursByCode = new Map<number, number>();
    for (const txn of prTable) {
      const code = toNum(txn.cost_code);
      if (code != null) {
        txnHoursByCode.set(code, (txnHoursByCode.get(code) || 0) + (toNum(txn.regular_hours) || 0));
      }
    }
    const badCodes: string[] = [];
    for (const rec of records) {
      const code = toNum(rec.cost_code);
      if (code == null || !isLabor(code)) continue;
      const ccHours = toNum(rec.regular_hours) || 0;
      if (ccHours < 10) continue;
      const txnHours = txnHoursByCode.get(code) || 0;
      const ratio = txnHours / ccHours;
      if (ratio < 0.5) {
        const rawDesc = rec.description as Record<string, unknown> | string | undefined;
        const desc = typeof rawDesc === 'string' ? rawDesc : (rawDesc?.value ?? rawDesc ?? '');
        badCodes.push(`${code} (${desc}): totals=${ccHours.toFixed(1)}h, transactions=${txnHours.toFixed(1)}h`);
      }
    }
    if (badCodes.length > 0) {
      const listed = badCodes.slice(0, 5).join('; ');
      checks.push({ name: 'cost_code_hours_consistency', status: 'fail', actual: badCodes.length,
        hint: `${badCodes.length} labor cost code(s) have significantly fewer PR transaction hours than their totals row: ${listed}. Check parsing for those specific cost code sections — you may be skipping lines or misidentifying the cost code.` });
    } else {
      checks.push({ name: 'cost_code_hours_consistency', status: 'pass' });
    }
  }

  // Check 11: PR transactions with hours should have amounts
  if (prTable.length > 0) {
    let withHours = 0;
    let withHoursAndAmounts = 0;
    for (const txn of prTable) {
      const hrs = (toNum(txn.regular_hours) || 0) + (toNum(txn.overtime_hours) || 0);
      if (hrs > 0) {
        withHours++;
        const amt = toNum(txn.actual_amount) || toNum(txn.regular_amount) || toNum(txn.overtime_amount) || toNum(txn.amount);
        if (amt != null && amt !== 0) withHoursAndAmounts++;
      }
    }
    if (withHours > 0) {
      const missingPct = Math.round(((withHours - withHoursAndAmounts) / withHours) * 100);
      if (missingPct > 20) {
        checks.push({ name: 'pr_amounts_match_hours', status: 'fail', expected: withHours, actual: withHoursAndAmounts,
          hint: `${withHours - withHoursAndAmounts} of ${withHours} PR transactions have hours but zero dollar amounts (${missingPct}% missing). The amount is the LAST number on each hours line: "09/13/13 Regular: 8.00 hours    192.50" → actual_amount=192.50. Do NOT default to 0.` });
      } else {
        checks.push({ name: 'pr_amounts_match_hours', status: 'pass', actual: withHoursAndAmounts });
      }
    }
  }

  // Check 12: PR transactions should have worker names
  if (prTable.length > 5) {
    let withName = 0;
    for (const txn of prTable) {
      const raw = txn.name ?? txn.worker_name ?? txn.employee_name ?? txn.employee;
      const v = raw != null && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>) ? (raw as Record<string, unknown>).value : raw;
      if (v != null && String(v).trim() !== '') withName++;
    }
    const missingPct = Math.round(((prTable.length - withName) / prTable.length) * 100);
    if (missingPct > 50) {
      checks.push({ name: 'pr_transactions_have_names', status: 'fail', expected: prTable.length, actual: withName,
        hint: `${prTable.length - withName} of ${prTable.length} PR transactions (${missingPct}%) have no worker name. The name appears on the PR header line: "PR  166  09/11/13  4235  John Smith". Parse the LAST element(s) on the PR header line as the worker name. Example regex: r'PR\\s+\\d+\\s+\\d{2}/\\d{2}/\\d{2}\\s+\\d+\\s+(.+)'` });
    } else {
      checks.push({ name: 'pr_transactions_have_names', status: 'pass', actual: withName });
    }
  }

  const failures = checks.filter(c => c.status === 'fail');
  return { passed: failures.length === 0, checks };
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v !== null && 'value' in v) {
    return toNum((v as Record<string, unknown>).value);
  }
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}

function buildValidationRetryMessage(code: string, checks: JcrValidationCheck[]): string {
  const failures = checks.filter(c => c.status === 'fail');
  let msg = `The script ran successfully but the extracted data has ${failures.length} quality issue(s):\n\n`;

  for (const check of failures) {
    msg += `## ISSUE: ${check.name}\n`;
    if (check.expected != null) msg += `  Expected: ${check.expected}\n`;
    if (check.actual != null) msg += `  Got: ${check.actual}\n`;
    if (check.hint) msg += `  Fix: ${check.hint}\n`;
    msg += '\n';
  }

  msg += 'Please fix ONLY the specific issues listed above in the script you just wrote. Output ONLY the corrected Python code — no explanation.';

  return msg;
}

// ── Main entry point ─────────────────────────────────────────

export async function extractWithCodegen(
  rawBuffer: Buffer,
  sourceText: string,
  skill: DocumentSkill,
  catalogFields: FieldDefinition[],
  contextCardFields: string[],
  classifierConfidence: number,
  fileExt: string,
  options?: { langfuseParent?: LangfuseParent; scopedFields?: Map<string, FieldDefinition[]> },
): Promise<CodegenExtractionResult> {
  const t0 = Date.now();
  const client = new Anthropic();

  const fpResult = await fingerprintDocument(sourceText, skill.skillId, fileExt === 'pdf' ? new Uint8Array(rawBuffer) : undefined);
  const formatFingerprint = fpResult.hash;
  console.log(`[codegen] Format fingerprint: ${formatFingerprint} skill=${skill.skillId}`);

  const inputFile: ExtractionFile = {
    path: `/tmp/input${fileExt ? '.' + fileExt : ''}`,
    content: rawBuffer,
  };

  const inputFiles: ExtractionFile[] = [inputFile];
  if (fileExt === 'pdf' && sourceText.length > 1000) {
    inputFiles.push({
      path: '/tmp/source_text.txt',
      content: Buffer.from(sourceText, 'utf-8'),
    });
  }

  // ── Try cached parser first ──
  const cached = await getActiveParser(skill.skillId, formatFingerprint);
  if (cached) {
    console.log(`[codegen] Trying cached parser: id=${cached.id} validated_count=${cached.validated_count}`);
    const tCache = Date.now();
    try {
      const cacheResult = await ExtractionSandbox.execute(cached.parser_code, inputFiles);
      const cacheExecTime = Date.now() - tCache;
      console.log(`[codegen] Cached parser executed in ${cacheExecTime}ms: exitCode=${cacheResult.exitCode}`);

      if (cacheResult.exitCode === 0) {
        try {
          const raw = parseCodegenOutput(cacheResult.stdout);
          const records = raw.records || [];
          const fieldCount = Object.keys(raw.fields || {}).length;

          if (fieldCount > 0 || records.length > 0) {
            console.log(`[codegen] Cached parser succeeded: ${fieldCount} fields, ${records.length} records`);
            const normalized = normalizeToExtractionResult(raw, skill, classifierConfidence);
            normalized.metadata.retries = 0;
            normalized.metadata.generatedCode = cached.parser_code;
            normalized.metadata.formatFingerprint = formatFingerprint;
            normalized.metadata.usedCachedParserId = cached.id;
            normalized.metadata.parserMethod = 'cached';
            normalized.metadata.sandboxElapsedMs = cacheExecTime;
            return normalized;
          }
          console.warn(`[codegen] Cached parser returned empty output — falling through to generation`);
        } catch {
          console.warn(`[codegen] Cached parser output parse failed — falling through to generation`);
        }
      } else {
        console.warn(`[codegen] Cached parser failed (exit=${cacheResult.exitCode}) — falling through to generation`);
      }
      await recordCacheFailure(cached.id);
    } catch (err) {
      console.warn(`[codegen] Cached parser execution error:`, err);
      await recordCacheFailure(cached.id);
    }
  }

  // ── Generate new parser via Opus ──
  // On cache miss, also identify the format with a cheap LLM call for operator visibility
  let formatLabel: string | undefined;
  if (!cached) {
    try {
      const labelResult = await fingerprintDocument(sourceText, skill.skillId, undefined, { identifyWithLlm: true, sourceText });
      formatLabel = labelResult.label;
    } catch { /* non-fatal */ }
  }

  const metaPrompt = buildMetaPrompt(skill, catalogFields, contextCardFields, fileExt, options?.scopedFields);

  const HEAD_PREVIEW = 20_000;
  const TAIL_PREVIEW = 10_000;
  const docPreview = sourceText.length <= HEAD_PREVIEW + TAIL_PREVIEW
    ? sourceText
    : sourceText.slice(0, HEAD_PREVIEW) +
      '\n\n[... middle pages omitted ...]\n\n' +
      sourceText.slice(-TAIL_PREVIEW);

  let lastError: string | undefined;
  let lastCode: string | undefined;
  let retries = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const tGen = Date.now();
    console.log(`[codegen] Generating parser code: attempt=${attempt + 1}/${MAX_RETRIES + 1} skill=${skill.skillId}`);

    let genResult: CodegenGenerationResult;
    try {
      genResult = await generateParserCode(client, metaPrompt, docPreview, lastError, options?.langfuseParent, lastCode);
    } catch (err) {
      console.error(`[codegen] Code generation failed:`, err);
      throw err;
    }
    const { code, inputTokens: codegenInTokens, outputTokens: codegenOutTokens } = genResult;
    const genTime = Date.now() - tGen;
    console.log(`[codegen] Code generated in ${genTime}ms (${code.length} chars) tokens=${codegenInTokens}in/${codegenOutTokens}out`);

    const tExec = Date.now();
    const sandboxSpan = options?.langfuseParent?.span({
      name: 'sandbox-execute',
      input: { codeLength: code.length, attempt: attempt + 1, codePreview: code.slice(0, 2000) },
    });
    let result;
    try {
      result = await ExtractionSandbox.execute(code, inputFiles);
    } catch (err) {
      sandboxSpan?.end({ output: { error: err instanceof Error ? err.message : String(err) }, level: 'ERROR' as const });
      console.error(`[codegen] Sandbox execution error:`, err);
      if (attempt < MAX_RETRIES) {
        lastError = err instanceof Error ? err.message : String(err);
        lastCode = code;
        retries++;
        continue;
      }
      throw err;
    }
    const execTime = Date.now() - tExec;
    sandboxSpan?.end({
      output: {
        exitCode: result.exitCode,
        stdoutPreview: result.stdout.slice(0, 3000),
        stderrPreview: result.stderr.slice(0, 1000),
      },
      metadata: { elapsedMs: execTime, stdoutLength: result.stdout.length, stderrLength: result.stderr.length },
    });
    console.log(`[codegen] Script executed in ${execTime}ms: exitCode=${result.exitCode}`);

    if (result.exitCode !== 0) {
      console.warn(`[codegen] Script failed (attempt ${attempt + 1}): ${result.stderr.slice(0, 500)}`);
      if (attempt < MAX_RETRIES) {
        lastError = result.stderr;
        lastCode = code;
        retries++;
        continue;
      }
      throw new Error(`[codegen] Script failed after ${MAX_RETRIES + 1} attempts. Last error: ${result.stderr.slice(0, 1000)}`);
    }

    try {
      const raw = parseCodegenOutput(result.stdout);

      // JCR post-extraction validation: check self-consistency before accepting
      if (skill.skillId === 'job_cost_report' && attempt < MAX_RETRIES) {
        const validation = validateJcrExtraction(raw);
        if (!validation.passed) {
          const failCount = validation.checks.filter(c => c.status === 'fail').length;
          console.warn(`[codegen] JCR validation failed (attempt ${attempt + 1}): ${failCount} issue(s)`);
          for (const c of validation.checks.filter(ch => ch.status === 'fail')) {
            console.warn(`  - ${c.name}: ${c.hint?.slice(0, 120)}`);
          }

          options?.langfuseParent?.span({
            name: 'jcr-validation-fail',
            input: { attempt: attempt + 1, checks: validation.checks },
            output: { failCount },
          });

          lastError = buildValidationRetryMessage(code, validation.checks);
          lastCode = code;
          retries++;
          continue;
        }
        console.log(`[codegen] JCR validation passed: ${validation.checks.length} checks`);
      }

      const normalized = normalizeToExtractionResult(raw, skill, classifierConfidence);
      normalized.metadata.retries = retries;
      normalized.metadata.generatedCode = code;
      normalized.metadata.formatFingerprint = formatFingerprint;
      normalized.metadata.formatLabel = formatLabel;
      normalized.metadata.codegenInputTokens = codegenInTokens;
      normalized.metadata.codegenOutputTokens = codegenOutTokens;
      normalized.metadata.sandboxElapsedMs = execTime;

      const totalTime = Date.now() - t0;
      const fieldCount = Object.keys(normalized.extraction.fields).length;
      const recordCount = normalized.extraction.records?.length ?? 0;
      const discoveredCount = Object.keys(normalized.discoveredFields).length;
      const targetTableCount = normalized.extraction.targetTables?.reduce((sum, t) => sum + t.records.length, 0) ?? 0;

      options?.langfuseParent?.span({
        name: 'codegen-result',
        input: { fieldCount, recordCount, discoveredCount, targetTableCount, overallConfidence: classifierConfidence },
        output: {
          fields: normalized.extraction.fields,
          recordSample: normalized.extraction.records?.slice(0, 3),
          targetTableSummary: normalized.extraction.targetTables?.map(t => ({ table: t.table, count: t.records.length })),
          discoveredFields: normalized.discoveredFields,
        },
        metadata: {
          totalElapsedMs: totalTime,
          retries,
          parserMethod: normalized.metadata.parserMethod,
          warnings: normalized.metadata.warnings,
        },
      });

      console.log(
        `[codegen] SUCCESS skill=${skill.skillId} fields=${fieldCount} records=${recordCount} ` +
        `targetTableRows=${targetTableCount} discovered=${discoveredCount} ` +
        `retries=${retries} total=${totalTime}ms`
      );

      return normalized;
    } catch (err) {
      console.warn(`[codegen] Output parsing failed (attempt ${attempt + 1}): ${err instanceof Error ? err.message : err}`);
      if (attempt < MAX_RETRIES) {
        lastError = `Output parsing error: ${err instanceof Error ? err.message : err}\n\nScript stdout:\n${result.stdout.slice(0, 2000)}`;
        lastCode = code;
        retries++;
        continue;
      }
      throw err;
    }
  }

  throw new Error('[codegen] Exhausted all retry attempts');
}

// ── Targeted field re-extraction ──────────────────────────────
// Lightweight function that asks Claude to re-read specific fields
// from a document section when consistency checks fail.

export interface TargetedExtractionRequest {
  failingChecks: Array<{
    check_name: string;
    message: string;
    affected_fields: string[];
    hint_template: string | null;
    expected: number | string | null;
    actual: number | string | null;
  }>;
  tailText: string;
  currentValues: Record<string, number | string | null>;
}

export interface TargetedExtractionResult {
  correctedFields: Record<string, number | null>;
  reasoning: string;
  fieldsChanged: string[];
}

export async function targetedFieldExtraction(
  request: TargetedExtractionRequest,
): Promise<TargetedExtractionResult> {
  const client = new Anthropic();

  const affectedFields = new Set<string>();
  for (const check of request.failingChecks) {
    for (const f of check.affected_fields) {
      affectedFields.add(f);
    }
  }

  const checkDescriptions = request.failingChecks.map(c => {
    let desc = `- ${c.check_name}: ${c.message}`;
    if (c.hint_template && c.expected != null) {
      desc += `\n  Hint: ${c.hint_template.replace('{{expected}}', String(c.expected))}`;
    }
    return desc;
  }).join('\n');

  const currentValueLines = [...affectedFields].map(f => {
    const val = request.currentValues[f];
    return `- ${f}: ${val != null ? val : 'null (not extracted)'}`;
  }).join('\n');

  const prompt = `You are re-reading a construction Job Cost Report to correct extraction errors.

The following consistency checks FAILED on the extracted data:
${checkDescriptions}

Current extracted values for the affected fields:
${currentValueLines}

Below is the relevant section of the document (typically the last few pages containing Job Totals, summary sections, and source breakdowns):

<document_section>
${request.tailText.slice(0, 30_000)}
</document_section>

TASK: Re-read the document section above and provide corrected numeric values for ONLY the fields that need fixing. If a value is correct, do not include it. If a value cannot be determined from the text, set it to null.

Respond with ONLY valid JSON in this exact format:
{
  "corrected_fields": { "field_name": numeric_value_or_null, ... },
  "reasoning": "brief explanation of what was wrong and how you fixed it"
}`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[targeted-reextract] No JSON found in response');
      return { correctedFields: {}, reasoning: 'No valid JSON in response', fieldsChanged: [] };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      corrected_fields: Record<string, number | null>;
      reasoning: string;
    };

    const fieldsChanged = Object.keys(parsed.corrected_fields).filter(f => {
      const oldVal = request.currentValues[f];
      const newVal = parsed.corrected_fields[f];
      return oldVal !== newVal;
    });

    console.log(
      `[targeted-reextract] Corrected ${fieldsChanged.length} fields: ` +
      fieldsChanged.map(f => `${f}: ${request.currentValues[f]} → ${parsed.corrected_fields[f]}`).join(', ')
    );

    return {
      correctedFields: parsed.corrected_fields,
      reasoning: parsed.reasoning || '',
      fieldsChanged,
    };
  } catch (err) {
    console.error('[targeted-reextract] Failed:', err);
    return { correctedFields: {}, reasoning: `Error: ${err instanceof Error ? err.message : String(err)}`, fieldsChanged: [] };
  }
}
