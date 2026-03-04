import { NextRequest } from 'next/server';
import { validateToken, SESSION_COOKIE } from '@/lib/auth';
import { fetchAllProjectData, resolveProjectId } from '@/lib/airtable';
import { CORTEX_SYSTEM_PROMPT, assembleContext } from '@/lib/prompts';
import { streamChatResponse } from '@/lib/claude';
import { ChatMessage } from '@/lib/types';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // 1. Auth check
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateToken(token))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

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

  // 3. Resolve project ID
  if (!projectId) {
    projectId = await resolveProjectId(message);
  }

  // Build conversation messages
  const messages: ChatMessage[] = [
    ...history,
    { id: 'current', role: 'user', content: message, timestamp: Date.now() },
  ];

  // 4. Fetch project data (or handle no project)
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
  } else {
    projectContext =
      'No specific project was identified from the query. Ask the user which project they want to look at, or if there is only one project available, use that.';
  }

  // 5. Stream Claude response
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
          projectContext
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
