import { getSupabase } from './supabase';
import { searchByEmbedding } from './embeddings';

export interface ChatTool {
  id: string;
  org_id: string;
  tool_name: string;
  display_name: string;
  description: string;
  input_schema: Record<string, unknown>;
  implementation_type: 'sql_query' | 'rag_search' | 'api_call' | 'composite';
  implementation_config: Record<string, unknown>;
  sample_prompts: string[];
  is_active: boolean;
}

export interface ChatPromptTemplate {
  id: string;
  org_id: string;
  template_name: string;
  trigger_description: string;
  trigger_keywords: string[];
  system_instructions: string;
  response_format: string | null;
  sample_prompts: string[];
  reference_doc_ids: string[];
  is_active: boolean;
}

export interface ToolExecContext {
  orgId: string;
  projectId?: string;
  includePending?: boolean;
}

export interface ToolExecResult {
  result: unknown;
  error?: string;
}

export async function fetchActiveTools(orgId: string): Promise<ChatTool[]> {
  const sb = getSupabase();
  const { data } = await sb
    .from('chat_tools')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', true);
  return (data || []) as ChatTool[];
}

export async function fetchActiveTemplates(orgId: string): Promise<ChatPromptTemplate[]> {
  const sb = getSupabase();
  const { data } = await sb
    .from('chat_prompt_templates')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', true);
  return (data || []) as ChatPromptTemplate[];
}

export function matchTemplates(templates: ChatPromptTemplate[], userMessage: string): ChatPromptTemplate[] {
  const lower = userMessage.toLowerCase();
  return templates.filter(t =>
    t.trigger_keywords.some(kw => lower.includes(kw.toLowerCase()))
  );
}

export function toolToAnthropicDef(tool: ChatTool) {
  return {
    name: tool.tool_name,
    description: tool.description,
    input_schema: {
      type: 'object' as const,
      ...tool.input_schema,
    },
  };
}

async function executeSqlQuery(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  ctx: ToolExecContext
): Promise<ToolExecResult> {
  const queryTemplate = config.query_template as string;
  const paramsMapping = (config.params_mapping || {}) as Record<string, string>;

  if (!queryTemplate) {
    return { result: null, error: 'No query_template in implementation_config' };
  }

  const sb = getSupabase();
  const tableName = config.table as string;
  const selectCols = (config.select as string) || '*';

  if (tableName) {
    let query = sb.from(tableName).select(selectCols).eq('org_id', ctx.orgId);

    if (ctx.projectId) {
      query = query.eq('project_id', ctx.projectId);
    }

    for (const [inputKey, columnName] of Object.entries(paramsMapping)) {
      const val = input[inputKey];
      if (val !== undefined && val !== null && val !== '') {
        query = query.ilike(columnName as string, `%${String(val)}%`);
      }
    }

    const limit = Number(config.limit) || 50;
    query = query.limit(limit);

    const { data, error } = await query;
    if (error) return { result: null, error: error.message };
    return { result: data };
  }

  return { result: null, error: 'sql_query requires a "table" in implementation_config' };
}

async function executeRagSearch(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  ctx: ToolExecContext
): Promise<ToolExecResult> {
  const query = (input.query || input.search_query || input.text) as string;
  if (!query) {
    return { result: null, error: 'No query/search_query/text field in tool input' };
  }

  try {
    const results = await searchByEmbedding({
      query,
      orgId: ctx.orgId,
      projectId: ctx.projectId,
      skillId: config.skill_id as string | undefined,
      matchCount: Number(config.match_count) || 10,
      matchThreshold: Number(config.similarity_threshold) || 0.4,
      includePending: ctx.includePending,
    });

    const formatted = results.map(r => ({
      document_type: r.document_type,
      skill_id: r.skill_id,
      similarity: r.similarity,
      fields: r.fields,
    }));

    return { result: formatted };
  } catch (err) {
    return { result: null, error: String(err) };
  }
}

async function executeApiCall(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  ctx: ToolExecContext
): Promise<ToolExecResult> {
  const endpoint = config.endpoint as string;
  const method = ((config.method as string) || 'POST').toUpperCase();

  if (!endpoint) {
    return { result: null, error: 'No endpoint in implementation_config' };
  }

  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

    const url = `${baseUrl}${endpoint}`;
    const fetchOpts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    if (method !== 'GET') {
      fetchOpts.body = JSON.stringify({ ...input, orgId: ctx.orgId, projectId: ctx.projectId });
    }

    const res = await fetch(url, fetchOpts);
    const data = await res.json();
    return { result: data };
  } catch (err) {
    return { result: null, error: String(err) };
  }
}

async function executeComposite(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  ctx: ToolExecContext
): Promise<ToolExecResult> {
  const steps = (config.steps || []) as Array<{ type: string; config: Record<string, unknown> }>;
  let currentInput = input;

  for (const step of steps) {
    const stepResult = await executeTool(step.type, step.config, currentInput, ctx);
    if (stepResult.error) return stepResult;
    currentInput = typeof stepResult.result === 'object' && stepResult.result !== null
      ? stepResult.result as Record<string, unknown>
      : { result: stepResult.result };
  }

  return { result: currentInput };
}

async function executeTool(
  type: string,
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  ctx: ToolExecContext
): Promise<ToolExecResult> {
  switch (type) {
    case 'sql_query': return executeSqlQuery(config, input, ctx);
    case 'rag_search': return executeRagSearch(config, input, ctx);
    case 'api_call': return executeApiCall(config, input, ctx);
    case 'composite': return executeComposite(config, input, ctx);
    default: return { result: null, error: `Unknown implementation type: ${type}` };
  }
}

export async function executeChatTool(
  tool: ChatTool,
  input: Record<string, unknown>,
  ctx: ToolExecContext
): Promise<ToolExecResult> {
  try {
    return await executeTool(tool.implementation_type, tool.implementation_config, input, ctx);
  } catch (err) {
    console.error(`[chat-tools] Tool "${tool.tool_name}" failed:`, err);
    return { result: null, error: String(err) };
  }
}
