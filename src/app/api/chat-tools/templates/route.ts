import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload, ADMIN_ROLES } from '@/lib/auth-v2';
import { z } from 'zod';
import { ChatPromptTemplateSchema, CreateChatTemplateInput } from '@/lib/schemas/chat-tools.schema';
import { listChatTemplates, insertChatTemplate } from '@/lib/stores/chat-tools.store';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (session as SessionPayload).orgId;

  try {
    const raw = await listChatTemplates(orgId);
    const templates = z.array(ChatPromptTemplateSchema).parse(raw);
    return Response.json({ templates });
  } catch (err) {
    console.error('[chat-templates] GET error:', err);
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

  const parsed = CreateChatTemplateInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const input = parsed.data;

  try {
    const raw = await insertChatTemplate({
      org_id: orgId,
      template_name: input.templateName,
      trigger_description: input.triggerDescription,
      trigger_keywords: input.triggerKeywords,
      system_instructions: input.systemInstructions,
      response_format: input.responseFormat ?? null,
      sample_prompts: input.samplePrompts,
      created_by: session.userId,
    });
    const template = ChatPromptTemplateSchema.parse(raw);
    return Response.json({ template });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[chat-templates] POST error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
}
