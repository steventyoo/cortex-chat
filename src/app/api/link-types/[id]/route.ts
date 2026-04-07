import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !['owner', 'admin'].includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.displayName !== undefined) updates.display_name = body.displayName;
  if (body.matchFields !== undefined) updates.match_fields = body.matchFields;
  if (body.description !== undefined) updates.description = body.description;
  if (body.isActive !== undefined) updates.is_active = body.isActive;

  const sb = getSupabase();
  const { data, error } = await sb
    .from('document_link_types')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ linkType: data });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !['owner', 'admin'].includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const sb = getSupabase();
  const { error } = await sb
    .from('document_link_types')
    .delete()
    .eq('id', id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
