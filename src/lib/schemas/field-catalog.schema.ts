import { z } from 'zod';
import { normalizeStringArray } from './helpers';
import { FieldTypeEnum, FieldCategoryEnum, FieldImportanceEnum } from './enums';

// ─── Catalog Field (field_catalog table) ────────────────────────────

export const CatalogFieldSchema = z.object({
  id: z.string().uuid(),
  canonical_name: z.string(),
  display_name: z.string(),
  field_type: FieldTypeEnum,
  category: FieldCategoryEnum,
  description: z.string().nullable().default(null),
  enum_options: normalizeStringArray,
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type CatalogField = z.infer<typeof CatalogFieldSchema>;

export const CatalogFieldWithUsageSchema = CatalogFieldSchema.extend({
  usage_count: z.number().default(0),
});

export type CatalogFieldWithUsage = z.infer<typeof CatalogFieldWithUsageSchema>;

// ─── Skill Field (skill_fields table + nested field_catalog) ────────

export const SkillFieldSchema = z.object({
  id: z.string().uuid(),
  skill_id: z.string(),
  field_id: z.string().uuid(),
  display_override: z.string().nullable().default(null),
  tier: z.coerce.number().default(1),
  required: z.coerce.boolean().default(false),
  importance: FieldImportanceEnum.nullable().default(null),
  description: z.string().nullable().default(''),
  options: normalizeStringArray,
  example: z.string().nullable().default(''),
  extraction_hint: z.string().nullable().default(null),
  disambiguation_rules: z.string().nullable().default(null),
  sort_order: z.coerce.number().default(0),
  field_catalog: CatalogFieldSchema,
});

export type SkillField = z.infer<typeof SkillFieldSchema>;

// ─── Write Inputs ───────────────────────────────────────────────────

export const CreateCatalogFieldInput = z.object({
  canonicalName: z.string().min(1, 'canonicalName is required'),
  displayName: z.string().min(1, 'displayName is required'),
  fieldType: FieldTypeEnum.optional().default('string'),
  category: FieldCategoryEnum.optional().default('general'),
  description: z.string().optional().default(''),
  enumOptions: z.array(z.string()).optional(),
});

export type CreateCatalogFieldInput = z.infer<typeof CreateCatalogFieldInput>;

export const UpdateCatalogFieldInput = z.object({
  id: z.string().uuid('id is required'),
  displayName: z.string().optional(),
  fieldType: FieldTypeEnum.optional(),
  category: FieldCategoryEnum.optional(),
  description: z.string().optional(),
  enumOptions: z.array(z.string()).nullable().optional(),
});

export type UpdateCatalogFieldInput = z.infer<typeof UpdateCatalogFieldInput>;

export const CreateSkillFieldInput = z.object({
  fieldId: z.string().uuid('fieldId is required'),
  displayOverride: z.string().optional(),
  tier: z.number().optional(),
  required: z.boolean().optional(),
  importance: FieldImportanceEnum.optional(),
  description: z.string().optional(),
  options: z.array(z.string()).optional(),
  example: z.string().optional(),
  extractionHint: z.string().optional(),
  disambiguationRules: z.string().optional(),
});

export type CreateSkillFieldInput = z.infer<typeof CreateSkillFieldInput>;

export const UpdateSkillFieldInput = z.object({
  id: z.string().uuid('id is required'),
  displayOverride: z.string().nullable().optional(),
  tier: z.number().optional(),
  required: z.boolean().optional(),
  importance: FieldImportanceEnum.nullable().optional(),
  description: z.string().optional(),
  options: z.array(z.string()).nullable().optional(),
  example: z.string().optional(),
  extractionHint: z.string().nullable().optional(),
  disambiguationRules: z.string().nullable().optional(),
  sortOrder: z.number().optional(),
});

export type UpdateSkillFieldInput = z.infer<typeof UpdateSkillFieldInput>;
