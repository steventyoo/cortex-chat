import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { fetchAllProjectData, fetchProjectList, fetchProjectHealthData, resolveProjectId, verifyProjectAccess } from '@/lib/supabase';
import { CORTEX_SYSTEM_PROMPT, assembleContext, assemblePortfolioContext } from '@/lib/prompts';
import { streamChatWithTools, ChatEvent } from '@/lib/claude';
import { ChatMessage, SourceRef } from '@/lib/types';
import { searchByEmbedding } from '@/lib/embeddings';
import { getLangfuse } from '@/lib/langfuse';
import {
  fetchActiveTools,
  fetchActiveTemplates,
  matchTemplates,
  toolToAnthropicDef,
  executeChatTool,
  ChatTool,
} from '@/lib/chat-tools';

export const maxDuration = 60;

function buildSourceRegistry(
  recordCounts: Record<string, number>,
  ragResults: Array<{ id: string; document_type: string; skill_id: string; similarity: number; source_file?: string }>
): SourceRef[] {
  const sources: SourceRef[] = [];
  let sIdx = 1;
  let vIdx = 1;

  const tableLabels: Record<string, string> = {
    changeOrders: 'change_orders',
    jobCosts: 'job_costs',
    production: 'production',
    designChanges: 'design_changes',
    documentLinks: 'document_links',
    documents: 'documents',
    staffing: 'staffing',
  };

  for (const [key, table] of Object.entries(tableLabels)) {
    const count = recordCounts[key] || 0;
    if (count > 0) {
      sources.push({
        tag: `S${sIdx++}`,
        type: 'structured',
        label: `${table} (${count} record${count !== 1 ? 's' : ''})`,
        table,
      });
    }
  }

  for (const r of ragResults) {
    sources.push({
      tag: `V${vIdx++}`,
      type: 'extracted',
      label: r.source_file
        ? `${r.source_file} (${(r.similarity * 100).toFixed(0)}% match)`
        : `${r.document_type} — ${r.skill_id} (${(r.similarity * 100).toFixed(0)}% match)`,
      similarity: r.similarity,
      sourceFile: r.source_file,
    });
  }

  return sources;
}

function buildSourceLegend(sources: SourceRef[]): string {
  if (sources.length === 0) return '';
  const lines = sources.map((s) => `${s.tag}: ${s.label}`);
  return `When citing data, use inline tags like [S1] or [V1] after the relevant fact.\n${lines.join('\n')}`;
}

