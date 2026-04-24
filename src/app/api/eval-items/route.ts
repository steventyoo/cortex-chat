import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload, ADMIN_ROLES } from '@/lib/auth-v2';
import { z } from 'zod';
import { EvalItemSchema, CreateEvalItemInput } from '@/lib/schemas/eval-items.schema';
import { listEvalItems, insertEvalItem } from '@/lib/stores/eval-items.store';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (session as SessionPayload).orgId;

  try {
    const raw = await listEvalItems(orgId);
    const items = z.array(EvalItemSchema).parse(raw);
    return Response.json({ items });
  } catch (err) {
    console.error('[eval-items] GET error:', err);
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

  const parsed = CreateEvalItemInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const input = parsed.data;

  try {
    const raw = await insertEvalItem({
      id: input.id,
      org_id: orgId,
      category: input.category,
      question: input.question,
      project_id: input.projectId,
      expected_answer: input.expectedAnswer,
      key_values: input.keyValues,
      expected_tool: input.expectedTool,
      created_by: session.userId,
    });
    const item = EvalItemSchema.parse(raw);
    return Response.json({ item });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[eval-items] POST error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
}
