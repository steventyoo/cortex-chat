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

function valueSchemaForType(fd: FieldDefinition): Record<string, unknown> {
  switch (fd.type) {
    case 'number':
      return { anyOf: [{ type: 'number' as const }, { type: 'null' as const }] };
    case 'boolean':
      return { anyOf: [{ type: 'boolean' as const }, { type: 'null' as const }] };
    case 'enum':
      if (Array.isArray(fd.options) && fd.options.length) {
        return { anyOf: [{ type: 'string' as const, enum: fd.options }, { type: 'null' as const }] };
      }
      return { anyOf: [{ type: 'string' as const }, { type: 'null' as const }] };
    case 'date':
      return {
        anyOf: [
          { type: 'string' as const, description: 'ISO 8601 date string (YYYY-MM-DD)' },
          { type: 'null' as const },
        ],
      };
    case 'array':
      return {
        anyOf: [
          { type: 'array' as const, items: { type: 'string' as const } },
          { type: 'null' as const },
        ],
      };
    case 'string':
    default:
      return { anyOf: [{ type: 'string' as const }, { type: 'null' as const }] };
  }
}

function fieldTypeToJsonSchema(fd: FieldDefinition): Record<string, unknown> {
  const desc = fd.description
    + (Array.isArray(fd.options) && fd.options.length ? ` Options: [${fd.options.join(', ')}]` : '');

  return {
    type: 'object' as const,
    description: desc,
    properties: {
      value: valueSchemaForType(fd),
      confidence: { type: 'number' as const, minimum: 0, maximum: 1 },
    },
    required: ['value', 'confidence'],
  };
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
  fields: FieldDefinition[],
): Anthropic.Messages.Tool {
  const fieldProperties: Record<string, unknown> = {};
  const seen = new Set<string>();

  for (const fd of fields) {
    if (seen.has(fd.name)) {
      console.warn(`[schema] Skipping duplicate field "${fd.name}" in skill ${skill.skillId}`);
      continue;
    }
    seen.add(fd.name);
    fieldProperties[fd.name] = fieldTypeToJsonSchema(fd);
  }

  const requiredFields = Object.keys(fieldProperties);

  const properties: Record<string, unknown> = {
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
  };
  const required = ['documentType', 'documentTypeConfidence', 'fields', 'extra_fields'];

  if (skill.multiRecordConfig && Array.isArray(skill.multiRecordConfig.fields) && skill.multiRecordConfig.fields.length > 0) {
    const recordFields: Record<string, unknown> = {};
    for (const fieldName of skill.multiRecordConfig.fields) {
      const fd = fields.find(f => f.name === fieldName);
      recordFields[fieldName] = fd
        ? fieldTypeToJsonSchema(fd)
        : { ...EXTRACTED_FIELD_JSON_SCHEMA, description: fieldName };
    }

    properties.records = {
      type: 'array',
      description:
        'Array of line-item records extracted from the document. ' +
        'Each record represents one cost code / line item with its own values.',
      items: {
        type: 'object',
        properties: recordFields,
        required: Object.keys(recordFields),
      },
    };
    required.push('records');

    if (Array.isArray(skill.multiRecordConfig.secondaryTables)) {
      for (const st of skill.multiRecordConfig.secondaryTables) {
        const stFields: Record<string, unknown> = {};
        for (const fieldName of st.fields) {
          const fd = fields.find(f => f.name === fieldName);
          stFields[fieldName] = fd
            ? fieldTypeToJsonSchema(fd)
            : { ...EXTRACTED_FIELD_JSON_SCHEMA, description: fieldName };
        }
        properties[st.table] = {
          type: 'array',
          description: `Secondary extraction table: ${st.table}. One entry per row found.`,
          items: {
            type: 'object',
            properties: stFields,
            additionalProperties: EXTRACTED_FIELD_JSON_SCHEMA,
          },
        };
      }
    }
  }

  return {
    name: 'extract_document',
    description: `Extract structured data from a ${skill.displayName} document.`,
    input_schema: {
      type: 'object',
      properties,
      required,
    },
  };
}

// ── Post-Extraction Coercion ─────────────────────────────────

/** Input from LLM may include booleans; output is always pipeline-compatible. */
type RawFieldVal = { value: string | number | boolean | null; confidence: number };
type PipelineField = { value: string | number | null; confidence: number };

