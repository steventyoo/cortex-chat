import { z } from 'zod';
import { normalizeJsonObject, normalizeJsonArray, normalizeStringArray } from './helpers';

// ─── Chat Tool (chat_tools table) ───────────────────────────────────

export const ChatToolSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string(),
  tool_name: z.string(),
  display_name: z.string(),
  description: z.string().nullable().default(''),
  input_schema: normalizeJsonObject.transform(v => v ?? {}),
  implementation_type: z.string(),
  implementation_config: normalizeJsonObject.transform(v => v ?? {}),
  sample_prompts: normalizeJsonArray,
  is_active: z.coerce.boolean().default(true),
  created_by: z.string().nullable().default(null),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type ChatTool = z.infer<typeof ChatToolSchema>;

// ─── Chat Prompt Template (chat_prompt_templates table) ─────────────

export const ChatPromptTemplateSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string(),
  template_name: z.string(),
  trigger_description: z.string().nullable().default(null),
  trigger_keywords: normalizeStringArray.transform(v => v ?? []),
  system_instructions: z.string().nullable().default(null),
  response_format: z.string().nullable().default(null),
  sample_prompts: normalizeJsonArray,
  is_active: z.coerce.boolean().default(true),
  created_by: z.string().nullable().default(null),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type ChatPromptTemplate = z.infer<typeof ChatPromptTemplateSchema>;

// ─── Write Inputs ───────────────────────────────────────────────────

export const CreateChatToolInput = z.object({
  toolName: z.string().min(1, 'toolName is required'),
  displayName: z.string().min(1, 'displayName is required'),
  description: z.string().min(1, 'description is required'),
  inputSchema: z.record(z.string(), z.unknown()).optional().default({}),
  implementationType: z.string().min(1, 'implementationType is required'),
  implementationConfig: z.record(z.string(), z.unknown()).optional().default({}),
  samplePrompts: z.array(z.unknown()).optional().default([]),
});

export type CreateChatToolInput = z.infer<typeof CreateChatToolInput>;

export const UpdateChatToolInput = z.object({
  displayName: z.string().optional(),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  implementationType: z.string().optional(),
  implementationConfig: z.record(z.string(), z.unknown()).optional(),
  samplePrompts: z.array(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateChatToolInput = z.infer<typeof UpdateChatToolInput>;

export const CreateChatTemplateInput = z.object({
  templateName: z.string().min(1, 'templateName is required'),
  triggerDescription: z.string().min(1, 'triggerDescription is required'),
  triggerKeywords: z.array(z.string()).optional().default([]),
  systemInstructions: z.string().min(1, 'systemInstructions is required'),
  responseFormat: z.string().nullable().optional(),
  samplePrompts: z.array(z.unknown()).optional().default([]),
});

export type CreateChatTemplateInput = z.infer<typeof CreateChatTemplateInput>;

export const UpdateChatTemplateInput = z.object({
  templateName: z.string().optional(),
  triggerDescription: z.string().optional(),
  triggerKeywords: z.array(z.string()).optional(),
  systemInstructions: z.string().optional(),
  responseFormat: z.string().nullable().optional(),
  samplePrompts: z.array(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateChatTemplateInput = z.infer<typeof UpdateChatTemplateInput>;
