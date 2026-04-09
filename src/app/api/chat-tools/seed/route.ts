import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

const CORE_TOOLS = [
  {
    tool_name: 'get_context',
    display_name: 'Get Context',
    description: 'Retrieve business logic and domain knowledge relevant to the user\'s question. Returns context cards that explain how to interpret data, what fields matter, and how to chain queries for complex analysis. ALWAYS call this first for data questions.',
    input_schema: {
      properties: {
        question: { type: 'string', description: 'The user\'s question or topic to find relevant business context for' },
      },
      required: ['question'],
    },
    implementation_type: 'context_retrieval',
    implementation_config: {},
    sample_prompts: [
      'What is unbilled CO recovery?',
      'How do I analyze bid accuracy?',
      'What metrics matter for subcontractor benchmarking?',
    ],
  },
  {
    tool_name: 'get_field_catalog',
    display_name: 'Field Catalog',
    description: 'Get the field definitions (schema) for one or more document skill types. Returns field names, types, and descriptions. Use this to understand what data is available before writing SQL queries.',
    input_schema: {
      properties: {
        skill_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of skill_ids to get field definitions for (e.g. ["estimate", "sub_bid", "change_order"]). Leave empty to get all active skills.',
        },
      },
      required: [],
    },
    implementation_type: 'field_catalog',
    implementation_config: {},
    sample_prompts: [
      'What fields are in estimate records?',
      'Show me the schema for change orders and sub bids',
      'What data do we extract from daily reports?',
    ],
  },
  {
    tool_name: 'execute_sql_analytics',
    display_name: 'SQL Analytics',
    description: 'Run a read-only SQL SELECT query against the extracted_records table. Use for counting, grouping, aggregating, joining, and filtering document data. The org_id filter is auto-applied. Returns JSON rows. ALWAYS use this for data aggregation — never count or sum records yourself.',
    input_schema: {
      properties: {
        query: {
          type: 'string',
          description: 'A SELECT SQL query. Table: extracted_records (columns: id, org_id, project_id, skill_id, document_type, source_file, overall_confidence, status, fields JSONB, created_at). Access JSONB: fields->\'field_name\'->>\'value\'. Cast numbers: (fields->\'amount\'->>\'value\')::numeric. org_id is auto-injected. Use {{project_id}} for project filtering.',
        },
      },
      required: ['query'],
    },
    implementation_type: 'sql_analytics',
    implementation_config: {},
    sample_prompts: [
      'How many submittals by status?',
      'Total bid amounts by vendor',
      'Count change orders grouped by status',
      'What is the average estimate value?',
    ],
  },
  {
    tool_name: 'execute_analysis',
    display_name: 'Data Analysis & Visualization',
    description: 'Run Python code in a persistent sandbox to analyze data and optionally generate interactive HTML visualizations. Data from execute_sql_analytics is automatically available at /tmp/data.json. Available libraries: pandas, numpy, plotly, json, math, collections. Print analysis findings to stdout. Write interactive HTML charts/tables to /tmp/output.html. The sandbox persists across calls — you can inspect results, fix errors, and build on previous work.',
    input_schema: {
      properties: {
        code: {
          type: 'string',
          description: 'Python code to execute. Data from prior SQL queries is at /tmp/data.json. Print findings to stdout. Write HTML to /tmp/output.html for interactive charts. Files in /tmp/ persist between calls.',
        },
      },
      required: ['code'],
    },
    implementation_type: 'sandbox',
    implementation_config: {},
    sample_prompts: [
      'Generate a chart comparing vendor pricing',
      'Calculate bid-to-actual variance statistics',
      'Create a visualization of change order trends',
    ],
  },
  {
    tool_name: 'search_documents',
    display_name: 'Search Documents',
    description: 'Search extracted document records by semantic similarity. Use for finding specific documents matching a natural language query. Best for "find documents about X" questions. For aggregations, use execute_sql_analytics instead.',
    input_schema: {
      properties: {
        query: { type: 'string', description: 'Natural language search query describing what documents to find' },
      },
      required: ['query'],
    },
    implementation_type: 'rag_search',
    implementation_config: {
      similarity_threshold: 0.4,
      match_count: 10,
    },
    sample_prompts: [
      'Find documents about the HVAC system',
      'Search for anything related to foundation work',
      'What documents mention weather delays?',
    ],
  },
  {
    tool_name: 'project_overview',
    display_name: 'Project Overview',
    description: 'Get project metadata (name, address, trade, status, contract value) and a count of all document records by type. Use this when the user asks general questions about a project or wants to know what data is available.',
    input_schema: {
      properties: {},
      required: [],
    },
    implementation_type: 'project_overview',
    implementation_config: {},
    sample_prompts: [
      'Tell me about this project',
      'What data do we have?',
      'Project overview',
    ],
  },
];

const ALL_SEED_TOOLS = CORE_TOOLS;

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !['owner', 'admin'].includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (session as SessionPayload).orgId;
  const sb = getSupabase();

  const { data: existing } = await sb
    .from('chat_tools')
    .select('tool_name')
    .eq('org_id', orgId);

  const existingNames = new Set((existing || []).map((t: { tool_name: string }) => t.tool_name));
  const coreToolNames = new Set(ALL_SEED_TOOLS.map(t => t.tool_name));

  const toInsert = ALL_SEED_TOOLS.filter(t => !existingNames.has(t.tool_name));
  const toUpdate = ALL_SEED_TOOLS.filter(t => existingNames.has(t.tool_name));

  const toDeactivate = [...existingNames].filter(name => !coreToolNames.has(name));

  let inserted = 0;
  let updated = 0;
  let deactivated = 0;

  if (toInsert.length > 0) {
    const rows = toInsert.map(t => ({
      org_id: orgId,
      ...t,
      created_by: session.userId,
    }));
    const { error } = await sb.from('chat_tools').insert(rows);
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    inserted = toInsert.length;
  }

  for (const t of toUpdate) {
    const { error } = await sb
      .from('chat_tools')
      .update({
        display_name: t.display_name,
        description: t.description,
        input_schema: t.input_schema,
        implementation_type: t.implementation_type,
        implementation_config: t.implementation_config,
        sample_prompts: t.sample_prompts,
      })
      .eq('org_id', orgId)
      .eq('tool_name', t.tool_name);
    if (error) {
      return Response.json({ error: `Failed to update ${t.tool_name}: ${error.message}` }, { status: 500 });
    }
    updated++;
  }

  if (toDeactivate.length > 0) {
    const { error } = await sb
      .from('chat_tools')
      .update({ is_active: false })
      .eq('org_id', orgId)
      .in('tool_name', toDeactivate);
    if (error) {
      console.error('Failed to deactivate old tools:', error.message);
    } else {
      deactivated = toDeactivate.length;
    }
  }

  return Response.json({
    message: `Seeded ${inserted} new, updated ${updated} existing, deactivated ${deactivated} legacy tools`,
    seeded: inserted,
    updated,
    deactivated,
  });
}
