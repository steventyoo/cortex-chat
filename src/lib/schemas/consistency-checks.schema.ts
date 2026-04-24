import { z } from 'zod';
import { CheckClassificationEnum } from './enums';

// ─── Read Schema ─────────────────────────────────────────────────

export const ConsistencyCheckSchema = z.object({
  id: z.string().uuid(),
  skill_id: z.string(),
  check_name: z.string(),
  display_name: z.string(),
  description: z.string().nullable().default(null),
  tier: z.coerce.number(),
  classification: CheckClassificationEnum,
  scope: z.string(),
  expression: z.string(),
  tolerance_abs: z.coerce.number().default(0.01),
  affected_fields: z.array(z.string()).default([]),
  hint_template: z.string().nullable().default(null),
  is_active: z.boolean().default(true),
  created_at: z.string().nullable().optional(),
});

export type ConsistencyCheck = z.infer<typeof ConsistencyCheckSchema>;

// ─── Write Inputs ────────────────────────────────────────────────

export const CreateConsistencyCheckInput = z.object({
  skill_id: z.string().min(1),
  check_name: z.string().min(1),
  display_name: z.string().min(1),
  description: z.string().nullable().default(null),
  tier: z.coerce.number().min(1).max(4),
  classification: CheckClassificationEnum,
  scope: z.string().min(1).default('doc'),
  expression: z.string().min(1),
  tolerance_abs: z.coerce.number().default(0.01),
  affected_fields: z.array(z.string()).default([]),
  hint_template: z.string().nullable().default(null),
});

export type CreateConsistencyCheckInputType = z.infer<typeof CreateConsistencyCheckInput>;

export const UpdateConsistencyCheckInput = z.object({
  id: z.string().uuid(),
  check_name: z.string().min(1).optional(),
  display_name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  tier: z.coerce.number().min(1).max(4).optional(),
  classification: CheckClassificationEnum.optional(),
  scope: z.string().min(1).optional(),
  expression: z.string().min(1).optional(),
  tolerance_abs: z.coerce.number().optional(),
  affected_fields: z.array(z.string()).optional(),
  hint_template: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
});

export type UpdateConsistencyCheckInputType = z.infer<typeof UpdateConsistencyCheckInput>;