function coerceField(
  fieldName: string,
  field: RawFieldVal,
  fd: FieldDefinition | undefined,
): { field: PipelineField; warning?: string } {
  if (field.value === null || field.value === undefined || !fd) {
    const v = field.value;
    const safe: string | number | null = typeof v === 'boolean' ? String(v) : (v ?? null);
    return { field: { value: safe, confidence: field.confidence } };
  }

  const raw = field.value;

  switch (fd.type) {
    case 'number': {
      if (typeof raw === 'number') return { field: { value: raw, confidence: field.confidence } };
      const stripped = String(raw).replace(/[$,%\s]/g, '').replace(/,/g, '');
      const n = parseFloat(stripped);
      if (!isNaN(n)) {
        return {
          field: { value: n, confidence: field.confidence },
          warning: `${fieldName}: coerced "${String(raw).slice(0, 40)}" → ${n}`,
        };
      }
      return {
        field: { value: 0, confidence: field.confidence },
        warning: `${fieldName}: unparseable number "${String(raw).slice(0, 40)}", defaulted to 0`,
      };
    }

    case 'boolean': {
      if (typeof raw === 'boolean') {
        return { field: { value: raw ? 'true' : 'false', confidence: field.confidence } };
      }
      const s = String(raw).toLowerCase().trim();
      if (['true', '1', 'yes'].includes(s)) {
        return { field: { value: 'true', confidence: field.confidence }, warning: `${fieldName}: coerced "${raw}" → "true"` };
      }
      if (['false', '0', 'no'].includes(s)) {
        return { field: { value: 'false', confidence: field.confidence }, warning: `${fieldName}: coerced "${raw}" → "false"` };
      }
      return { field: { value: String(raw), confidence: field.confidence } };
    }

    case 'enum': {
      const s = String(raw);
      if (Array.isArray(fd.options) && fd.options.length) {
        if (!fd.options.includes(s)) {
          const match = fd.options.find(o => o.toLowerCase() === s.toLowerCase());
          if (match) {
            return { field: { value: match, confidence: field.confidence }, warning: `${fieldName}: case-corrected "${s}" → "${match}"` };
          }
          return { field: { value: s, confidence: field.confidence }, warning: `${fieldName}: value "${s.slice(0, 40)}" not in enum [${fd.options.join(', ')}]` };
        }
      }
      return { field: { value: s, confidence: field.confidence } };
    }

    case 'date': {
      const s = String(raw).trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return { field: { value: s, confidence: field.confidence } };
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        const iso = d.toISOString().slice(0, 10);
        return { field: { value: iso, confidence: field.confidence }, warning: `${fieldName}: normalized date "${s.slice(0, 30)}" → "${iso}"` };
      }
      return { field: { value: s, confidence: field.confidence } };
    }

    case 'string':
    default: {
      if (typeof raw !== 'string') {
        return { field: { value: String(raw), confidence: field.confidence }, warning: `${fieldName}: coerced ${typeof raw} to string` };
      }
      return { field: { value: raw, confidence: field.confidence } };
    }
  }
}

function coerceFieldMap(
  fields: Record<string, RawFieldVal>,
  catalog: FieldDefinition[],
): { fields: Record<string, PipelineField>; warnings: string[] } {
  const out: Record<string, PipelineField> = {};
  const warnings: string[] = [];
  for (const [name, fld] of Object.entries(fields)) {
    const fd = catalog.find(f => f.name === name);
    const { field: coerced, warning } = coerceField(name, fld, fd);
    out[name] = coerced;
    if (warning) warnings.push(warning);
  }
  return { fields: out, warnings };
}

export interface CoercionResult {
  fields: Record<string, PipelineField>;
  records?: Array<Record<string, PipelineField>>;
  warnings: string[];
}

/**
 * Validates and coerces raw LLM extraction output against the field catalog.
 * Handles type mismatches (e.g. string "1,234" for a number field) that slip
 * past the JSON Schema constraints.
 */
export function coerceExtractionResult(
  raw: {
    fields: Record<string, RawFieldVal>;
    records?: Array<Record<string, RawFieldVal>>;
  },
  catalog: FieldDefinition[],
): CoercionResult {
  const { fields, warnings } = coerceFieldMap(raw.fields, catalog);

  let records: Array<Record<string, PipelineField>> | undefined;
  if (Array.isArray(raw.records)) {
    records = [];
    for (const rec of raw.records) {
      const r = coerceFieldMap(rec, catalog);
      records.push(r.fields);
      warnings.push(...r.warnings);
    }
  }

  return { fields, records, warnings };
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
