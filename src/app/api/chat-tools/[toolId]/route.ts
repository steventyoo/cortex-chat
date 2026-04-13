import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { ChatToolSchema, UpdateChatToolInput } from '@/lib/schemas/chat-tools.schema';
import { getChatToolById, updateChatTool, deleteChatTool } from '@/lib/stores/chat-tools.store';

interface RouteParams {
  params: Promise<{ toolId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { toolId } = await params;
  const orgId = (session as SessionPayload).orgId;

  try {
    const raw = await getChatToolById(toolId, orgId);
    if (!raw) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    const tool = ChatToolSchema.parse(raw);
    return Response.json({ tool });
  } catch (err) {
    console.error('[chat-tools/:id] GET error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !['owner', 'admin'].includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { toolId } = await params;
  const orgId = (session as SessionPayload).orgId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = UpdateChatToolInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const updates: Record<string, unknown> = {};
  if (input.displayName !== undefined) updates.display_name = input.displayName;
  if (input.description !== undefined) updates.description = input.description;
  if (input.inputSchema !== undefined) updates.input_schema = input.inputSchema;
  if (input.implementationType !== undefined) updates.implementation_type = input.implementationType;
  if (input.implementationConfig !== undefined) updates.implementation_config = input.implementationConfig;
  if (input.samplePrompts !== undefined) updates.sample_prompts = input.samplePrompts;
  if (input.isActive !== undefined) updates.is_active = input.isActive;

  try {
    const raw = await updateChatTool(toolId, orgId, updates);
    const tool = ChatToolSchema.parse(raw);
    return Response.json({ tool });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[chat-tools/:id] PATCH error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !['owner', 'admin'].includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { toolId } = await params;
  const orgId = (session as SessionPayload).orgId;

  try {
    await deleteChatTool(toolId, orgId);
    return Response.json({ success: true });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[chat-tools/:id] DELETE error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
}
