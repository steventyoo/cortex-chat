import { getSupabase } from '@/lib/supabase';

// ─── Reads ──────────────────────────────────────────────────────────

export async function listChatTools(orgId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('chat_tools')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getChatToolById(toolId: string, orgId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('chat_tools')
    .select('*')
    .eq('id', toolId)
    .eq('org_id', orgId)
    .single();
  if (error) throw error;
  return data;
}

export async function listChatTemplates(orgId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('chat_prompt_templates')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getChatTemplateById(templateId: string, orgId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('chat_prompt_templates')
    .select('*')
    .eq('id', templateId)
    .eq('org_id', orgId)
    .single();
  if (error) throw error;
  return data;
}

// ─── Writes ─────────────────────────────────────────────────────────

export async function insertChatTool(row: {
  org_id: string;
  tool_name: string;
  display_name: string;
  description: string;
  input_schema: Record<string, unknown>;
  implementation_type: string;
  implementation_config: Record<string, unknown>;
  sample_prompts: unknown[];
  created_by: string;
}) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('chat_tools')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateChatTool(
  toolId: string,
  orgId: string,
  updates: Record<string, unknown>,
) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('chat_tools')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', toolId)
    .eq('org_id', orgId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteChatTool(toolId: string, orgId: string) {
  const sb = getSupabase();
  const { error } = await sb
    .from('chat_tools')
    .delete()
    .eq('id', toolId)
    .eq('org_id', orgId);
  if (error) throw error;
}

export async function insertChatTemplate(row: {
  org_id: string;
  template_name: string;
  trigger_description: string;
  trigger_keywords: string[];
  system_instructions: string;
  response_format: string | null;
  sample_prompts: unknown[];
  created_by: string;
}) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('chat_prompt_templates')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateChatTemplate(
  templateId: string,
  orgId: string,
  updates: Record<string, unknown>,
) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('chat_prompt_templates')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', templateId)
    .eq('org_id', orgId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteChatTemplate(templateId: string, orgId: string) {
  const sb = getSupabase();
  const { error } = await sb
    .from('chat_prompt_templates')
    .delete()
    .eq('id', templateId)
    .eq('org_id', orgId);
  if (error) throw error;
}
