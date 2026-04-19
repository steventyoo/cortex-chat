import { z } from 'zod';
import { normalizeJsonObject } from './helpers';

export const EvalItemSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  category: z.string(),
  question: z.string(),
  project_id: z.string(),
  expected_answer: z.string().default(''),
  key_values: normalizeJsonObject.transform(v => v ?? {}),
  expected_tool: z.string().default(''),
  is_active: z.coerce.boolean().default(true),
  created_by: z.string().nullable().default(null),
  updated_by: z.string().nullable().default(null),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type EvalItem = z.infer<typeof EvalItemSchema>;

export const CreateEvalItemInput = z.object({
  id: z.string().min(1, 'id is required'),
  category: z.string().min(1, 'category is required'),
  question: z.string().min(1, 'question is required'),
  projectId: z.string().min(1, 'projectId is required'),
  expectedAnswer: z.string().optional().default(''),
  keyValues: z.record(z.string(), z.unknown()).optional().default({}),
  expectedTool: z.string().optional().default(''),
});

export type CreateEvalItemInput = z.infer<typeof CreateEvalItemInput>;

export const UpdateEvalItemInput = z.object({
  category: z.string().optional(),
  question: z.string().optional(),
  projectId: z.string().optional(),
  expectedAnswer: z.string().optional(),
  keyValues: z.record(z.string(), z.unknown()).optional(),
  expectedTool: z.string().optional(),
  isActive: z.boolean().optional(),
});

export type UpdateEvalItemInput = z.infer<typeof UpdateEvalItemInput>;
