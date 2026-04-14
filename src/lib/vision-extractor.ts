/**
 * Vision extraction: send the raw PDF as a document block to Claude.
 *
 * Uses the same catalog-driven tool schema as LLM extraction, but replaces
 * the text input with the native PDF binary. Claude reads every page directly
 * — no text extraction, no regex, no code generation.
 *
 * This is the highest-accuracy extraction path. Reserve for documents where
 * precision matters (Job Detail Reports, Pay Applications, etc.).
 */

import Anthropic from '@anthropic-ai/sdk';
import { buildExtractionTool } from './extraction-schemas';
import { ExtractionResult, ExtractedField, ValidationFlag, computeOverallConfidence } from './pipeline';
import type { DocumentSkill, FieldDefinition } from './skills';

export interface VisionExtractionResult {
  extraction: ExtractionResult;
  discoveredFields: Record<string, unknown>;
  overallConfidence: number;
  flags: ValidationFlag[];
  metadata: {
    inputTokens: number;
    outputTokens: number;
    elapsedMs: number;
  };
}

function buildPromptText(skill: DocumentSkill): string {
  const lines: string[] = [
    'Extract ALL structured data from this document.',
    'Fill every required field with exact values from the document.',
    'For numerical values, extract EXACT numbers — do NOT estimate or round.',
  ];

  if (skill.multiRecordConfig) {
    lines.push('');
    lines.push('This document contains MULTIPLE line items / cost codes.');
    lines.push('Extract EVERY line item as a separate record in the "records" array.');
    lines.push(`Each record should contain: ${skill.multiRecordConfig.fields.join(', ')}.`);
    lines.push('The "fields" object should contain document-level summary data (totals, project info, report metadata).');
    lines.push('Extract ALL line items — do not summarize or skip any, even if there are hundreds.');
  }

  return lines.join('\n');
}

function mimeTypeForFile(fileExt: string): string {
  switch (fileExt.toLowerCase()) {
    case 'pdf': return 'application/pdf';
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    default: return 'application/pdf';
  }
}

export async function extractWithVision(
  rawBuffer: Buffer,
  skill: DocumentSkill,
  catalogFields: FieldDefinition[],
  classifierConfidence: number,
  fileExt: string,
): Promise<VisionExtractionResult> {
  const t0 = Date.now();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const tool = buildExtractionTool(skill, catalogFields);
  const base64 = rawBuffer.toString('base64');
  const mediaType = mimeTypeForFile(fileExt);
  const promptText = buildPromptText(skill);
  const maxTokens = skill.multiRecordConfig ? 64000 : 8192;

  console.log(
    `[vision] Starting extraction: skill=${skill.skillId} ` +
    `fileSize=${rawBuffer.length} ext=${fileExt} maxTokens=${maxTokens}`,
  );

  const messageParams: Anthropic.MessageCreateParams = {
    model: 'claude-opus-4-6',
    max_tokens: maxTokens,
    system: skill.systemPrompt,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: mediaType, data: base64 },
        } as Anthropic.DocumentBlockParam,
        { type: 'text', text: promptText },
      ],
    }],
    tools: [tool],
    tool_choice: { type: 'tool' as const, name: 'extract_document' },
  };

  let response: Anthropic.Message;
  if (skill.multiRecordConfig) {
    const stream = client.messages.stream(messageParams);
    response = await stream.finalMessage();
  } else {
    response = await client.messages.create(messageParams);
  }

  const elapsed = Date.now() - t0;
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;

  console.log(
    `[vision] Response received: stop=${response.stop_reason} ` +
    `tokens=${inputTokens}in/${outputTokens}out elapsed=${elapsed}ms`,
  );

  const toolBlock = response.content.find(b => b.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    throw new Error('[vision] No tool_use block in Claude response');
  }

  const raw = toolBlock.input as {
    documentType: string;
    documentTypeConfidence: number;
    fields: Record<string, { value: string | number | null; confidence: number }>;
    extra_fields?: Record<string, { value: string | number | null; confidence: number }>;
    records?: Array<Record<string, { value: string | number | null; confidence: number }>>;
  };

  const discoveredFields: Record<string, unknown> = {};
  if (raw.extra_fields) {
    for (const [key, val] of Object.entries(raw.extra_fields)) {
      discoveredFields[key] = val.value;
    }
    raw.fields = { ...raw.fields, ...raw.extra_fields };
    delete raw.extra_fields;
  }

  const extraction: ExtractionResult = {
    documentType: raw.documentType,
    documentTypeConfidence: raw.documentTypeConfidence,
    fields: raw.fields,
    records: raw.records,
    skillId: skill.skillId,
    skillVersion: skill.version,
    classifierConfidence,
  };

  const overallConfidence = computeOverallConfidence(extraction);

  const flags: ValidationFlag[] = [];
  for (const [fieldName, fieldData] of Object.entries(extraction.fields)) {
    if (fieldData.value !== null && fieldData.confidence < 0.7) {
      flags.push({
        field: fieldName,
        issue: `Low confidence (${Math.round(fieldData.confidence * 100)}%)`,
        severity: 'warning',
      });
    }
    if (fieldData.value === null) {
      const expectedField = catalogFields.find(f => f.name === fieldName);
      if (expectedField?.required) {
        flags.push({
          field: fieldName,
          issue: 'Missing — not detected in document',
          severity: 'info',
        });
      }
    }
  }

  console.log(
    `[vision] SUCCESS skill=${skill.skillId} fields=${Object.keys(extraction.fields).length} ` +
    `records=${extraction.records?.length ?? 0} discovered=${Object.keys(discoveredFields).length} ` +
    `confidence=${overallConfidence} elapsed=${elapsed}ms`,
  );

  return {
    extraction,
    discoveredFields,
    overallConfidence,
    flags,
    metadata: { inputTokens, outputTokens, elapsedMs: elapsed },
  };
}
