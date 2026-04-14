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
  ],
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
- "records" is for multi-row data (line items, cost codes, pay apps, workers, etc.). Omit if the document has no tabular data.
- "discovered_fields" is for ANY other valuable structured data you find that isn't in the required fields. Examples: breakdowns, subtotals, cross-references, summary tables, metadata. Be generous — extract everything useful.
- confidence: 1.0 = copied verbatim from document, 0.9 = calculated/derived from document data, 0.7-0.8 = inferred with high certainty, <0.7 = uncertain
- source: brief description of where in the document the value was found (page number, section, table header, etc.)
- Print ONLY the JSON to stdout. No other output. Use json.dumps() with indent=2.

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

function getFileTypeHint(fileExt: string): string {
  switch (fileExt.toLowerCase()) {
    case 'pdf':
      return `This is a PDF file. Use pdfplumber to extract text and tables:
\`\`\`python
import pdfplumber
with pdfplumber.open("/tmp/input.pdf") as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        tables = page.extract_tables()
\`\`\``;
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
): Promise<CodegenGenerationResult> {
  const messages: Anthropic.MessageParam[] = [];

  if (previousError) {
    messages.push({
      role: 'user',
      content: `${metaPrompt}\n\nHere is a preview of the document content (first 10000 chars):\n\`\`\`\n${documentPreview}\n\`\`\``,
    });
    messages.push({
      role: 'assistant',
      content: 'I\'ll write a Python script to extract the data.',
    });
    messages.push({
      role: 'user',
      content: `The previous script failed with this error:\n\`\`\`\n${previousError}\n\`\`\`\n\nPlease fix the script. Output ONLY the corrected Python code.`,
    });
  } else {
    messages.push({
      role: 'user',
      content: `${metaPrompt}\n\nHere is a preview of the document content (first 10000 chars):\n\`\`\`\n${documentPreview}\n\`\`\`\n\nWrite the complete Python extraction script now. Output ONLY Python code, no explanation.`,
    });
  }

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 16384,
    messages,
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('[codegen] No text block in Claude response');
  }

  return {
    code: extractPythonCode(textBlock.text),
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
}

function extractPythonCode(text: string): string {
  const fenced = text.match(/```(?:python)?\s*\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

// ── Output parsing ───────────────────────────────────────────

interface RawCodegenOutput {
  fields: Record<string, { value: unknown; confidence: number; source?: string }>;
  records?: Array<Record<string, unknown>>;
  discovered_fields?: Record<string, unknown>;
  metadata?: {
    pages_parsed?: number;
    parser_method?: string;
    warnings?: string[];
  };
}

function parseCodegenOutput(stdout: string): RawCodegenOutput {
  const jsonMatch = stdout.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`[codegen] No JSON object found in script output. stdout: ${stdout.slice(0, 500)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`[codegen] Failed to parse JSON from script output: ${e instanceof Error ? e.message : e}`);
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

// ── Main entry point ─────────────────────────────────────────

export async function extractWithCodegen(
  rawBuffer: Buffer,
  sourceText: string,
  skill: DocumentSkill,
  catalogFields: FieldDefinition[],
  contextCardFields: string[],
  classifierConfidence: number,
  fileExt: string,
): Promise<CodegenExtractionResult> {
  const t0 = Date.now();
  const client = new Anthropic();

  const metaPrompt = buildMetaPrompt(skill, catalogFields, contextCardFields, fileExt);
  const docPreview = sourceText.slice(0, 10_000);

  const inputFile: ExtractionFile = {
    path: `/tmp/input${fileExt ? '.' + fileExt : ''}`,
    content: rawBuffer,
  };

  let lastError: string | undefined;
  let retries = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const tGen = Date.now();
    console.log(`[codegen] Generating parser code: attempt=${attempt + 1}/${MAX_RETRIES + 1} skill=${skill.skillId}`);

    let genResult: CodegenGenerationResult;
    try {
      genResult = await generateParserCode(client, metaPrompt, docPreview, lastError);
    } catch (err) {
      console.error(`[codegen] Code generation failed:`, err);
      throw err;
    }
    const { code, inputTokens: codegenInTokens, outputTokens: codegenOutTokens } = genResult;
    const genTime = Date.now() - tGen;
    console.log(`[codegen] Code generated in ${genTime}ms (${code.length} chars) tokens=${codegenInTokens}in/${codegenOutTokens}out`);

    const tExec = Date.now();
    let result;
    try {
      result = await ExtractionSandbox.execute(code, [inputFile]);
    } catch (err) {
      console.error(`[codegen] Sandbox execution error:`, err);
      if (attempt < MAX_RETRIES) {
        lastError = err instanceof Error ? err.message : String(err);
        retries++;
        continue;
      }
      throw err;
    }
    const execTime = Date.now() - tExec;
    console.log(`[codegen] Script executed in ${execTime}ms: exitCode=${result.exitCode}`);

    if (result.exitCode !== 0) {
      console.warn(`[codegen] Script failed (attempt ${attempt + 1}): ${result.stderr.slice(0, 500)}`);
      if (attempt < MAX_RETRIES) {
        lastError = result.stderr;
        retries++;
        continue;
      }
      throw new Error(`[codegen] Script failed after ${MAX_RETRIES + 1} attempts. Last error: ${result.stderr.slice(0, 1000)}`);
    }

    try {
      const raw = parseCodegenOutput(result.stdout);
      const normalized = normalizeToExtractionResult(raw, skill, classifierConfidence);
      normalized.metadata.retries = retries;
      normalized.metadata.generatedCode = code;
      normalized.metadata.codegenInputTokens = codegenInTokens;
      normalized.metadata.codegenOutputTokens = codegenOutTokens;
      normalized.metadata.sandboxElapsedMs = execTime;

      const totalTime = Date.now() - t0;
      const fieldCount = Object.keys(normalized.extraction.fields).length;
      const discoveredCount = Object.keys(normalized.discoveredFields).length;
      console.log(
        `[codegen] SUCCESS skill=${skill.skillId} fields=${fieldCount} discovered=${discoveredCount} ` +
        `retries=${retries} total=${totalTime}ms`
      );

      return normalized;
    } catch (err) {
      console.warn(`[codegen] Output parsing failed (attempt ${attempt + 1}): ${err instanceof Error ? err.message : err}`);
      if (attempt < MAX_RETRIES) {
        lastError = `Output parsing error: ${err instanceof Error ? err.message : err}\n\nScript stdout:\n${result.stdout.slice(0, 2000)}`;
        retries++;
        continue;
      }
      throw err;
    }
  }

  throw new Error('[codegen] Exhausted all retry attempts');
}
