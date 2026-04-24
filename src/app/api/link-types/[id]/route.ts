import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, ADMIN_ROLES } from '@/lib/auth-v2';
import { LinkTypeSchema, UpdateLinkTypeInput } from '@/lib/schemas/link-types.schema';
import { updateLinkType, deleteLinkType } from '@/lib/stores/link-types.store';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = UpdateLinkTypeInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const updates: Record<string, unknown> = {};
  if (input.displayName !== undefined) updates.display_name = input.displayName;
  if (input.matchFields !== undefined) updates.match_fields = input.matchFields;
  if (input.description !== undefined) updates.description = input.description;
  if (input.isActive !== undefined) updates.is_active = input.isActive;

  try {
    const raw = await updateLinkType(id, updates);
    const linkType = LinkTypeSchema.parse(raw);
    return Response.json({ linkType });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[link-types/:id] PATCH error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    await deleteLinkType(id);
    return Response.json({ success: true });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[link-types/:id] DELETE error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
}
