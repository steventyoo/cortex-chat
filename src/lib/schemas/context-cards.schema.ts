import { z } from 'zod';
import { normalizeStringArray, normalizeJsonObject, normalizeJsonArray } from './helpers';

// ─── Context Card (context_cards table) ─────────────────────────────

export const ContextCardSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  card_name: z.string(),
  display_name: z.string(),
  description: z.string().nullable().default(''),
  trigger_concepts: normalizeStringArray.transform(v => v ?? []),
  skills_involved: normalizeStringArray.transform(v => v ?? []),
  business_logic: z.string().nullable().default(null),
  key_fields: normalizeJsonObject.transform(v => v ?? {}),
  sql_templates: normalizeJsonObject.transform(v => v ?? {}),
  calc_function: z.string().nullable().default(null),
  example_questions: normalizeStringArray.transform(v => v ?? []),
  embedding: z.string().nullable().optional(),
  is_active: z.coerce.boolean().default(true),
  created_by: z.string().nullable().default(null),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type ContextCard = z.infer<typeof ContextCardSchema>;

// ─── Write Inputs ───────────────────────────────────────────────────

export const CreateContextCardInput = z.object({
  card_name: z.string().min(1),
  display_name: z.string().min(1),
  description: z.string().min(1),
  trigger_concepts: z.array(z.string()).optional().default([]),
  skills_involved: z.array(z.string()).optional().default([]),
  business_logic: z.string().optional(),
  key_fields: z.record(z.string(), z.unknown()).optional().default({}),
  example_questions: z.array(z.string()).optional().default([]),
  is_active: z.boolean().optional().default(true),
});

export type CreateContextCardInput = z.infer<typeof CreateContextCardInput>;

export const UpdateContextCardInput = z.object({
  id: z.string().uuid('id is required'),
  card_name: z.string().optional(),
  display_name: z.string().optional(),
  description: z.string().optional(),
  trigger_concepts: z.array(z.string()).optional(),
  skills_involved: z.array(z.string()).optional(),
  business_logic: z.string().optional(),
  key_fields: z.record(z.string(), z.unknown()).optional(),
  example_questions: z.array(z.string()).optional(),
  is_active: z.boolean().optional(),
});

export type UpdateContextCardInput = z.infer<typeof UpdateContextCardInput>;
