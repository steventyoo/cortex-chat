import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { fetchAllProjectData, fetchProjectList, fetchProjectHealthData, resolveProjectId, verifyProjectAccess } from '@/lib/supabase';
import { CORTEX_SYSTEM_PROMPT, assembleContext, assemblePortfolioContext } from '@/lib/prompts';
import { streamChatResponse } from '@/lib/claude';
import { ChatMessage } from '@/lib/types';
import { searchByEmbedding } from '@/lib/embeddings';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // 1. Auth check
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

  // 2. Parse request
  let message: string;
  let projectId: string | null;
  let history: ChatMessage[];

  try {
    const body = await request.json();
    message = body.message;
    projectId = body.projectId || null;
    history = body.history || [];
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 3. Resolve project ID (scoped to org)
  if (!projectId) {
    projectId = await resolveProjectId(message, orgId);
  } else {
    // Verify project belongs to this org
    const hasAccess = await verifyProjectAccess(projectId, orgId);
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: 'Project not found' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Build conversation messages
  const messages: ChatMessage[] = [
    ...history,
    { id: 'current', role: 'user', content: message, timestamp: Date.now() },
  ];

  // 4. Detect cross-project queries
  const crossProjectKeywords = [
    'all projects', 'every project', 'across projects', 'portfolio',
    'which projects', 'compare projects', 'trending', 'overall',
    'biggest risk', 'most over budget', 'worst performing',
    'how are we doing', 'company', 'all jobs', 'across the board',
  ];
  const msgLower = message.toLowerCase();
  const isCrossProject = !projectId && crossProjectKeywords.some((kw) => msgLower.includes(kw));

  // 5. Fetch project data (single, cross-project, or no project)
  let projectContext: string;
  if (projectId) {
    try {
      const data = await fetchAllProjectData(projectId);
      projectContext = assembleContext(data);
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
      // Fetch detailed data for all active projects
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
    } catch (err) {
      console.error('Portfolio fetch error:', err);
      projectContext = 'ERROR: Could not fetch portfolio data. Please try again.';
    }
  } else {
    // Try to resolve, otherwise ask
    const projects = await fetchProjectList(orgId);
    if (projects.length === 1) {
      projectId = projects[0].projectId;
      try {
        const data = await fetchAllProjectData(projectId);
        projectContext = assembleContext(data);
      } catch {
        projectContext = 'ERROR: Could not fetch project data.';
      }
    } else {
      projectContext =
        `No specific project was identified. The user has ${projects.length} projects: ${projects.map((p) => p.projectName).join(', ')}. Ask which project they want to look at, or suggest they ask a cross-project question like "how are all projects doing?"`;
    }
  }

  // 5. Stream Claude response
  // Augment context with vector-searched extracted records when available
  let ragContext = '';
  try {
    const ragResults = await searchByEmbedding({
      query: message,
      projectId: projectId || undefined,
      orgId: orgId,
      matchCount: 15,
      matchThreshold: 0.4,
    });

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

  const fullContext = projectContext + ragContext;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send project ID info first
        if (projectId) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ projectId })}\n\n`
            )
          );
        }

        const generator = streamChatResponse(
          CORTEX_SYSTEM_PROMPT,
          messages,
          fullContext
        );

        for await (const chunk of generator) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`)
          );
        }

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`)
        );
      } catch (err) {
        console.error('Streaming error:', err);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: 'An error occurred while generating the response. Please try again.' })}\n\n`
          )
        );
      } finally {
        controller.close();
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
