import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { EvalItemSchema, UpdateEvalItemInput } from '@/lib/schemas/eval-items.schema';
import { getEvalItemById, updateEvalItem, deleteEvalItem } from '@/lib/stores/eval-items.store';

interface RouteParams {
  params: Promise<{ itemId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { itemId } = await params;
  const orgId = (session as SessionPayload).orgId;

  try {
    const raw = await getEvalItemById(itemId, orgId);
    if (!raw) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    const item = EvalItemSchema.parse(raw);
    return Response.json({ item });
  } catch (err) {
    console.error('[eval-items/:id] GET error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !['owner', 'admin'].includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { itemId } = await params;
  const orgId = (session as SessionPayload).orgId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = UpdateEvalItemInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const updates: Record<string, unknown> = {};
  if (input.category !== undefined) updates.category = input.category;
  if (input.question !== undefined) updates.question = input.question;
  if (input.projectId !== undefined) updates.project_id = input.projectId;
  if (input.expectedAnswer !== undefined) updates.expected_answer = input.expectedAnswer;
  if (input.keyValues !== undefined) updates.key_values = input.keyValues;
  if (input.expectedTool !== undefined) updates.expected_tool = input.expectedTool;
  if (input.isActive !== undefined) updates.is_active = input.isActive;
  updates.updated_by = session.userId;

  try {
    const raw = await updateEvalItem(itemId, orgId, updates);
    const item = EvalItemSchema.parse(raw);
    return Response.json({ item });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[eval-items/:id] PATCH error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !['owner', 'admin'].includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { itemId } = await params;
  const orgId = (session as SessionPayload).orgId;

  try {
    await deleteEvalItem(itemId, orgId);
    return Response.json({ success: true });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[eval-items/:id] DELETE error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
}
