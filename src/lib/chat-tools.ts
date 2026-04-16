import { getSupabase } from './supabase';
import { searchByEmbedding, generateEmbedding } from './embeddings';
import { SandboxSession } from './sandbox';
import { validateToolInput, CalcResultSchema } from './tool-schemas';
import { getBaseUrl } from './base-url';
import {
  listActiveChatTools,
  listActiveChatTemplates,
} from './stores/chat-tools.store';
import {
  listActiveSkillSummaries,
} from './stores/skills.store';
import {
  getSkillFieldCatalogInfo,
  getFieldFrequency,
  getFieldMap,
} from './stores/field-catalog.store';

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
    | 'field_catalog'
    | 'calc_function'
    | 'reconciliation_check'
    | 'jcr_analysis';
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
  const data = await listActiveChatTools(orgId);
  return data as ChatTool[];
}

export async function fetchActiveTemplates(orgId: string): Promise<ChatPromptTemplate[]> {
  const data = await listActiveChatTemplates(orgId);
  return data as ChatPromptTemplate[];
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

  const [projectRes, profileRes, inventoryRes] = await Promise.all([
    sb.from('projects').select('*').eq('project_id', ctx.projectId).single(),
    sb.from('project_profiles')
      .select('*')
      .eq('org_id', ctx.orgId)
      .eq('project_id', ctx.projectId)
      .order('snapshot_date', { ascending: false })
      .limit(1),
    sb.from('pipeline_log')
      .select('id, extracted_data->skillId')
      .eq('project_id', ctx.projectId)
      .eq('org_id', ctx.orgId)
      .not('extracted_data', 'is', null),
  ]);

  const project = projectRes.data;
  const profile = profileRes.data?.[0] || null;

  const inventory: Record<string, number> = {};
  for (const row of (inventoryRes.data || [])) {
    const sk = String((row as Record<string, unknown>).skillId || 'unknown');
    inventory[sk] = (inventory[sk] || 0) + 1;
  }

  return {
    result: {
      project: project || null,
      profile: profile || null,
      document_inventory: inventory,
    },
  };
}

async function executeReconciliationCheck(
  _config: Record<string, unknown>,
  _input: Record<string, unknown>,
  ctx: ToolExecContext
): Promise<ToolExecResult> {
  if (!ctx.projectId) {
    return { result: null, error: 'No project selected' };
  }

  const { reconcileProject } = await import('./reconciliation');
  const run = await reconcileProject(ctx.projectId, ctx.orgId);

  const discrepancies = run.checks
    .filter(c => c.status === 'warning' || c.status === 'fail')
    .map(c => ({
      rule: c.ruleName,
      match_key: c.matchKeyValue,
      source_value: c.sourceValue,
      target_value: c.targetValue,
      difference_pct: c.differencePct,
      severity: c.status,
      message: c.message,
    }));

  return {
    result: {
      run_id: run.runId,
      summary: {
        total_checks: run.totalChecks,
        passed: run.passed,
        warnings: run.warnings,
        failures: run.failures,
        no_matches: run.noMatches,
      },
      discrepancies: discrepancies.slice(0, 20),
      elapsed_ms: run.elapsedMs,
    },
  };
}

/* ── Row normalization: unwrap {value, confidence} JSONB wrappers ── */

const MAX_PREVIEW_ROWS = 50;

function normalizeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(row)) {
      if (
        val !== null &&
        typeof val === 'object' &&
        !Array.isArray(val) &&
        'value' in (val as Record<string, unknown>)
      ) {
        out[key] = (val as Record<string, unknown>).value;
      } else if (typeof val === 'string') {
        try {
          const parsed = JSON.parse(val);
          if (parsed !== null && typeof parsed === 'object' && 'value' in parsed) {
            out[key] = parsed.value;
          } else {
            out[key] = val;
          }
        } catch {
          out[key] = val;
        }
      } else {
        out[key] = val;
      }
    }
    return out;
  });
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

  const rawRows = (data || []) as Record<string, unknown>[];
  const rows = normalizeRows(rawRows);

  if (ctx.sandboxSession && rows.length > 0) {
    try {
      await ctx.sandboxSession.writeData({ rows });
    } catch (err) {
      console.warn('[chat-tools] Failed to write data to sandbox:', err);
    }
  }

  const preview = rows.slice(0, MAX_PREVIEW_ROWS);
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return {
    result: {
      _summary: `${rows.length} row${rows.length !== 1 ? 's' : ''} returned${rows.length > MAX_PREVIEW_ROWS ? ` (showing first ${MAX_PREVIEW_ROWS})` : ''}`,
      _total_rows: rows.length,
      _columns: columns,
      rows: preview,
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

  if (!ctx.sandboxSession.hasData) {
    console.warn('[chat-tools] execute_analysis called before any SQL query — /tmp/data.json may be stale or missing');
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

/* ── NEW: Calc Function executor ──────────────────────────────── */

async function executeCalcFunction(
  _config: Record<string, unknown>,
  input: Record<string, unknown>,
  ctx: ToolExecContext
): Promise<ToolExecResult> {
  const calcFn = input.calc_function as string;
  const mapping = input.dataframe_mapping as Record<string, string>;
  const dataFile = (input.data_file as string) || '/tmp/data.json';

  if (!calcFn || !mapping) {
    return { result: null, error: 'calc_function and dataframe_mapping are required' };
  }

  if (!ctx.sandboxSession) {
    return { result: null, error: 'Sandbox session not available' };
  }

  if (!ctx.sandboxSession.hasData) {
    return {
      result: null,
      error: 'No data in sandbox. Run execute_sql_analytics first to load data before calling execute_calc_function.',
    };
  }

  const [moduleName, funcName] = calcFn.split('.');
  if (!moduleName || !funcName) {
    return { result: null, error: `Invalid calc_function format: "${calcFn}". Expected "module.function".` };
  }

  const dfSplits = Object.entries(mapping)
    .map(([param, skillId]) => `${param} = df[df['skill_id'] == '${skillId}']`)
    .join('\n');

  const kwargs = Object.keys(mapping)
    .map((param) => `${param}=${param}`)
    .join(', ');

  const code = `import sys, json, pandas as pd
sys.path.insert(0, '/tmp/cortex_calcs')
from ${moduleName} import ${funcName}

data = json.load(open('${dataFile}'))
df = pd.DataFrame(data['rows'])

${dfSplits}

result = ${funcName}(${kwargs})
print(json.dumps(result, indent=2, default=str))`;

  const runResult = await ctx.sandboxSession.run(code);

  if (runResult.exitCode !== 0) {
    return {
      result: {
        _summary: `Calc function error (exit ${runResult.exitCode})`,
        stdout: runResult.stdout,
        error: runResult.stderr,
      },
    };
  }

  let parsedResult: unknown;
  try {
    parsedResult = JSON.parse(runResult.stdout.trim());
  } catch {
    return {
      result: {
        _summary: 'Calc function completed (raw output)',
        stdout: runResult.stdout,
      },
    };
  }

  const validation = CalcResultSchema.safeParse(parsedResult);
  if (!validation.success) {
    console.warn('[chat-tools] Calc result failed schema validation:', validation.error.issues);
    return {
      result: {
        _summary: 'Calc function completed',
        ...(parsedResult as Record<string, unknown>),
      },
    };
  }

  const validated = validation.data;
  return {
    result: {
      _summary: `Calc complete (confidence: ${validated.confidence})`,
      ...validated,
    },
  };
}

/* ── NEW: Field Catalog executor ─────────────────────────────── */

async function executeFieldCatalog(
  _config: Record<string, unknown>,
  input: Record<string, unknown>,
  ctx: ToolExecContext
): Promise<ToolExecResult> {
  const skillIds = (input.skill_ids || []) as string[];

  const skills = await listActiveSkillSummaries(skillIds.length > 0 ? skillIds : undefined);

  const catalog = await Promise.all(skills.map(async (s: Record<string, unknown>) => {
    const skillId = s.skill_id as string;

    const fields = await getSkillFieldCatalogInfo(skillId);
    const actual_fields = await getFieldFrequency(ctx.orgId, skillId, ctx.includePending || false);

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

/**
 * Build a display-name lookup for a set of skills using the live field catalog.
 * Returns a map: canonical_name → current display name (display_override or catalog display_name).
 */
async function buildFieldNameLookup(
  skillIds: string[]
): Promise<Map<string, string>> {
  const fieldMap = await getFieldMap();
  const lookup = new Map<string, string>();

  for (const skillId of skillIds) {
    const mappings = fieldMap.get(skillId);
    if (!mappings) continue;
    for (const m of mappings) {
      const displayName = m.displayOverride || m.catalogDisplayName;
      lookup.set(m.canonicalName, displayName);
      lookup.set(displayName.toLowerCase(), displayName);
    }
  }

  return lookup;
}

/**
 * Resolve key_fields display names against the live field catalog.
 * For each skill in key_fields, try to match field names against the catalog
 * and replace with the current display name.
 */
function resolveKeyFields(
  keyFields: Record<string, string[]>,
  fieldMap: Map<string, { canonicalName: string; displayOverride: string | null; catalogDisplayName: string }[]>,
): Record<string, string[]> {
  const resolved: Record<string, string[]> = {};

  for (const [skillId, fields] of Object.entries(keyFields)) {
    const mappings = fieldMap.get(skillId);
    if (!mappings) {
      resolved[skillId] = fields;
      continue;
    }

    resolved[skillId] = fields.map(fieldName => {
      const mapping = mappings.find(m => {
        const displayName = m.displayOverride || m.catalogDisplayName;
        return displayName.toLowerCase() === fieldName.toLowerCase()
          || m.canonicalName === fieldName.toLowerCase().replace(/[^a-z0-9]/g, '_');
      });
      if (mapping) {
        return mapping.displayOverride || mapping.catalogDisplayName;
      }
      return fieldName;
    });
  }

  return resolved;
}

/**
 * Resolve field name references in SQL templates against the live field catalog.
 * Replaces `fields->'Old Display Name'` with `fields->'Current Display Name'`.
 */
function resolveSqlTemplates(
  sqlTemplates: Record<string, string>,
  fieldMap: Map<string, { canonicalName: string; displayOverride: string | null; catalogDisplayName: string }[]>,
  skillIds: string[],
): Record<string, string> {
  const allMappings: { canonicalName: string; displayOverride: string | null; catalogDisplayName: string }[] = [];
  for (const skillId of skillIds) {
    const mappings = fieldMap.get(skillId);
    if (mappings) allMappings.push(...mappings);
  }

  if (allMappings.length === 0) return sqlTemplates;

  const resolved: Record<string, string> = {};
  for (const [key, sql] of Object.entries(sqlTemplates)) {
    let resolvedSql = sql;

    for (const m of allMappings) {
      const currentDisplay = m.displayOverride || m.catalogDisplayName;
      const catalogDisplay = m.catalogDisplayName;

      if (currentDisplay !== catalogDisplay) {
        resolvedSql = resolvedSql.replace(
          new RegExp(`fields->'${escapeRegExp(catalogDisplay)}'`, 'g'),
          `fields->'${currentDisplay}'`,
        );
      }
    }

    resolved[key] = resolvedSql;
  }

  return resolved;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

    const rawCards = (data || []) as Record<string, unknown>[];

    const allSkillIds = new Set<string>();
    for (const c of rawCards) {
      const skills = (c.skills_involved || []) as string[];
      skills.forEach(s => allSkillIds.add(s));
    }

    const fieldMap = allSkillIds.size > 0 ? await getFieldMap() : new Map();

    const cards = rawCards.map((c) => {
      const skillsInvolved = (c.skills_involved || []) as string[];

      const keyFields = c.key_fields as Record<string, string[]> | null;
      const resolvedKeyFields = keyFields
        ? resolveKeyFields(keyFields, fieldMap)
        : keyFields;

      const sqlTemplates = c.sql_templates as Record<string, string> | null;
      const resolvedSqlTemplates = sqlTemplates
        ? resolveSqlTemplates(sqlTemplates, fieldMap, skillsInvolved)
        : sqlTemplates;

      return {
        card_name: c.card_name,
        display_name: c.display_name,
        description: c.description,
        skills_involved: skillsInvolved,
        business_logic: c.business_logic,
        key_fields: resolvedKeyFields,
        sql_templates: resolvedSqlTemplates,
        calc_function: c.calc_function,
        similarity: c.similarity,
      };
    });

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
    const baseUrl = getBaseUrl();

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

/* ── JCR Analysis ──────────────────────────────────────────── */

async function executeJcrAnalysis(
  _config: Record<string, unknown>,
  input: Record<string, unknown>,
  ctx: ToolExecContext,
): Promise<ToolExecResult> {
  const sb = getSupabase();
  const projectId = (input.projectId || ctx.projectId) as string | undefined;
  const tab = input.tab as string | undefined;
  const canonical = input.canonical_name as string | undefined;
  const section = input.section as string | undefined;
  const query = input.query as string | undefined;

  if (!projectId) {
    return { result: null, error: 'projectId is required' };
  }

  const hasFilter = !!(tab || canonical || section || query);

  if (!hasFilter) {
    const { data: indexRows, error: idxErr } = await sb
      .from('jcr_export')
      .select('tab, section, canonical_name, display_name, data_type, value_number, value_text')
      .eq('project_id', projectId)
      .order('tab')
      .order('section');

    if (idxErr) return { result: null, error: idxErr.message };

    const rows = indexRows || [];
    const index: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      if (!index[r.tab]) index[r.tab] = {};
      index[r.tab][r.section] = (index[r.tab][r.section] || 0) + 1;
    }

    return {
      result: {
        total_fields: rows.length,
        tabs: index,
        rows,
        hint: 'All fields returned. Filter by tab, section, or canonical_name for a focused view.',
      },
    };
  }

  let dbQuery = sb
    .from('jcr_export')
    .select('tab, section, record_key, canonical_name, display_name, data_type, status, value_text, value_number, notes')
    .eq('project_id', projectId);

  if (tab) dbQuery = dbQuery.eq('tab', tab);
  if (section) dbQuery = dbQuery.eq('section', section);
  if (canonical) dbQuery = dbQuery.eq('canonical_name', canonical);
  if (query) dbQuery = dbQuery.or(`canonical_name.ilike.%${query}%,display_name.ilike.%${query}%,value_text.ilike.%${query}%`);

  const { data, error } = await dbQuery.order('tab').order('section').limit(500);
  if (error) return { result: null, error: error.message };

  const summary: Record<string, number> = {};
  for (const row of data || []) {
    summary[row.tab] = (summary[row.tab] || 0) + 1;
  }

  return {
    result: {
      rows: data || [],
      count: data?.length || 0,
      tabs: summary,
    },
  };
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
    case 'calc_function': return executeCalcFunction(config, input, ctx);
    case 'reconciliation_check': return executeReconciliationCheck(config, input, ctx);
    case 'jcr_analysis': return executeJcrAnalysis(config, input, ctx);
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
  const validation = validateToolInput(tool.tool_name, input);
  if (!validation.success) {
    return { result: null, error: validation.error };
  }

  try {
    return await executeTool(tool.implementation_type, tool.implementation_config, validation.data, ctx);
  } catch (err) {
    console.error(`[chat-tools] Tool "${tool.tool_name}" failed:`, err);
    return { result: null, error: String(err) };
  }
}
