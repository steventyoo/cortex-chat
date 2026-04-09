import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { fetchProjectList, resolveProjectId, verifyProjectAccess, getSupabase } from '@/lib/supabase';
import { CORTEX_SYSTEM_PROMPT } from '@/lib/prompts';
import { streamChatWithTools, ChatEvent } from '@/lib/claude';
import { ChatMessage } from '@/lib/types';
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

async function fetchProjectMeta(projectId: string): Promise<{
  name: string;
  address: string;
  trade: string;
  status: string;
} | null> {
  const sb = getSupabase();
  const { data } = await sb
    .from('projects')
    .select('project_name, address, trade, project_status')
    .eq('project_id', projectId)
    .single();
  if (!data) return null;
  return {
    name: String(data.project_name || ''),
    address: String(data.address || ''),
    trade: String(data.trade || ''),
    status: String(data.project_status || ''),
  };
}

async function fetchDataInventory(
  projectId: string | null,
  orgId: string
): Promise<Record<string, number>> {
  const sb = getSupabase();
  let query = sb
    .from('extracted_records')
    .select('skill_id')
    .eq('org_id', orgId)
    .not('embedding', 'is', null);

  if (projectId) {
    query = query.eq('project_id', projectId);
  }

  const { data } = await query;
  if (!data) return {};

  const counts: Record<string, number> = {};
  for (const row of data) {
    const sk = String((row as Record<string, unknown>).skill_id || 'unknown');
    counts[sk] = (counts[sk] || 0) + 1;
  }
  return counts;
}

function buildProjectContext(
  projectId: string,
  meta: { name: string; address: string; trade: string; status: string } | null,
  inventory: Record<string, number>
): string {
  const lines: string[] = [];
  lines.push(`## PROJECT: ${projectId}`);
  if (meta) {
    if (meta.name) lines.push(`- Name: ${meta.name}`);
    if (meta.address) lines.push(`- Address: ${meta.address}`);
    if (meta.trade) lines.push(`- Trade: ${meta.trade}`);
    if (meta.status) lines.push(`- Status: ${meta.status}`);
  }

  const inventoryEntries = Object.entries(inventory).sort((a, b) => b[1] - a[1]);
  if (inventoryEntries.length > 0) {
    lines.push('');
    lines.push('## AVAILABLE DOCUMENT DATA');
    for (const [skill, count] of inventoryEntries) {
      lines.push(`- ${skill}: ${count} record${count !== 1 ? 's' : ''}`);
    }
  } else {
    lines.push('');
    lines.push('## AVAILABLE DOCUMENT DATA');
    lines.push('No embedded document records found for this project yet.');
  }

  lines.push('');
  lines.push('Use your tools to query specific document types. Do not guess — always call a tool first.');
  return lines.join('\n');
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

  const contextSpan = trace.span({
    name: 'project-context',
    input: { projectId },
  });

  let projectContext: string;

  if (projectId) {
    const [meta, inventory] = await Promise.all([
      fetchProjectMeta(projectId),
      fetchDataInventory(projectId, orgId),
    ]);
    projectContext = buildProjectContext(projectId, meta, inventory);
  } else {
    const projects = await fetchProjectList(orgId);
    if (projects.length === 1) {
      projectId = projects[0].projectId;
      const [meta, inventory] = await Promise.all([
        fetchProjectMeta(projectId),
        fetchDataInventory(projectId, orgId),
      ]);
      projectContext = buildProjectContext(projectId, meta, inventory);
    } else if (projects.length > 0) {
      const inventory = await fetchDataInventory(null, orgId);
      const inventoryLines = Object.entries(inventory)
        .sort((a, b) => b[1] - a[1])
        .map(([sk, count]) => `- ${sk}: ${count} record${count !== 1 ? 's' : ''}`);
      projectContext = `No specific project was identified. The user has ${projects.length} projects: ${projects.map((p) => p.projectName).join(', ')}. Ask which project they want to look at, or answer cross-project questions using tools.\n\n## AVAILABLE DOCUMENT DATA (all projects)\n${inventoryLines.join('\n') || 'No embedded records yet.'}`;
    } else {
      projectContext = 'No projects found for this organization.';
    }
  }

  contextSpan.end({ output: { projectId } });

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

  const toolUseHandler = async (name: string, input: Record<string, unknown>) => {
    const tool = toolMap.get(name);
    if (!tool) return { error: `Unknown tool: ${name}` };
    const result = await executeChatTool(tool, input, { orgId, projectId: projectId || undefined, includePending });
    if (result.error) return { error: result.error };
    if (result.htmlArtifact) {
      return { __result: result.result, __htmlArtifact: result.htmlArtifact };
    }
    return result.result;
  };

  const generation = trace.generation({
    name: 'claude-response',
    model: 'claude-sonnet-4-20250514',
    modelParameters: { max_tokens: 4096 },
    input: {
      messageCount: messages.length,
      contextLength: projectContext.length,
      toolCount: anthropicTools.length,
      matchedTemplates: matchedTemplates.map(t => t.template_name),
    },
  });

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

        const { stream: textStream, finalUsage } = streamChatWithTools(
          systemPrompt,
          messages,
          projectContext,
          '',
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
