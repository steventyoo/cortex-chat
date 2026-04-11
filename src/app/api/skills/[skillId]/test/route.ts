import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, isAdminRole } from '@/lib/auth-v2';
import { parseFileBuffer } from '@/lib/file-parser';
import {
  buildExtractionTool,
  buildGeneralExtractionTool,
} from '@/lib/extraction-schemas';
import Anthropic from '@anthropic-ai/sdk';
import { FieldDefinition, DocumentSkill, buildSkillPrompt } from '@/lib/skills';
import { computeOverallConfidence, ValidationFlag } from '@/lib/pipeline';
import { retrieveKnowledgeChunks } from '@/lib/knowledge';

interface RouteParams {
  params: Promise<{ skillId: string }>;
}

/**
 * POST /api/skills/[skillId]/test
 *
 * Runs extraction with *unsaved* skill overrides against an uploaded document.
 * Accepts multipart form data with the file and JSON-serialized overrides.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session || !isAdminRole(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { skillId } = await params;
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const overridesRaw = formData.get('overrides') as string;

  if (!file) {
    return Response.json({ error: 'No file provided' }, { status: 400 });
  }

  let overrides: {
    fieldDefinitions?: FieldDefinition[];
    systemPrompt?: string;
    extractionInstructions?: string;
    sampleExtractions?: Array<{ inputSnippet: string; expectedOutput: Record<string, unknown> }>;
    referenceDocIds?: string[];
  } = {};

  try {
    if (overridesRaw) overrides = JSON.parse(overridesRaw);
  } catch {
    return Response.json({ error: 'Invalid overrides JSON' }, { status: 400 });
  }

  // Parse the uploaded file into text
  const t0 = Date.now();
  let sourceText: string;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await parseFileBuffer(buffer, file.type, file.name);
    sourceText = result.text;
  } catch (err) {
    return Response.json({
      error: `Failed to parse file: ${err instanceof Error ? err.message : 'unknown'}`,
    }, { status: 400 });
  }
  const tParse = Date.now() - t0;

  // Truncate to avoid token limit issues
  const MAX_CHARS = 200_000;
  const truncated = sourceText.length > MAX_CHARS;
  if (truncated) sourceText = sourceText.slice(0, MAX_CHARS);

  // Build a temporary skill object with overrides
  const tempSkill: DocumentSkill = {
    id: '',
    skillId,
    displayName: skillId,
    version: 0,
    status: 'draft',
    systemPrompt: overrides.systemPrompt || '',
    fieldDefinitions: overrides.fieldDefinitions || [],
    targetTable: 'extracted_records',
    multiRecordConfig: null,
    columnMapping: {},
    sampleExtractions: overrides.sampleExtractions || [],
    classifierHints: null,
  };

  // Retrieve reference document chunks if available
  let knowledgeContext = '';
  if (overrides.referenceDocIds && overrides.referenceDocIds.length > 0) {
    try {
      const chunks = await retrieveKnowledgeChunks(
        sourceText.slice(0, 2000),
        overrides.referenceDocIds,
        5,
        0.25
      );
      if (chunks.length > 0) {
        knowledgeContext = '\n\n## Reference Context\n' +
          chunks.map((c, i) => `[Ref ${i + 1}] ${c.content}`).join('\n\n');
      }
    } catch (err) {
      console.error('[skill-test] Knowledge retrieval failed:', err);
    }
  }

  // Build extraction prompt
  const testFields = tempSkill.fieldDefinitions;
  let extractionPrompt = buildSkillPrompt(tempSkill, testFields, sourceText);

  if (overrides.extractionInstructions) {
    extractionPrompt = `## Additional Instructions\n${overrides.extractionInstructions}\n\n${extractionPrompt}`;
  }

  if (knowledgeContext) {
    extractionPrompt = `${knowledgeContext}\n\n${extractionPrompt}`;
  }

  // Run extraction
  const tExtractStart = Date.now();
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const isTyped = testFields.length > 0;
    const tool = isTyped ? buildExtractionTool(tempSkill, testFields) : buildGeneralExtractionTool();

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: tempSkill.systemPrompt,
      messages: [{ role: 'user', content: extractionPrompt }],
      tools: [tool],
      tool_choice: { type: 'tool', name: 'extract_document' },
    });

    const toolBlock = response.content.find(b => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      throw new Error('No tool_use block in extraction response');
    }

    const rawExtraction = toolBlock.input as {
      documentType: string;
      documentTypeConfidence: number;
      fields: Record<string, { value: string | number | null; confidence: number }>;
      extra_fields?: Record<string, { value: string | number | null; confidence: number }>;
    };

    if (rawExtraction.extra_fields) {
      rawExtraction.fields = { ...rawExtraction.fields, ...rawExtraction.extra_fields };
      delete rawExtraction.extra_fields;
    }

    const extraction = {
      documentType: rawExtraction.documentType,
      documentTypeConfidence: rawExtraction.documentTypeConfidence,
      fields: rawExtraction.fields,
      skillId,
      skillVersion: 0,
      classifierConfidence: 1,
    };

    const overallConfidence = computeOverallConfidence(extraction);
    const flags: ValidationFlag[] = [];

    for (const [fieldName, fieldData] of Object.entries(extraction.fields)) {
      if (fieldData.value !== null && fieldData.confidence < 0.7) {
        flags.push({ field: fieldName, issue: `Low confidence (${Math.round(fieldData.confidence * 100)}%)`, severity: 'warning' });
      }
    }

    for (const fd of testFields) {
      if (fd.required && !(fd.name in extraction.fields)) {
        flags.push({ field: fd.name, issue: 'Required field not returned', severity: 'warning' });
      }
    }

    const tExtract = Date.now() - tExtractStart;
    const tTotal = Date.now() - t0;

    return Response.json({
      extraction,
      overallConfidence,
      flags,
      sourceText: sourceText.slice(0, 10000),
      truncated,
      timing: { parse: tParse, extract: tExtract, total: tTotal },
      tokenUsage: {
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      },
    });
  } catch (err) {
    const tExtract = Date.now() - tExtractStart;
    return Response.json({
      error: `Extraction failed: ${err instanceof Error ? err.message : 'unknown'}`,
      sourceText: sourceText.slice(0, 5000),
      truncated,
      timing: { parse: tParse, extract: tExtract, total: Date.now() - t0 },
    }, { status: 500 });
  }
}
