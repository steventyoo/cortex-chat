import { z } from 'zod';

export const ParserCacheSchema = z.object({
  id: z.string().uuid(),
  skill_id: z.string(),
  format_fingerprint: z.string(),
  parser_code: z.string(),
  parser_hash: z.string(),
  identity_score: z.number(),
  quality_score: z.number().nullable(),
  checks_passed: z.number().int(),
  checks_total: z.number().int(),
  promoted_from: z.string().uuid().nullable(),
  validated_count: z.number().int(),
  failure_count: z.number().int(),
  last_validated_at: z.string(),
  is_active: z.boolean(),
  meta: z.record(z.string(), z.unknown()).optional(),
  created_at: z.string(),
});
export type ParserCache = z.infer<typeof ParserCacheSchema>;

export const PromoteParserInput = z.object({
  skill_id: z.string(),
  format_fingerprint: z.string(),
  parser_code: z.string(),
  promoted_from: z.string().uuid().optional(),
  identity_score: z.number(),
  quality_score: z.number().optional(),
  checks_passed: z.number().int(),
  checks_total: z.number().int(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type PromoteParserInput = z.infer<typeof PromoteParserInput>;
