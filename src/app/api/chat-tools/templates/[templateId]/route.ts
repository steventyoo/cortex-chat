import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload, ADMIN_ROLES } from '@/lib/auth-v2';
import { ChatPromptTemplateSchema, UpdateChatTemplateInput } from '@/lib/schemas/chat-tools.schema';
import {
  getChatTemplateById,
  updateChatTemplate,
  deleteChatTemplate,
} from '@/lib/stores/chat-tools.store';

interface RouteParams {
  params: Promise<{ templateId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { templateId } = await params;
  const orgId = (session as SessionPayload).orgId;

  try {
    const raw = await getChatTemplateById(templateId, orgId);
    if (!raw) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    const template = ChatPromptTemplateSchema.parse(raw);
    return Response.json({ template });
  } catch (err) {
    console.error('[chat-templates/:id] GET error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { templateId } = await params;
  const orgId = (session as SessionPayload).orgId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = UpdateChatTemplateInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const updates: Record<string, unknown> = {};
  if (input.templateName !== undefined) updates.template_name = input.templateName;
  if (input.triggerDescription !== undefined) updates.trigger_description = input.triggerDescription;
  if (input.triggerKeywords !== undefined) updates.trigger_keywords = input.triggerKeywords;
  if (input.systemInstructions !== undefined) updates.system_instructions = input.systemInstructions;
  if (input.responseFormat !== undefined) updates.response_format = input.responseFormat;
  if (input.samplePrompts !== undefined) updates.sample_prompts = input.samplePrompts;
  if (input.isActive !== undefined) updates.is_active = input.isActive;

  try {
    const raw = await updateChatTemplate(templateId, orgId, updates);
    const template = ChatPromptTemplateSchema.parse(raw);
    return Response.json({ template });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[chat-templates/:id] PATCH error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { templateId } = await params;
  const orgId = (session as SessionPayload).orgId;

  try {
    await deleteChatTemplate(templateId, orgId);
    return Response.json({ success: true });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[chat-templates/:id] DELETE error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
}
