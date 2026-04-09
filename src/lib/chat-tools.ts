import { getSupabase } from './supabase';
import { searchByEmbedding, generateEmbedding } from './embeddings';
import { SandboxSession } from './sandbox';

export interface ChatTool {
  id: string;
  org_id: string;
  tool_name: string;
  display_name: string;
  description: string;
  input_schema: Record<string, unknown>;
  implementation_type:
    | 'sql_query'
    | 'rag_search'
    | 'api_call'
    | 'composite'
    | 'skill_scan'
    | 'project_overview'
    | 'sql_analytics'
    | 'sandbox'
    | 'context_retrieval'
    | 'field_catalog';
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
  sandboxSession?: SandboxSession;
}

export interface ToolExecResult {
  result: unknown;
  error?: string;
  htmlArtifact?: string;
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

/* ── Legacy executors (kept for backward compat) ─────────────── */

async function executeSqlQuery(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  ctx: ToolExecContext
): Promise<ToolExecResult> {
  const tableName = config.table as string;
  const selectCols = (config.select as string) || '*';
  const paramsMapping = (config.params_mapping || {}) as Record<string, string>;

  if (!tableName) {
    return { result: null, error: 'sql_query requires a "table" in implementation_config' };
  }

  const sb = getSupabase();
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

async function executeRagSearch(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  ctx: ToolExecContext
): Promise<ToolExecResult> {
  const query = (input.query || input.search_query || input.text) as string;
  if (!query) {
    return { result: null, error: 'No query/search_query/text field in tool input' };
  }

  const matchCount = Number(config.match_count) || 10;
  const matchThreshold = Number(config.similarity_threshold) || 0.4;
  const skillIds = config.skill_ids as string[] | undefined;
  const singleSkillId = config.skill_id as string | undefined;

  try {
    let allResults: Array<{
      id: string;
      skill_id: string;
      document_type: string;
      fields: Record<string, unknown>;
      similarity: number;
      project_id: string;
      source_file?: string;
      overall_confidence?: number;
      status?: string;
    }>;

    if (skillIds && skillIds.length > 0) {
      const perSkillResults = await Promise.all(
        skillIds.map(sid =>
          searchByEmbedding({
            query,
            orgId: ctx.orgId,
            projectId: ctx.projectId,
            skillId: sid,
            matchCount,
            matchThreshold,
            includePending: ctx.includePending,
          })
        )
      );
      const flat = perSkillResults.flat();
      const seen = new Set<string>();
      const deduped = flat.filter(r => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });
      deduped.sort((a, b) => b.similarity - a.similarity);
      allResults = deduped.slice(0, matchCount);
    } else {
      allResults = await searchByEmbedding({
        query,
        orgId: ctx.orgId,
        projectId: ctx.projectId,
        skillId: singleSkillId,
        matchCount,
        matchThreshold,
        includePending: ctx.includePending,
      });
    }

    const sb = getSupabase();
    const targetSkills = skillIds || (singleSkillId ? [singleSkillId] : null);
    let totalCount: number | null = null;

    if (targetSkills && targetSkills.length > 0 && ctx.projectId) {
      let countQuery = sb
        .from('extracted_records')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', ctx.projectId)
        .eq('org_id', ctx.orgId)
        .not('embedding', 'is', null)
        .in('skill_id', targetSkills);

      if (!ctx.includePending) {
        countQuery = countQuery.in('status', ['approved', 'pushed']);
      }

      const { count } = await countQuery;
      totalCount = count;
    }

    const formatted = allResults.map(r => ({
      document_type: r.document_type,
      skill_id: r.skill_id,
      similarity: r.similarity,
      source_file: r.source_file || null,
      overall_confidence: r.overall_confidence ?? null,
      status: r.status || null,
      fields: r.fields,
    }));

    const summary = totalCount !== null
      ? `Showing ${formatted.length} of ${totalCount} total records (similarity > ${matchThreshold})`
      : `Found ${formatted.length} records (similarity > ${matchThreshold})`;

    return { result: { _summary: summary, records: formatted } };
  } catch (err) {
    return { result: null, error: String(err) };
  }
}

async function executeSkillScan(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  ctx: ToolExecContext
): Promise<ToolExecResult> {
  const skillId = (config.skill_id || input.skill_id) as string;
  if (!skillId) {
    return { result: null, error: 'skill_scan requires a skill_id' };
  }

  const limit = Number(config.limit) || 200;
  const sb = getSupabase();

  let query = sb
    .from('extracted_records')
    .select('id, skill_id, document_type, fields, source_file, overall_confidence, status, project_id, created_at')
    .eq('org_id', ctx.orgId)
    .eq('skill_id', skillId);

  if (ctx.projectId) {
    query = query.eq('project_id', ctx.projectId);
  }

  if (!ctx.includePending) {
    query = query.in('status', ['approved', 'pushed']);
  }

  query = query.order('created_at', { ascending: false }).limit(limit);

  const { data, error } = await query;
  if (error) return { result: null, error: error.message };

  let countQuery = sb
    .from('extracted_records')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', ctx.orgId)
    .eq('skill_id', skillId);

  if (ctx.projectId) {
    countQuery = countQuery.eq('project_id', ctx.projectId);
  }

  if (!ctx.includePending) {
    countQuery = countQuery.in('status', ['approved', 'pushed']);
  }

  const { count: totalCount } = await countQuery;

  const records = (data || []).map((r: Record<string, unknown>) => ({
    document_type: r.document_type,
    skill_id: r.skill_id,
    source_file: r.source_file || null,
    overall_confidence: r.overall_confidence ?? null,
    status: r.status || null,
    fields: r.fields,
  }));

  const summary = `All ${records.length}${totalCount && totalCount > records.length ? ` of ${totalCount}` : ''} ${skillId} records`;

  return { result: { _summary: summary, records } };
}

async function executeProjectOverview(
  _config: Record<string, unknown>,
  _input: Record<string, unknown>,
  ctx: ToolExecContext
): Promise<ToolExecResult> {
  if (!ctx.projectId) {
    return { result: null, error: 'No project selected' };
  }

  const sb = getSupabase();

  const [projectRes, inventoryRes] = await Promise.all([
    sb.from('projects').select('*').eq('project_id', ctx.projectId).single(),
    sb.from('extracted_records')
      .select('skill_id')
      .eq('project_id', ctx.projectId)
      .eq('org_id', ctx.orgId),
  ]);

  const project = projectRes.data;
  const inventory: Record<string, number> = {};
  for (const row of (inventoryRes.data || [])) {
    const sk = String((row as Record<string, unknown>).skill_id || 'unknown');
    inventory[sk] = (inventory[sk] || 0) + 1;
  }

  return {
    result: {
      project: project ? {
        project_id: project.project_id,
        project_name: project.project_name,
        address: project.address,
        trade: project.trade,
        project_status: project.project_status,
        contract_value: project.contract_value,
        job_to_date: project.job_to_date,
        percent_complete: project.percent_complete_cost,
        total_cos: project.total_cos,
      } : null,
      document_inventory: inventory,
    },
  };
}

/* ── NEW: SQL Analytics executor ─────────────────────────────── */

async function executeSqlAnalytics(
  _config: Record<string, unknown>,
  input: Record<string, unknown>,
  ctx: ToolExecContext
): Promise<ToolExecResult> {
  const query = (input.query || input.sql) as string;
  if (!query) return { result: null, error: 'No query provided' };

  const sb = getSupabase();
  const { data, error } = await sb.rpc('execute_readonly_query', {
    sql_query: query,
    p_org_id: ctx.orgId,
    p_project_id: ctx.projectId || null,
  });

  if (error) return { result: null, error: error.message };

  const rows = (data || []) as Record<string, unknown>[];

  // Side effect: make SQL results available in the sandbox at /tmp/data.json
  if (ctx.sandboxSession && rows.length > 0) {
    try {
      await ctx.sandboxSession.writeData({ rows });
    } catch (err) {
      console.warn('[chat-tools] Failed to write data to sandbox:', err);
    }
  }

  return {
    result: {
      _summary: `${rows.length} row${rows.length !== 1 ? 's' : ''} returned`,
      rows,
    },
  };
}

/* ── NEW: Sandbox code executor (session-scoped) ─────────────── */

async function executeSandboxCode(
  _config: Record<string, unknown>,
  input: Record<string, unknown>,
  ctx: ToolExecContext
): Promise<ToolExecResult> {
  const code = input.code as string;
  if (!code) return { result: null, error: 'No code provided' };

  if (!ctx.sandboxSession) {
    return { result: null, error: 'Sandbox session not available' };
  }

  const runResult = await ctx.sandboxSession.run(code);

  if (runResult.exitCode !== 0) {
    return {
      result: {
        _summary: `Error (exit ${runResult.exitCode})`,
        stdout: runResult.stdout,
        error: runResult.stderr,
      },
      htmlArtifact: runResult.htmlArtifact || undefined,
    };
  }

  return {
    result: {
      _summary: runResult.htmlArtifact
        ? 'Analysis complete (with visualization)'
        : 'Analysis complete',
      stdout: runResult.stdout,
    },
    htmlArtifact: runResult.htmlArtifact || undefined,
  };
}

/* ── NEW: Field Catalog executor ─────────────────────────────── */

interface FieldDef {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  importance?: string;
}

async function executeFieldCatalog(
  _config: Record<string, unknown>,
  input: Record<string, unknown>,
  ctx: ToolExecContext
): Promise<ToolExecResult> {
  const skillIds = (input.skill_ids || []) as string[];
  const sb = getSupabase();

  let query = sb
    .from('document_skills')
    .select('skill_id, display_name, field_definitions, classifier_hints')
    .eq('status', 'active');

  if (skillIds.length > 0) {
    query = query.in('skill_id', skillIds);
  }

  const { data, error } = await query;
  if (error) return { result: null, error: error.message };

  const skills = (data || []) as Record<string, unknown>[];

  const catalog = await Promise.all(skills.map(async (s) => {
    const skillId = s.skill_id as string;
    const fields = ((s.field_definitions || []) as FieldDef[]).map((f: FieldDef) => ({
      name: f.name,
      type: f.type,
      description: f.description || '',
      required: f.required || false,
      importance: f.importance || 'S',
    }));

    let actual_fields: { field_name: string; record_count: number; sample_value: string }[] = [];
    try {
      const { data: freqData } = await sb.rpc('get_field_frequency', {
        p_org_id: ctx.orgId,
        p_skill_id: skillId,
        p_include_pending: ctx.includePending || false,
      });
      if (freqData) {
        actual_fields = (freqData as { field_name: string; record_count: number; sample_value: string }[])
          .slice(0, 30);
      }
    } catch {
      // RPC may not exist yet — degrade gracefully
    }

    return {
      skill_id: skillId,
      display_name: s.display_name,
      description: (s.classifier_hints as Record<string, unknown>)?.description || '',
      fields,
      actual_fields,
    };
  }));

  return {
    result: {
      _summary: `${catalog.length} skill schema${catalog.length !== 1 ? 's' : ''} (with field importance and live frequency)`,
      catalog,
    },
  };
}

/* ── NEW: Context Retrieval executor ─────────────────────────── */

async function executeContextRetrieval(
  _config: Record<string, unknown>,
  input: Record<string, unknown>,
  ctx: ToolExecContext
): Promise<ToolExecResult> {
  const question = (input.question || input.query) as string;
  if (!question) return { result: null, error: 'No question provided' };

  if (!process.env.OPENAI_API_KEY) {
    return { result: null, error: 'OPENAI_API_KEY not configured for context search' };
  }

  try {
    const queryEmbedding = await generateEmbedding(question);
    const sb = getSupabase();

    const { data, error } = await sb.rpc('match_context_cards', {
      query_embedding: `[${queryEmbedding.join(',')}]`,
      filter_org_id: ctx.orgId,
      match_count: 3,
      match_threshold: 0.3,
    });

    if (error) return { result: null, error: error.message };

    const cards = (data || []).map((c: Record<string, unknown>) => ({
      card_name: c.card_name,
      display_name: c.display_name,
      description: c.description,
      skills_involved: c.skills_involved,
      business_logic: c.business_logic,
      key_fields: c.key_fields,
      similarity: c.similarity,
    }));

    return {
      result: {
        _summary: `${cards.length} context card${cards.length !== 1 ? 's' : ''} matched`,
        cards,
      },
    };
  } catch (err) {
    return { result: null, error: String(err) };
  }
}

/* ── Legacy executors ────────────────────────────────────────── */

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

/* ── Main dispatcher ─────────────────────────────────────────── */

async function executeTool(
  type: string,
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  ctx: ToolExecContext
): Promise<ToolExecResult> {
  switch (type) {
    case 'sql_query': return executeSqlQuery(config, input, ctx);
    case 'rag_search': return executeRagSearch(config, input, ctx);
    case 'skill_scan': return executeSkillScan(config, input, ctx);
    case 'project_overview': return executeProjectOverview(config, input, ctx);
    case 'sql_analytics': return executeSqlAnalytics(config, input, ctx);
    case 'sandbox': return executeSandboxCode(config, input, ctx);
    case 'field_catalog': return executeFieldCatalog(config, input, ctx);
    case 'context_retrieval': return executeContextRetrieval(config, input, ctx);
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
