import { z } from 'zod';

export const GetContextInputSchema = z.object({
  question: z.string().min(1),
});

export const SqlAnalyticsInputSchema = z.object({
  description: z.string().min(1),
  query: z.string().min(1).refine(
    (q) => /^\s*select\s/i.test(q),
    { message: 'Only SELECT queries are allowed' }
  ),
});

export const SandboxInputSchema = z.object({
  code: z.string().min(1),
});

export const CalcFunctionInputSchema = z.object({
  calc_function: z
    .string()
    .min(1)
    .regex(/^\w+\.\w+$/),
  dataframe_mapping: z.record(z.string(), z.string()).refine(
    (m) => Object.keys(m).length > 0,
    { message: 'dataframe_mapping must have at least one entry' }
  ),
  data_file: z.string().optional(),
});

export const SearchInputSchema = z.object({
  query: z.string().min(1),
});

export const FieldCatalogInputSchema = z.object({
  skill_ids: z.array(z.string()).optional(),
});

export const ProjectOverviewInputSchema = z.object({}).passthrough();

export const CalcResultSchema = z.object({
  result: z.unknown(),
  formula: z.string(),
  intermediates: z.record(z.string(), z.unknown()).optional(),
  warnings: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
  data_coverage: z
    .record(
      z.string(),
      z.object({
        rows: z.number(),
        has_data: z.boolean(),
      })
    )
    .optional(),
  confidence: z.enum(['low', 'medium', 'high']),
});

export const TOOL_INPUT_SCHEMAS: Record<string, z.ZodType> = {
  get_context: GetContextInputSchema,
  execute_sql_analytics: SqlAnalyticsInputSchema,
  execute_analysis: SandboxInputSchema,
  execute_calc_function: CalcFunctionInputSchema,
  search_documents: SearchInputSchema,
  get_field_catalog: FieldCatalogInputSchema,
  project_overview: ProjectOverviewInputSchema,
};

export function validateToolInput(
  toolName: string,
  input: Record<string, unknown>
): { success: true; data: Record<string, unknown> } | { success: false; error: string } {
  const schema = TOOL_INPUT_SCHEMAS[toolName];
  if (!schema) return { success: true, data: input };

  const result = schema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data as Record<string, unknown> };
  }
  const issues = result.error.issues.map((i) => `${String(i.path.join('.'))}: ${i.message}`).join('; ');
  return { success: false, error: `Invalid input for ${toolName}: ${issues}` };
}
