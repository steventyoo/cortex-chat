import { z } from 'zod';
import { normalizeStringArray } from './helpers';

// ─── Link Type (document_link_types table) ──────────────────────────

export const LinkTypeSchema = z.object({
  id: z.string().uuid(),
  link_type_key: z.string(),
  display_name: z.string(),
  source_skill: z.string(),
  target_skill: z.string(),
  relationship: z.string(),
  match_fields: normalizeStringArray.transform(v => v ?? []),
  description: z.string().nullable().default(''),
  is_active: z.coerce.boolean().default(true),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type LinkType = z.infer<typeof LinkTypeSchema>;

// ─── Write Inputs ───────────────────────────────────────────────────

export const CreateLinkTypeInput = z.object({
  linkTypeKey: z.string().min(1, 'linkTypeKey is required'),
  displayName: z.string().min(1, 'displayName is required'),
  sourceSkill: z.string().min(1, 'sourceSkill is required'),
  targetSkill: z.string().min(1, 'targetSkill is required'),
  relationship: z.string().min(1, 'relationship is required'),
  matchFields: z.array(z.string()).optional().default([]),
  description: z.string().optional().default(''),
});

export type CreateLinkTypeInput = z.infer<typeof CreateLinkTypeInput>;

export const UpdateLinkTypeInput = z.object({
  displayName: z.string().optional(),
  matchFields: z.array(z.string()).optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});

export type UpdateLinkTypeInput = z.infer<typeof UpdateLinkTypeInput>;
