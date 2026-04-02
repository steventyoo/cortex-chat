import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, isAdminRole } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdminRole(session.role)) return Response.json({ error: 'Admin access required' }, { status: 403 });

  const { id } = await params;
  let body: { label?: string; priority?: string; sort_order?: number; search_keywords?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const sb = getSupabase();

  const { data: existing } = await sb
    .from('document_categories')
    .select('id, org_id')
    .eq('id', id)
    .single();

  if (!existing || existing.org_id !== session.orgId) {
    return Response.json({ error: 'Category not found' }, { status: 404 });
  }

  const update: Record<string, unknown> = {};
  if (body.label !== undefined) update.label = body.label.trim();
  if (body.priority !== undefined) update.priority = body.priority;
  if (body.sort_order !== undefined) update.sort_order = body.sort_order;
  if (body.search_keywords !== undefined) update.search_keywords = body.search_keywords;

  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { data, error } = await sb
    .from('document_categories')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ category: data });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdminRole(session.role)) return Response.json({ error: 'Admin access required' }, { status: 403 });

  const { id } = await params;
  const sb = getSupabase();

  const { data: existing } = await sb
    .from('document_categories')
    .select('id, org_id, is_default')
    .eq('id', id)
    .single();

  if (!existing || existing.org_id !== session.orgId) {
    return Response.json({ error: 'Category not found' }, { status: 404 });
  }

  if (existing.is_default) {
    return Response.json({ error: 'Cannot delete a default category' }, { status: 400 });
  }

  const { count } = await sb
    .from('pipeline_log')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', id);

  if ((count || 0) > 0) {
    let body: { reassign_to?: string } = {};
    try {
      body = await request.json();
    } catch {
      // no body
    }

    if (!body.reassign_to) {
      return Response.json({
        error: 'Category has documents. Provide reassign_to category ID to move them first.',
        document_count: count,
      }, { status: 409 });
    }

    await sb.from('pipeline_log').update({ category_id: body.reassign_to }).eq('category_id', id);
  }

  const { error } = await sb.from('document_categories').delete().eq('id', id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ deleted: true });
}
