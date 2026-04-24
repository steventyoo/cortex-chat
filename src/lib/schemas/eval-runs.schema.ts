import { z } from 'zod';
import { normalizeJsonObject } from './helpers';

// ─── EvalRun (eval_runs table) ──────────────────────────────

export const EvalRunSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string(),
  run_label: z.string(),
  run_type: z.string(),
  skill_id: z.string().nullable().default(null),
  suite: z.string().nullable().default(null),
  total_items: z.coerce.number().default(0),
  passed: z.coerce.number().default(0),
  failed: z.coerce.number().default(0),
  missing: z.coerce.number().default(0),
  accuracy: z.coerce.number().default(0),
  metadata: normalizeJsonObject.transform((v) => v ?? {}),
  created_at: z.string().nullable().optional(),
});

export type EvalRun = z.infer<typeof EvalRunSchema>;

// ─── EvalRunResult (eval_run_results table) ─────────────────

export const EvalRunResultSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  item_key: z.string(),
  field: z.string().nullable().default(null),
  category: z.string().nullable().default(null),
  status: z.string(),
  score: z.coerce.number().default(0),
  expected: z.string().nullable().default(null),
  actual: z.string().nullable().default(null),
  delta: z.coerce.number().nullable().default(null),
  metadata: normalizeJsonObject.transform((v) => v ?? {}),
});

export type EvalRunResult = z.infer<typeof EvalRunResultSchema>;
