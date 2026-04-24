import { z } from 'zod';
import { DerivedFieldDataTypeEnum, DerivedFieldStatusEnum } from './enums';

// ─── Read Schema ─────────────────────────────────────────────────

export const DerivedFieldSchema = z.object({
  id: z.string().uuid(),
  canonical_name: z.string(),
  display_name: z.string(),
  source_skill_ids: z.array(z.string()),
  primary_skill_id: z.string(),
  tab: z.string(),
  section: z.string(),
  data_type: DerivedFieldDataTypeEnum,
  status: DerivedFieldStatusEnum,
  scope: z.string(),
  formula: z.string(),
  expression: z.string(),
  depends_on: z.array(z.string()).default([]),
  is_active: z.boolean().default(true),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type DerivedField = z.infer<typeof DerivedFieldSchema>;

// ─── Write Inputs ────────────────────────────────────────────────

export const CreateDerivedFieldInput = z.object({
  canonical_name: z.string().min(1),
  display_name: z.string().min(1),
  source_skill_ids: z.array(z.string()).min(1),
  primary_skill_id: z.string().min(1),
  tab: z.string().min(1),
  section: z.string().min(1),
  data_type: DerivedFieldDataTypeEnum,
  status: DerivedFieldStatusEnum.default('Derived'),
  scope: z.string().min(1),
  formula: z.string().min(1),
  expression: z.string().min(1),
  depends_on: z.array(z.string()).default([]),
});

export type CreateDerivedFieldInputType = z.infer<typeof CreateDerivedFieldInput>;

export const UpdateDerivedFieldInput = z.object({
  id: z.string().uuid(),
  canonical_name: z.string().min(1).optional(),
  display_name: z.string().min(1).optional(),
  source_skill_ids: z.array(z.string()).optional(),
  primary_skill_id: z.string().min(1).optional(),
  tab: z.string().min(1).optional(),
  section: z.string().min(1).optional(),
  data_type: DerivedFieldDataTypeEnum.optional(),
  status: DerivedFieldStatusEnum.optional(),
  scope: z.string().min(1).optional(),
  formula: z.string().min(1).optional(),
  expression: z.string().min(1).optional(),
  depends_on: z.array(z.string()).optional(),
  is_active: z.boolean().optional(),
});

export type UpdateDerivedFieldInputType = z.infer<typeof UpdateDerivedFieldInput>;
