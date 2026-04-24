import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload, ADMIN_ROLES } from '@/lib/auth-v2';
import { z } from 'zod';
import { ChatToolSchema, CreateChatToolInput } from '@/lib/schemas/chat-tools.schema';
import { listChatTools, insertChatTool } from '@/lib/stores/chat-tools.store';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (session as SessionPayload).orgId;

  try {
    const raw = await listChatTools(orgId);
    const tools = z.array(ChatToolSchema).parse(raw);
    return Response.json({ tools });
  } catch (err) {
    console.error('[chat-tools] GET error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (session as SessionPayload).orgId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = CreateChatToolInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const input = parsed.data;

  try {
    const raw = await insertChatTool({
      org_id: orgId,
      tool_name: input.toolName,
      display_name: input.displayName,
      description: input.description,
      input_schema: input.inputSchema,
      implementation_type: input.implementationType,
      implementation_config: input.implementationConfig,
      sample_prompts: input.samplePrompts,
      created_by: session.userId,
    });
    const tool = ChatToolSchema.parse(raw);
    return Response.json({ tool });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[chat-tools] POST error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
}
