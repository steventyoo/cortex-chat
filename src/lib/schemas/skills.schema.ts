import { z } from 'zod';
import { normalizeStringArray, normalizeJsonObject, normalizeJsonArray } from './helpers';

// ─── Skill (document_skills table) ──────────────────────────────────

export const SkillSchema = z.object({
  id: z.string().uuid(),
  skill_id: z.string(),
  display_name: z.string(),
  version: z.coerce.number().default(1),
  status: z.string().default('active'),
  system_prompt: z.string().nullable().default(null),
  extraction_instructions: z.string().nullable().default(null),
  field_definitions: normalizeJsonArray,
  target_table: z.string().nullable().default(null),
  column_mapping: normalizeJsonObject,
  sample_extractions: normalizeJsonArray,
  classifier_hints: normalizeJsonObject,
  reference_doc_ids: normalizeStringArray,
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type Skill = z.infer<typeof SkillSchema>;

// ─── Skill Version (skill_version_history table) ────────────────────

export const SkillVersionSchema = z.object({
  id: z.string().uuid().optional(),
  skill_id: z.string(),
  version: z.coerce.number(),
  snapshot: z.record(z.string(), z.unknown()).nullable().default(null),
  changed_by: z.string().nullable().default(null),
  change_summary: z.string().nullable().default(null),
  created_at: z.string().nullable().optional(),
});

export type SkillVersion = z.infer<typeof SkillVersionSchema>;

// ─── Org Skill Config (org_skill_configs table) ─────────────────────

export const OrgSkillConfigSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  skill_id: z.string(),
  pinned_version: z.coerce.number().nullable().default(null),
  document_aliases: normalizeStringArray.transform(v => v ?? []),
  hidden_fields: normalizeStringArray.transform(v => v ?? []),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type OrgSkillConfig = z.infer<typeof OrgSkillConfigSchema>;

// ─── Write Inputs ───────────────────────────────────────────────────

export const CreateOrgSkillConfigInput = z.object({
  orgId: z.string().uuid('orgId is required'),
  pinned_version: z.number().nullable().optional(),
  document_aliases: z.array(z.string()).optional().default([]),
  hidden_fields: z.array(z.string()).optional().default([]),
});

export type CreateOrgSkillConfigInput = z.infer<typeof CreateOrgSkillConfigInput>;
