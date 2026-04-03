/**
 * Zod schemas and Anthropic tool builders for structured extraction.
 *
 * Uses Anthropic's tool_use with forced tool_choice to guarantee valid JSON
 * output instead of parsing free-text responses.
 */

import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import type { DocumentSkill, FieldDefinition } from './skills';

// ── Shared Schemas ───────────────────────────────────────────

export const ExtractedFieldSchema = z.object({
  value: z.union([z.string(), z.number(), z.null()]),
  confidence: z.number().min(0).max(1),
});

export const ClassificationSchema = z.object({
  documentType: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().optional().default(''),
});

export type ClassificationOutput = z.infer<typeof ClassificationSchema>;

// ── JSON Schema Helpers ──────────────────────────────────────

const EXTRACTED_FIELD_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    value: {
      anyOf: [
        { type: 'string' as const },
        { type: 'number' as const },
        { type: 'null' as const },
      ],
    },
    confidence: { type: 'number' as const, minimum: 0, maximum: 1 },
  },
  required: ['value', 'confidence'],
};

function fieldTypeToJsonSchema(fd: FieldDefinition): Record<string, unknown> {
  const base: Record<string, unknown> = { ...EXTRACTED_FIELD_JSON_SCHEMA };
  const desc = fd.description + (fd.options?.length ? ` Options: [${fd.options.join(', ')}]` : '');
  base.description = desc;
  return base;
}

// ── Classification Tool ──────────────────────────────────────

export function buildClassificationTool(
  knownSkills: DocumentSkill[],
): Anthropic.Messages.Tool {
  const validIds = knownSkills
    .filter(s => s.skillId !== '_general')
    .map(s => s.skillId);

  return {
    name: 'classify_document',
    description: 'Classify a construction document into one of the known types.',
    input_schema: {
      type: 'object',
      properties: {
        documentType: {
          type: 'string',
          enum: validIds,
          description: 'The skill_id that best matches this document.',
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Confidence in the classification (0-1).',
        },
        reasoning: {
          type: 'string',
          description: 'Brief explanation for the classification.',
        },
      },
      required: ['documentType', 'confidence', 'reasoning'],
    },
  };
}

// ── Extraction Tool (Typed Skills) ───────────────────────────

export function buildExtractionTool(
  skill: DocumentSkill,
): Anthropic.Messages.Tool {
  const fieldProperties: Record<string, unknown> = {};
  const seen = new Set<string>();

  for (const fd of skill.fieldDefinitions) {
    if (seen.has(fd.name)) {
      console.warn(`[schema] Skipping duplicate field "${fd.name}" in skill ${skill.skillId}`);
      continue;
    }
    seen.add(fd.name);
    fieldProperties[fd.name] = fieldTypeToJsonSchema(fd);
  }

  const requiredFields = Object.keys(fieldProperties);

  return {
    name: 'extract_document',
    description: `Extract structured data from a ${skill.displayName} document.`,
    input_schema: {
      type: 'object',
      properties: {
        documentType: { type: 'string' },
        documentTypeConfidence: { type: 'number', minimum: 0, maximum: 1 },
        fields: {
          type: 'object',
          properties: fieldProperties,
          required: requiredFields,
        },
        extra_fields: {
          type: 'object',
          description:
            'Any additional fields discovered in the document beyond the defined schema. ' +
            'Use descriptive snake_case keys (e.g. "payment_terms", "insurance_requirements").',
          additionalProperties: EXTRACTED_FIELD_JSON_SCHEMA,
        },
      },
      required: ['documentType', 'documentTypeConfidence', 'fields', 'extra_fields'],
    },
  };
}

// ── Extraction Tool (General / Unknown Documents) ────────────

export function buildGeneralExtractionTool(): Anthropic.Messages.Tool {
  return {
    name: 'extract_document',
    description:
      'Extract all identifiable structured data from a document of unknown type.',
    input_schema: {
      type: 'object',
      properties: {
        documentType: { type: 'string', description: 'Best-guess document type.' },
        documentTypeConfidence: { type: 'number', minimum: 0, maximum: 1 },
        fields: {
          type: 'object',
          description:
            'All key-value pairs extracted from the document. Use descriptive snake_case keys. ' +
            'Include parties, dates, amounts, identifiers, descriptions, scope items, and any other relevant data.',
          additionalProperties: EXTRACTED_FIELD_JSON_SCHEMA,
        },
      },
      required: ['documentType', 'documentTypeConfidence', 'fields'],
    },
  };
}
