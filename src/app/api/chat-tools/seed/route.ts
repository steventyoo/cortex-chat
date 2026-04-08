import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

const DEFAULT_TOOLS = [
  {
    tool_name: 'query_job_costs',
    display_name: 'Query Job Costs',
    description: 'Look up job cost line items by cost code, description, or vendor. Returns matching job cost records for the current project.',
    input_schema: {
      properties: {
        search_term: { type: 'string', description: 'Cost code, description, or vendor name to search for' },
        cost_type: { type: 'string', description: 'Optional: filter by cost type (labor, material, equipment, subcontract, other)' },
      },
      required: ['search_term'],
    },
    implementation_type: 'sql_query',
    implementation_config: {
      table: 'pipeline_log',
      select: 'id,project_id,skill_id,extracted_fields,source_file,created_at',
      limit: 30,
      params_mapping: { search_term: 'source_file' },
    },
    sample_prompts: [
      'What are the costs for electrical work?',
      'Show me the job costs for cost code 03',
      'How much have we spent on concrete?',
    ],
  },
  {
    tool_name: 'query_change_orders',
    display_name: 'Query Change Orders',
    description: 'Find change orders by status, amount, description, or reason. Returns matching change order records for the current project.',
    input_schema: {
      properties: {
        search_term: { type: 'string', description: 'Description, reason, or status to search for' },
        status: { type: 'string', description: 'Optional: filter by status (pending, approved, rejected)' },
      },
      required: ['search_term'],
    },
    implementation_type: 'sql_query',
    implementation_config: {
      table: 'pipeline_log',
      select: 'id,project_id,skill_id,extracted_fields,source_file,created_at',
      limit: 30,
      params_mapping: { search_term: 'source_file' },
    },
    sample_prompts: [
      'Show me all pending change orders',
      'What change orders are over $50,000?',
      'List the approved COs this month',
    ],
  },
  {
    tool_name: 'search_documents',
    display_name: 'Search Documents',
    description: 'Search extracted document records by semantic similarity. Finds documents matching a natural language query across all processed documents.',
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
    tool_name: 'project_health',
    display_name: 'Project Health',
    description: 'Get project health metrics including budget status, schedule, and key indicators. Provides an at-a-glance view of project health.',
    input_schema: {
      properties: {
        metric: { type: 'string', description: 'Optional: specific metric to focus on (budget, schedule, safety, quality)' },
      },
      required: [],
    },
    implementation_type: 'api_call',
    implementation_config: {
      endpoint: '/api/dashboard',
      method: 'POST',
    },
    sample_prompts: [
      'How is the project doing?',
      'What is the project health status?',
      'Are we over budget?',
    ],
  },
  {
    tool_name: 'coverage_analysis',
    display_name: 'Coverage Analysis',
    description: 'Run JCR coverage analysis to check how well project documents cover the Job Cost Report line items. Shows which cost codes have supporting documentation.',
    input_schema: {
      properties: {
        focus_area: { type: 'string', description: 'Optional: specific cost area or division to focus the analysis on' },
      },
      required: [],
    },
    implementation_type: 'api_call',
    implementation_config: {
      endpoint: '/api/pipeline/coverage',
      method: 'POST',
    },
    sample_prompts: [
      'Run a coverage analysis',
      'Which cost codes are missing documentation?',
      'How complete is the document coverage?',
    ],
  },
];

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
  const toInsert = DEFAULT_TOOLS.filter(t => !existingNames.has(t.tool_name));

  if (toInsert.length === 0) {
    return Response.json({ message: 'All default tools already exist', seeded: 0 });
  }

  const rows = toInsert.map(t => ({
    org_id: orgId,
    ...t,
    created_by: session.userId,
  }));

  const { error } = await sb.from('chat_tools').insert(rows);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ message: `Seeded ${toInsert.length} default tools`, seeded: toInsert.length });
}
