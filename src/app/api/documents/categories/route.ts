import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, isAdminRole } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from('document_categories')
    .select('*')
    .eq('org_id', session.orgId)
    .order('sort_order');

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ categories: data || [] });
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isAdminRole(session.role)) {
    return Response.json({ error: 'Admin access required' }, { status: 403 });
  }

  let body: { label: string; priority?: string; sort_order?: number; search_keywords?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.label?.trim()) {
    return Response.json({ error: 'label is required' }, { status: 400 });
  }

  const sb = getSupabase();

  const { data: maxRow } = await sb
    .from('document_categories')
    .select('sort_order')
    .eq('org_id', session.orgId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = body.sort_order ?? ((maxRow?.sort_order as number || 17) + 1);
  const key = `${String(nextSort).padStart(2, '0')}_${body.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;

  const { data, error } = await sb
    .from('document_categories')
    .insert({
      org_id: session.orgId,
      key,
      label: body.label.trim(),
      priority: body.priority || 'P3',
      sort_order: nextSort,
      search_keywords: body.search_keywords || null,
      is_default: false,
      created_by: session.userId,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return Response.json({ error: 'A category with this name already exists' }, { status: 409 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ category: data }, { status: 201 });
}
