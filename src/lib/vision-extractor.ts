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
import type { LangfuseParent } from './langfuse';
import { PDFDocument } from 'pdf-lib';

const VISION_MAX_RAW_BYTES = 20 * 1024 * 1024; // ~20MB raw → safe under Claude's request limit after base64 inflation

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

  if (skill.multiRecordConfig && Array.isArray(skill.multiRecordConfig.fields) && skill.multiRecordConfig.fields.length > 0) {
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
  options?: { langfuseParent?: LangfuseParent },
): Promise<VisionExtractionResult> {
  const t0 = Date.now();

  if (fileExt === 'pdf' && rawBuffer.length > VISION_MAX_RAW_BYTES) {
    console.log(`[vision] PDF too large for single request (${(rawBuffer.length / 1024 / 1024).toFixed(1)}MB). Using chunked extraction.`);
    return extractWithVisionChunked(rawBuffer, skill, catalogFields, classifierConfidence, fileExt, options);
  }

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

  const generation = options?.langfuseParent?.generation({
    name: 'vision-extraction',
    model: 'claude-opus-4-6',
    input: { system: skill.systemPrompt, promptText, fileExt, fileSizeBytes: rawBuffer.length, skillId: skill.skillId, toolName: tool.name },
    modelParameters: { maxTokens },
  });

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

  generation?.end({
    output: raw,
    usage: { input: inputTokens, output: outputTokens },
    metadata: {
      stopReason: response.stop_reason,
      fieldCount: Object.keys(raw.fields).length,
      extraFieldCount: raw.extra_fields ? Object.keys(raw.extra_fields).length : 0,
      recordCount: raw.records?.length ?? 0,
      elapsedMs: elapsed,
    },
  });

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

/**
 * Chunked vision extraction: splits a large PDF into page-range chunks
 * that each fit under Claude's request size limit, extracts from each,
 * then merges results (highest confidence wins for field conflicts).
 */
async function extractWithVisionChunked(
  rawBuffer: Buffer,
  skill: DocumentSkill,
  catalogFields: FieldDefinition[],
  classifierConfidence: number,
  fileExt: string,
  options?: { langfuseParent?: LangfuseParent },
): Promise<VisionExtractionResult> {
  const t0 = Date.now();
  const pdfDoc = await PDFDocument.load(rawBuffer);
  const totalPages = pdfDoc.getPageCount();

  const chunks: Buffer[] = [];
  let startPage = 0;

  while (startPage < totalPages) {
    let endPage = startPage;
    let lastGoodChunk: Uint8Array | null = null;

    while (endPage < totalPages) {
      const chunkDoc = await PDFDocument.create();
      const pageIndices = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);
      const copiedPages = await chunkDoc.copyPages(pdfDoc, pageIndices);
      copiedPages.forEach(p => chunkDoc.addPage(p));
      const chunkBytes = await chunkDoc.save();

      if (chunkBytes.length > VISION_MAX_RAW_BYTES) {
        if (lastGoodChunk) break;
        // Single page exceeds limit — include it anyway, it'll be the best we can do
        lastGoodChunk = chunkBytes;
        endPage++;
        break;
      }
      lastGoodChunk = chunkBytes;
      endPage++;
    }

    if (lastGoodChunk) {
      chunks.push(Buffer.from(lastGoodChunk));
    }
    startPage = endPage;
  }

  console.log(`[vision] Split ${totalPages}-page PDF into ${chunks.length} chunks`);

  const mergedFields: Record<string, ExtractedField> = {};
  const mergedDiscovered: Record<string, unknown> = {};
  const allRecords: Array<Record<string, ExtractedField>> = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const chunkSpan = options?.langfuseParent?.span({
    name: 'vision-chunked',
    input: { totalPages, chunkCount: chunks.length, rawSizeMB: (rawBuffer.length / 1024 / 1024).toFixed(1) },
  });

  for (let i = 0; i < chunks.length; i++) {
    console.log(`[vision] Processing chunk ${i + 1}/${chunks.length} (${(chunks[i].length / 1024 / 1024).toFixed(1)}MB)`);
    try {
      const chunkResult = await extractWithVision(
        chunks[i], skill, catalogFields, classifierConfidence, fileExt,
        { langfuseParent: chunkSpan },
      );

      for (const [key, val] of Object.entries(chunkResult.extraction.fields)) {
        if (!mergedFields[key] || val.confidence > mergedFields[key].confidence) {
          mergedFields[key] = val;
        }
      }
      for (const [key, val] of Object.entries(chunkResult.discoveredFields)) {
        if (!(key in mergedDiscovered)) {
          mergedDiscovered[key] = val;
        }
      }
      if (chunkResult.extraction.records) {
        allRecords.push(...chunkResult.extraction.records);
      }

      totalInputTokens += chunkResult.metadata.inputTokens;
      totalOutputTokens += chunkResult.metadata.outputTokens;
    } catch (err) {
      console.warn(`[vision] Chunk ${i + 1} failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  const elapsed = Date.now() - t0;

  const extraction: ExtractionResult = {
    documentType: skill.skillId,
    documentTypeConfidence: classifierConfidence,
    fields: mergedFields,
    records: allRecords.length > 0 ? allRecords : undefined,
    skillId: skill.skillId,
    skillVersion: skill.version,
    classifierConfidence,
  };

  const overallConfidence = computeOverallConfidence(extraction);
  const flags: ValidationFlag[] = [];
  for (const [name, f] of Object.entries(mergedFields)) {
    if (f.value !== null && f.confidence < 0.7) {
      flags.push({ field: name, issue: `Low confidence (${Math.round(f.confidence * 100)}%)`, severity: 'warning' });
    }
  }

  chunkSpan?.end({
    output: { fieldCount: Object.keys(mergedFields).length, recordCount: allRecords.length, overallConfidence },
    metadata: { totalInputTokens, totalOutputTokens, elapsedMs: elapsed, chunkCount: chunks.length },
  });

  console.log(`[vision] Chunked extraction complete: ${Object.keys(mergedFields).length} fields, ${allRecords.length} records, ${elapsed}ms`);

  return {
    extraction,
    discoveredFields: mergedDiscovered,
    overallConfidence,
    flags,
    metadata: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, elapsedMs: elapsed },
  };
}