export async function POST(request: NextRequest) {
  const langfuse = getLangfuse();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const session = await validateUserSession(token);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const orgId = session.orgId;

  let message: string;
  let projectId: string | null;
  let history: ChatMessage[];
  let conversationId: string | undefined;
  let includePending = true;

  try {
    const body = await request.json();
    message = body.message;
    projectId = body.projectId || null;
    history = body.history || [];
    conversationId = body.conversationId || undefined;
    if (body.includePending !== undefined) {
      includePending = body.includePending !== false;
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const trace = langfuse.trace({
    name: 'chat',
    userId: session.userId,
    sessionId: conversationId,
    input: message,
    metadata: { orgId, projectId },
  });

  if (!projectId) {
    projectId = await resolveProjectId(message, orgId);
  } else {
    const hasAccess = await verifyProjectAccess(projectId, orgId);
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: 'Project not found' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  trace.update({ metadata: { orgId, projectId } });

  const messages: ChatMessage[] = [
    ...history,
    { id: 'current', role: 'user', content: message, timestamp: Date.now() },
  ];

  const crossProjectKeywords = [
    'all projects', 'every project', 'across projects', 'portfolio',
    'which projects', 'compare projects', 'trending', 'overall',
    'biggest risk', 'most over budget', 'worst performing',
    'how are we doing', 'company', 'all jobs', 'across the board',
  ];
  const msgLower = message.toLowerCase();
  const isCrossProject = !projectId && crossProjectKeywords.some((kw) => msgLower.includes(kw));

  const structuredSpan = trace.span({
    name: 'structured-retrieval',
    input: { projectId, isCrossProject },
  });

  let projectContext: string;
  let recordCounts: Record<string, number> = {};

  if (projectId) {
    try {
      const data = await fetchAllProjectData(projectId);
      projectContext = assembleContext(data);
      recordCounts = data.meta.recordCounts;
    } catch (err) {
      console.error('Airtable fetch error:', err);
      projectContext =
        'ERROR: Could not fetch project data from Airtable. Please try again.';
    }
  } else if (isCrossProject) {
    try {
      const [healthData, allProjects] = await Promise.all([
        fetchProjectHealthData(orgId),
        fetchProjectList(orgId),
      ]);
      const activeHealth = healthData.filter(
        (p) => !p.status.toLowerCase().includes('complete') && !p.status.toLowerCase().includes('closed')
      );
      const detailedResults = await Promise.allSettled(
        activeHealth.slice(0, 5).map((p) => fetchAllProjectData(p.projectId))
      );
      const detailedData = detailedResults
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchAllProjectData>>> => r.status === 'fulfilled')
        .map((r) => r.value);
      projectContext = assemblePortfolioContext(detailedData, healthData);
      recordCounts = { portfolio: allProjects.length };
    } catch (err) {
      console.error('Portfolio fetch error:', err);
      projectContext = 'ERROR: Could not fetch portfolio data. Please try again.';
    }
  } else {
    const projects = await fetchProjectList(orgId);
    if (projects.length === 1) {
      projectId = projects[0].projectId;
      try {
        const data = await fetchAllProjectData(projectId);
        projectContext = assembleContext(data);
        recordCounts = data.meta.recordCounts;
      } catch {
        projectContext = 'ERROR: Could not fetch project data.';
      }
    } else {
      projectContext =
        `No specific project was identified. The user has ${projects.length} projects: ${projects.map((p) => p.projectName).join(', ')}. Ask which project they want to look at, or suggest they ask a cross-project question like "how are all projects doing?"`;
    }
  }

  structuredSpan.end({ output: { recordCounts } });

  const vectorSpan = trace.span({
    name: 'vector-search',
    input: { query: message, projectId, matchCount: 15, matchThreshold: 0.4 },
  });

  let ragContext = '';
  let ragResults: Array<{
    id: string;
    skill_id: string;
    document_type: string;
    fields: Record<string, unknown>;
    similarity: number;
    project_id: string;
    source_file?: string;
  }> = [];

  try {
    ragResults = await searchByEmbedding({
      query: message,
      projectId: projectId || undefined,
      orgId: orgId,
      matchCount: 15,
      matchThreshold: 0.4,
      includePending,
    }) as typeof ragResults;

    if (ragResults.length > 0) {
      const ragLines = ragResults.map((r, i) => {
        const fieldSummary = Object.entries(r.fields as Record<string, { value: unknown }>)
          .filter(([, v]) => v?.value != null)
          .map(([k, v]) => `  ${k}: ${v.value}`)
          .join('\n');
        return `[${i + 1}] ${r.document_type} (${r.skill_id}) — similarity: ${(r.similarity * 100).toFixed(0)}%\n${fieldSummary}`;
      });
      ragContext = `\n\n[EXTRACTED DOCUMENT RECORDS — from vector search]\n${ragLines.join('\n\n')}`;
    }
  } catch (err) {
    console.error('RAG search error (non-blocking):', err);
  }

  vectorSpan.end({
    output: {
      resultCount: ragResults.length,
      topSimilarity: ragResults[0]?.similarity ?? null,
      results: ragResults.map((r) => ({
        id: r.id,
        documentType: r.document_type,
        skillId: r.skill_id,
        similarity: r.similarity,
        sourceFile: r.source_file,
      })),
    },
  });

  // -- Fetch chat tools + prompt templates for this org --
  const toolSpan = trace.span({ name: 'chat-tools-fetch', input: { orgId } });
  const [orgTools, orgTemplates] = await Promise.all([
    fetchActiveTools(orgId),
    fetchActiveTemplates(orgId),
  ]);
  toolSpan.end({ output: { toolCount: orgTools.length, templateCount: orgTemplates.length } });

  const anthropicTools = orgTools.map(toolToAnthropicDef);
  const toolMap = new Map<string, ChatTool>(orgTools.map(t => [t.tool_name, t]));

  const matchedTemplates = matchTemplates(orgTemplates, message);
  let systemPrompt = CORTEX_SYSTEM_PROMPT;
  if (matchedTemplates.length > 0) {
    const templateInstructions = matchedTemplates
      .map(t => `[TEMPLATE: ${t.template_name}]\n${t.system_instructions}`)
      .join('\n\n');
    systemPrompt += `\n\n${templateInstructions}`;
  }

  if (orgTools.length > 0) {
    systemPrompt += `\n\nYou have access to tools that can query the project database, search documents, and retrieve live data. Use them when the user asks questions that require specific data lookups. Always prefer tool results over the static project data when both are available.`;
  }

  const sources = buildSourceRegistry(recordCounts, ragResults);
  const sourceLegend = buildSourceLegend(sources);
  const fullContext = projectContext + ragContext;

  const generation = trace.generation({
    name: 'claude-response',
    model: 'claude-sonnet-4-20250514',
    modelParameters: { max_tokens: 4096 },
    input: {
      messageCount: messages.length,
      contextLength: fullContext.length,
      sourcesCount: sources.length,
      toolCount: anthropicTools.length,
      matchedTemplates: matchedTemplates.map(t => t.template_name),
    },
  });

  const toolUseHandler = async (name: string, input: Record<string, unknown>) => {
    const tool = toolMap.get(name);
    if (!tool) return { error: `Unknown tool: ${name}` };
    const result = await executeChatTool(tool, input, { orgId, projectId: projectId || undefined, includePending });
    return result.error ? { error: result.error } : result.result;
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let accumulated = '';
      try {
        if (projectId) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ projectId })}\n\n`)
          );
        }

        if (sources.length > 0) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ sources })}\n\n`)
          );
        }

        const { stream: textStream, finalUsage } = streamChatWithTools(
          systemPrompt,
          messages,
          fullContext,
          sourceLegend,
          anthropicTools.length > 0 ? anthropicTools : undefined,
          anthropicTools.length > 0 ? toolUseHandler : undefined
        );

        for await (const chunk of textStream) {
          if (typeof chunk === 'string') {
            accumulated += chunk;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`)
            );
          } else {
            const event = chunk as ChatEvent;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
            );
          }
        }

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`)
        );

        const usage = await finalUsage;
        generation.end({
          output: accumulated,
          usage: {
            input: usage.inputTokens,
            output: usage.outputTokens,
          },
        });
        trace.update({ output: accumulated });
      } catch (err) {
        console.error('Streaming error:', err);
        generation.end({
          output: accumulated || 'ERROR',
          level: 'ERROR',
          statusMessage: err instanceof Error ? err.message : 'Unknown error',
        });
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: 'An error occurred while generating the response. Please try again.' })}\n\n`
          )
        );
      } finally {
        controller.close();
        langfuse.flushAsync().catch(() => {});
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
