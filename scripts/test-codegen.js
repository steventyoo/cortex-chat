/**
 * Test harness: compare LLM extraction vs Code-gen extraction on a local file.
 *
 * Usage:
 *   node scripts/test-codegen.js <file-path> [--skill <skillId>] [--org <orgId>]
 *
 * Examples:
 *   node scripts/test-codegen.js ~/Documents/2012-JDR.pdf --skill plumbing_permit
 *   node scripts/test-codegen.js ~/Documents/change-order.pdf
 *
 * The script will:
 *   1. Parse the file into text (PDF via unpdf, Excel via xlsx, else utf-8)
 *   2. Classify the document to find the matching skill (or use --skill)
 *   3. Fetch skill field definitions from the DB
 *   4. Run BOTH extraction paths and print results side-by-side
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk').default;
const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');

// ── Config ──────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-opus-4-6';
const CLASSIFY_MODEL = 'claude-haiku-4-5-20251001';

// ── CLI args ────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help') {
    console.log('Usage: node scripts/test-codegen.js <file-path> [--skill <skillId>] [--org <orgId>]');
    process.exit(0);
  }

  const filePath = path.resolve(args[0]);
  let skillId = null;
  let orgId = null;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--skill' && args[i + 1]) { skillId = args[++i]; }
    if (args[i] === '--org' && args[i + 1]) { orgId = args[++i]; }
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  return { filePath, skillId, orgId };
}

// ── File parsing (standalone, no Next.js deps) ──────────────────

function extractWithPython(filePath, ext) {
  const { execSync } = require('child_process');
  const escapedPath = filePath.replace(/'/g, "'\\''");
  const scripts = {
    docx: `
from docx import Document
doc = Document('${escapedPath}')
lines = []
for para in doc.paragraphs:
    lines.append(para.text)
for table in doc.tables:
    for row in table.rows:
        cells = [cell.text for cell in row.cells]
        lines.append("\\t".join(cells))
print("\\n".join(lines))
`,
    doc: `
import sys
try:
    import docx2txt
    text = docx2txt.process('${escapedPath}')
    if text and text.strip():
        print(text)
        sys.exit(0)
except Exception:
    pass

try:
    import olefile
    ole = olefile.OleFileIO('${escapedPath}')
    if ole.exists('WordDocument'):
        import re
        stream = ole.openstream('WordDocument').read()
        text = stream.decode('utf-8', errors='replace')
        text = re.sub(r'[\\x00-\\x08\\x0b-\\x0c\\x0e-\\x1f]', '', text)
        print(text)
        sys.exit(0)
except Exception:
    pass

with open('${escapedPath}', 'rb') as f:
    raw = f.read()
text = raw.decode('utf-8', errors='replace')
import re
text = re.sub(r'[\\x00-\\x08\\x0b-\\x0c\\x0e-\\x1f]', '', text)
print(text)
`,
    pptx: `
from pptx import Presentation
prs = Presentation('${escapedPath}')
lines = []
for i, slide in enumerate(prs.slides):
    lines.append(f"=== Slide {i+1} ===")
    for shape in slide.shapes:
        if shape.has_text_frame:
            for para in shape.text_frame.paragraphs:
                lines.append(para.text)
        if shape.has_table:
            for row in shape.table.rows:
                cells = [cell.text for cell in row.cells]
                lines.append("\\t".join(cells))
print("\\n".join(lines))
`,
  };

  const script = scripts[ext];
  if (!script) return null;

  const tmpScript = '/tmp/cortex_parse_helper.py';
  fs.writeFileSync(tmpScript, script);

  try {
    return execSync(`python3 ${tmpScript}`, {
      timeout: 15_000,
      maxBuffer: 500_000,
      encoding: 'utf-8',
    });
  } catch (err) {
    console.warn(`   Python ${ext} extraction failed: ${(err.message || '').slice(0, 200)}`);
    return null;
  }
}

async function parseFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase().replace('.', '');

  if (['xlsx', 'xls'].includes(ext)) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const lines = [];
    for (const name of wb.SheetNames) {
      lines.push(`=== Sheet: ${name} ===`);
      const sheet = wb.Sheets[name];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      lines.push(csv);
    }
    return { text: lines.join('\n'), buffer, ext };
  }

  if (ext === 'pdf') {
    const { extractText } = require('unpdf');
    const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
    const trimmed = text.trim();
    if (trimmed.length > 100) {
      return { text: trimmed, buffer, ext };
    }
    console.log(`unpdf got only ${trimmed.length} chars — using Claude OCR fallback`);
    const ocrText = await claudeOcr(buffer, ext);
    return { text: ocrText, buffer, ext };
  }

  if (['docx', 'doc', 'pptx'].includes(ext)) {
    const text = extractWithPython(filePath, ext);
    if (text && text.trim().length > 20) {
      return { text: text.trim(), buffer, ext };
    }
    console.log(`Python extraction got only ${(text || '').trim().length} chars for .${ext} — using Claude OCR`);
    const ocrText = await claudeOcr(buffer, ext);
    return { text: ocrText, buffer, ext };
  }

  if (['csv', 'txt', 'json', 'xml', 'html', 'md'].includes(ext)) {
    return { text: buffer.toString('utf-8'), buffer, ext };
  }

  console.log(`Unknown ext "${ext}" — attempting Claude OCR`);
  const ocrText = await claudeOcr(buffer, ext);
  return { text: ocrText, buffer, ext };
}

async function claudeOcr(buffer, ext) {
  const base64 = buffer.toString('base64');
  const mediaType = ext === 'pdf' ? 'application/pdf' : `image/${ext}`;
  const sourceType = ext === 'pdf' ? 'document' : 'image';
  const response = await client.messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [{
        type: sourceType,
        source: { type: 'base64', media_type: mediaType, data: base64 },
      }, {
        type: 'text',
        text: 'Extract all text from this document. Preserve structure, tables, and formatting.',
      }],
    }],
  });
  return response.content.find(b => b.type === 'text')?.text || '';
}

// ── Fetch skills from DB ────────────────────────────────────────

async function fetchActiveSkills() {
  const { data, error } = await supabase
    .from('document_skills')
    .select('*')
    .eq('status', 'active');
  if (error) throw error;
  return data || [];
}

async function fetchSkillFieldDefs(skillId) {
  const { data, error } = await supabase
    .from('skill_fields')
    .select(`
      display_override, tier, required, importance, description, options,
      extraction_hint, disambiguation_rules, sort_order,
      field_catalog (canonical_name, display_name, field_type, description, enum_options)
    `)
    .eq('skill_id', skillId)
    .order('sort_order');

  if (error || !data) return [];

  return data.map(row => {
    const cat = Array.isArray(row.field_catalog) ? row.field_catalog[0] : row.field_catalog;
    if (!cat) return null;
    return {
      name: row.display_override || cat.display_name,
      type: cat.field_type || 'string',
      tier: row.tier ?? 1,
      required: row.required ?? false,
      description: row.description || cat.description || '',
      options: (Array.isArray(row.options) && row.options.length ? row.options : Array.isArray(cat.enum_options) && cat.enum_options.length ? cat.enum_options : undefined),
      disambiguationRules: row.extraction_hint || row.disambiguation_rules || undefined,
    };
  }).filter(Boolean);
}

async function fetchContextCardFields(skillId, orgId) {
  if (!orgId) return [];
  const { data, error } = await supabase
    .from('context_cards')
    .select('key_fields')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .contains('skills_involved', [skillId]);
  if (error) return [];
  const fields = new Set();
  for (const row of data || []) {
    if (row.key_fields && typeof row.key_fields === 'object') {
      Object.keys(row.key_fields).forEach(k => fields.add(k));
    }
  }
  return Array.from(fields);
}

// ── Classification ──────────────────────────────────────────────

async function classifyDoc(text, skills) {
  const skillList = skills.map(s => {
    const hints = s.classifier_hints || {};
    return `- ${s.skill_id}: ${s.display_name}${hints.description ? ` (${hints.description})` : ''}`;
  }).join('\n');

  const response = await client.messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: `Classify this document into one of these types:\n${skillList}\n\nDocument (first 3000 chars):\n${text.slice(0, 3000)}\n\nRespond with JSON: {"skill_id": "...", "confidence": 0.0-1.0, "reasoning": "..."}`,
    }],
  });

  const raw = response.content.find(b => b.type === 'text')?.text || '{}';
  const match = raw.match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : { skill_id: null, confidence: 0 };
}

// ── LLM extraction (mirrors extractWithSkill) ───────────────────

async function extractLLM(text, skill, fieldDefs) {
  const fieldLines = fieldDefs.map(f => {
    let line = `"${f.name}": ${f.type}${f.required ? ' (REQUIRED)' : ''} — ${f.description}`;
    if (f.options?.length) line += ` [${f.options.join(', ')}]`;
    return line;
  }).join('\n');

  const toolProperties = {};
  for (const f of fieldDefs) {
    toolProperties[f.name] = {
      type: 'object',
      properties: {
        value: { type: ['string', 'number', 'null'] },
        confidence: { type: 'number' },
      },
      required: ['value', 'confidence'],
    };
  }

  const tool = {
    name: 'extract_document',
    description: 'Extract structured data from the document',
    input_schema: {
      type: 'object',
      properties: {
        documentType: { type: 'string' },
        documentTypeConfidence: { type: 'number' },
        fields: {
          type: 'object',
          properties: toolProperties,
        },
        extra_fields: {
          type: 'object',
          description: 'Any additional fields found beyond the schema',
        },
      },
      required: ['documentType', 'documentTypeConfidence', 'fields'],
    },
  };

  const t0 = Date.now();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: skill.system_prompt || '',
    messages: [{
      role: 'user',
      content: `Extract all fields from this document.\n\nFields:\n${fieldLines}\n\nDocument:\n${text.slice(0, 200000)}`,
    }],
    tools: [tool],
    tool_choice: { type: 'tool', name: 'extract_document' },
  });

  const toolBlock = response.content.find(b => b.type === 'tool_use');
  const elapsed = Date.now() - t0;

  if (!toolBlock) throw new Error('No tool_use block in LLM response');

  const result = toolBlock.input;
  if (result.extra_fields) {
    result.fields = { ...result.fields, ...result.extra_fields };
    delete result.extra_fields;
  }

  return {
    fields: result.fields || {},
    elapsed,
    tokens: { input: response.usage?.input_tokens, output: response.usage?.output_tokens },
  };
}

// ── Codegen extraction ──────────────────────────────────────────

function buildCodegenPrompt(skill, fieldDefs, contextCardFields, fileExt) {
  const fieldLines = fieldDefs.map(f => {
    let line = `- "${f.name}" (${f.type}${f.required ? ', REQUIRED' : ''}): ${f.description}`;
    if (f.options?.length) line += ` | Valid values: ${f.options.join(', ')}`;
    if (f.disambiguationRules) line += ` | Note: ${f.disambiguationRules}`;
    return line;
  }).join('\n');

  const ctxOnly = (contextCardFields || []).filter(
    cf => !fieldDefs.some(f => f.name === cf)
  );
  const ctxSection = ctxOnly.length > 0
    ? `\n## Context Card Fields (also required)\n${ctxOnly.map(f => `- "${f}"`).join('\n')}\n`
    : '';

  const fileHints = {
    pdf: 'Use pdfplumber to extract text and tables:\nimport pdfplumber\nwith pdfplumber.open("/tmp/input.pdf") as pdf: ...',
    xlsx: 'Use openpyxl (with data_only=True for computed values):\nimport openpyxl\nwb = openpyxl.load_workbook("/tmp/input.xlsx", data_only=True)',
    xls: 'Use xlrd:\nimport xlrd\nwb = xlrd.open_workbook("/tmp/input.xls")',
    csv: 'Use pandas:\nimport pandas as pd\ndf = pd.read_csv("/tmp/input.csv")',
    docx: 'Use python-docx for paragraphs AND tables:\nfrom docx import Document\ndoc = Document("/tmp/input.docx")\nfor para in doc.paragraphs: text = para.text\nfor table in doc.tables: rows = [[cell.text for cell in row.cells] for row in table.rows]',
    doc: 'Use docx2txt:\nimport docx2txt\ntext = docx2txt.process("/tmp/input.doc")',
    pptx: 'Use python-pptx:\nfrom pptx import Presentation\nprs = Presentation("/tmp/input.pptx")\nfor slide in prs.slides:\n  for shape in slide.shapes:\n    if shape.has_text_frame: text = shape.text_frame.text\n    if shape.has_table: ...',
    txt: 'Read as text:\nwith open("/tmp/input.txt", "r") as f: content = f.read()',
    html: 'Read as text and strip tags:\nimport re\nwith open("/tmp/input.html", "r") as f: content = f.read()\ntext = re.sub(r"<[^>]+>", " ", content)',
  };
  const fileHint = fileHints[fileExt] || `Read as text:\nwith open("/tmp/input.${fileExt}", "r") as f: content = f.read()`;

  return `You are a data extraction engineer. Write a Python script that extracts structured data from a document.

## Document Type
"${skill.display_name}" (skill: ${skill.skill_id})
${skill.system_prompt ? `\nContext: ${skill.system_prompt}` : ''}

## Required Fields
${fieldLines}
${ctxSection}
## Output Format
Print a single JSON object to stdout:
{
  "fields": {"Field Name": {"value": <val>, "confidence": 0.0-1.0, "source": "..."}},
  "records": [{"col": <val>}],
  "discovered_fields": {"key": <extra data>},
  "metadata": {"pages_parsed": <int>, "parser_method": "...", "warnings": []}
}

Rules:
- "fields" MUST contain ALL required fields. Use null + low confidence if not found.
- "records" for tabular/multi-row data. Omit if none.
- "discovered_fields" for ANY other structured data beyond required fields. Be generous.
- confidence: 1.0=verbatim, 0.9=calculated, 0.7-0.8=inferred, <0.7=uncertain
- Print ONLY JSON. Use json.dumps(result, indent=2).

## File Handling
${fileHint}
Document is at /tmp/input${fileExt ? '.' + fileExt : ''}

## Parsing Strategy
1. Read and inspect document structure
2. Use regex/string parsing for text; openpyxl for Excel; pdfplumber for PDFs
3. Extract EXACT numbers — do NOT estimate or round
4. Cross-reference values when possible
5. For totals, verify by summing components

Write the complete Python script. Use only stdlib + pandas, numpy, openpyxl, pdfplumber, xlrd, python-docx, docx2txt, olefile, python-pptx.`;
}

async function extractCodegen(buffer, text, skill, fieldDefs, contextCardFields, fileExt) {
  const metaPrompt = buildCodegenPrompt(skill, fieldDefs, contextCardFields, fileExt);
  const docPreview = text.slice(0, 10_000);

  const MAX_RETRIES = 2;
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Generate Python code
    const messages = [];
    if (lastError) {
      messages.push({ role: 'user', content: `${metaPrompt}\n\nDocument preview (first 10000 chars):\n\`\`\`\n${docPreview}\n\`\`\`` });
      messages.push({ role: 'assistant', content: "I'll write a Python script to extract the data." });
      messages.push({ role: 'user', content: `Previous script failed:\n\`\`\`\n${lastError}\n\`\`\`\n\nFix it. Output ONLY corrected Python code.` });
    } else {
      messages.push({ role: 'user', content: `${metaPrompt}\n\nDocument preview (first 10000 chars):\n\`\`\`\n${docPreview}\n\`\`\`\n\nWrite the script now. Output ONLY Python code.` });
    }

    const tGen = Date.now();
    console.log(`  [codegen] Generating parser: attempt ${attempt + 1}/${MAX_RETRIES + 1}`);

    const codeResp = await client.messages.create({ model: MODEL, max_tokens: 16384, messages });
    const codeText = codeResp.content.find(b => b.type === 'text')?.text || '';
    const fenced = codeText.match(/```(?:python)?\s*\n([\s\S]*?)```/);
    const code = fenced ? fenced[1].trim() : codeText.trim();

    const genTime = Date.now() - tGen;
    console.log(`  [codegen] Code generated in ${genTime}ms (${code.length} chars)`);
    console.log(`  [codegen] Tokens: in=${codeResp.usage?.input_tokens} out=${codeResp.usage?.output_tokens}`);

    // Write the file and code to /tmp, run with python3
    const inputPath = `/tmp/codegen_test_input.${fileExt}`;
    const scriptPath = '/tmp/codegen_test_script.py';
    fs.writeFileSync(inputPath, buffer);

    const adjustedCode = code.replace(
      new RegExp(`/tmp/input\\.${fileExt}`, 'g'),
      inputPath,
    ).replace(
      /\/tmp\/input(?!\w)/g,
      inputPath,
    );
    fs.writeFileSync(scriptPath, adjustedCode);

    const tExec = Date.now();
    console.log(`  [codegen] Executing script...`);

    try {
      const { execSync } = require('child_process');
      const stdout = execSync(`python3 ${scriptPath}`, {
        timeout: 60_000,
        maxBuffer: 500_000,
        encoding: 'utf-8',
      });
      const execTime = Date.now() - tExec;
      console.log(`  [codegen] Script finished in ${execTime}ms`);

      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error(`No JSON in stdout: ${stdout.slice(0, 500)}`);

      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.fields) throw new Error('Output missing "fields" key');

      return {
        fields: parsed.fields,
        records: parsed.records || [],
        discoveredFields: parsed.discovered_fields || {},
        metadata: parsed.metadata || {},
        elapsed: Date.now() - tGen,
        generatedCode: code,
      };
    } catch (err) {
      const msg = err.stderr || err.message || String(err);
      console.warn(`  [codegen] Attempt ${attempt + 1} failed: ${msg.slice(0, 300)}`);
      lastError = msg.slice(0, 2000);
    }
  }

  throw new Error(`Codegen extraction failed after ${MAX_RETRIES + 1} attempts`);
}

// ── Comparison & output ─────────────────────────────────────────

function printFields(label, fields) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${'═'.repeat(60)}`);

  const entries = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b));
  for (const [name, data] of entries) {
    const val = data.value ?? data;
    const conf = data.confidence != null ? ` (${Math.round(data.confidence * 100)}%)` : '';
    const src = data.source ? `  ← ${data.source}` : '';
    console.log(`  ${name.padEnd(35)} ${String(val).padEnd(25)}${conf}${src}`);
  }
}

function printComparison(llmFields, codegenFields) {
  console.log(`\n${'═'.repeat(80)}`);
  console.log('  SIDE-BY-SIDE COMPARISON');
  console.log(`${'═'.repeat(80)}`);
  console.log(`  ${'Field'.padEnd(30)} ${'LLM'.padEnd(22)} ${'Codegen'.padEnd(22)} Match?`);
  console.log(`  ${'-'.repeat(76)}`);

  const allKeys = new Set([...Object.keys(llmFields), ...Object.keys(codegenFields)]);
  let matches = 0;
  let total = 0;

  for (const key of [...allKeys].sort()) {
    const llmVal = llmFields[key]?.value ?? llmFields[key] ?? '—';
    const cgVal = codegenFields[key]?.value ?? codegenFields[key] ?? '—';

    const llmStr = String(llmVal).slice(0, 20);
    const cgStr = String(cgVal).slice(0, 20);

    const isMatch = String(llmVal).trim() === String(cgVal).trim();
    if (llmVal !== '—' && cgVal !== '—') {
      total++;
      if (isMatch) matches++;
    }

    const marker = llmVal === '—' || cgVal === '—' ? '  ' : isMatch ? '✓' : '✗';
    console.log(`  ${key.padEnd(30)} ${llmStr.padEnd(22)} ${cgStr.padEnd(22)} ${marker}`);
  }

  console.log(`\n  Agreement: ${matches}/${total} fields match (${total > 0 ? Math.round(matches / total * 100) : 0}%)`);
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  const { filePath, skillId: forcedSkillId, orgId } = parseArgs();

  console.log(`\nFile: ${filePath}`);
  console.log(`Forced skill: ${forcedSkillId || '(auto-classify)'}`);
  console.log(`Org: ${orgId || '(none)'}\n`);

  // 1. Parse file
  console.log('1. Parsing file...');
  const { text, buffer, ext } = await parseFile(filePath);
  console.log(`   Parsed ${text.length} chars (ext=${ext})\n`);

  // 2. Fetch skills
  console.log('2. Fetching skills...');
  const skills = await fetchActiveSkills();
  console.log(`   Found ${skills.length} active skills\n`);

  // 3. Classify or use forced skill
  let skill;
  let classifierConfidence = 1.0;

  if (forcedSkillId) {
    skill = skills.find(s => s.skill_id === forcedSkillId);
    if (!skill) {
      console.error(`Skill "${forcedSkillId}" not found. Available: ${skills.map(s => s.skill_id).join(', ')}`);
      process.exit(1);
    }
    console.log(`3. Using forced skill: ${skill.display_name} (${skill.skill_id})\n`);
  } else {
    console.log('3. Classifying document...');
    const classification = await classifyDoc(text, skills);
    skill = skills.find(s => s.skill_id === classification.skill_id);
    classifierConfidence = classification.confidence || 0.5;
    if (!skill) {
      console.error(`Classification returned "${classification.skill_id}" but no matching skill found.`);
      console.error(`Available: ${skills.map(s => s.skill_id).join(', ')}`);
      process.exit(1);
    }
    console.log(`   → ${skill.display_name} (${skill.skill_id}) confidence=${classifierConfidence}`);
    console.log(`   Reasoning: ${classification.reasoning}\n`);
  }

  // 4. Fetch field definitions
  console.log('4. Fetching field definitions...');
  let fieldDefs = await fetchSkillFieldDefs(skill.skill_id);

  if (fieldDefs.length === 0 && skill.field_definitions) {
    console.log('   No catalog fields — using legacy field_definitions from skill');
    fieldDefs = (Array.isArray(skill.field_definitions) ? skill.field_definitions : [])
      .map(f => ({
        name: f.name,
        type: f.type || 'string',
        tier: f.tier ?? 1,
        required: f.required ?? false,
        description: f.description || '',
        options: f.options,
      }));
  }
  console.log(`   ${fieldDefs.length} fields defined\n`);

  // 5. Fetch context card fields
  const contextCardFields = await fetchContextCardFields(skill.skill_id, orgId);
  if (contextCardFields.length > 0) {
    console.log(`   + ${contextCardFields.length} context card fields\n`);
  }

  // 6. Run LLM extraction
  console.log('5. Running LLM extraction (Opus 4.6)...');
  let llmResult;
  try {
    llmResult = await extractLLM(text, skill, fieldDefs);
    console.log(`   Done in ${llmResult.elapsed}ms (tokens: in=${llmResult.tokens.input} out=${llmResult.tokens.output})`);
    printFields('LLM EXTRACTION (Opus 4.6)', llmResult.fields);
  } catch (err) {
    console.error(`   LLM extraction failed: ${err.message}`);
    llmResult = null;
  }

  // 7. Run codegen extraction
  console.log('\n6. Running CODEGEN extraction (Opus 4.6 → Python → local exec)...');
  let codegenResult;
  try {
    codegenResult = await extractCodegen(buffer, text, skill, fieldDefs, contextCardFields, ext);
    console.log(`   Done in ${codegenResult.elapsed}ms`);
    printFields('CODEGEN EXTRACTION', codegenResult.fields);

    if (codegenResult.records?.length > 0) {
      console.log(`\n   Records: ${codegenResult.records.length} rows extracted`);
      console.log(`   Sample: ${JSON.stringify(codegenResult.records[0]).slice(0, 200)}`);
    }

    if (Object.keys(codegenResult.discoveredFields).length > 0) {
      console.log(`\n   Discovered fields: ${Object.keys(codegenResult.discoveredFields).length}`);
      for (const [k, v] of Object.entries(codegenResult.discoveredFields)) {
        console.log(`     ${k}: ${JSON.stringify(v).slice(0, 100)}`);
      }
    }
  } catch (err) {
    console.error(`   Codegen extraction failed: ${err.message}`);
    codegenResult = null;
  }

  // 8. Compare
  if (llmResult && codegenResult) {
    printComparison(llmResult.fields, codegenResult.fields);
  }

  // Save generated code for inspection
  if (codegenResult?.generatedCode) {
    const codePath = '/tmp/codegen_last_script.py';
    fs.writeFileSync(codePath, codegenResult.generatedCode);
    console.log(`\nGenerated Python script saved to: ${codePath}`);
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
