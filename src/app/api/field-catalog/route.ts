import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getSupabase();
  const category = request.nextUrl.searchParams.get('category');
  const withUsage = request.nextUrl.searchParams.get('withUsage') === 'true';

  let query = sb.from('field_catalog').select('*').order('category').order('display_name');
  if (category) {
    query = query.eq('category', category);
  }

  const { data, error } = await query;
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (withUsage && data) {
    const { data: usageCounts } = await sb
      .from('skill_fields')
      .select('field_id');

    const countMap = new Map<string, number>();
    for (const row of usageCounts || []) {
      const fid = row.field_id as string;
      countMap.set(fid, (countMap.get(fid) || 0) + 1);
    }

    const enriched = data.map(f => ({
      ...f,
      usage_count: countMap.get(f.id) || 0,
    }));

    return Response.json({ fields: enriched });
  }

  return Response.json({ fields: data || [] });
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    canonicalName: string;
    displayName: string;
    fieldType?: string;
    category?: string;
    description?: string;
    enumOptions?: string[];
  };

  try {
    body = await request.json();
    if (!body.canonicalName || !body.displayName) {
      return Response.json({ error: 'canonicalName and displayName are required' }, { status: 400 });
    }
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const canonicalName = body.canonicalName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .trim();

  const sb = getSupabase();
  const { data, error } = await sb
    .from('field_catalog')
    .insert({
      canonical_name: canonicalName,
      display_name: body.displayName,
      field_type: body.fieldType || 'string',
      category: body.category || 'general',
      description: body.description || '',
      enum_options: body.enumOptions ? JSON.stringify(body.enumOptions) : null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return Response.json({ error: `Field "${canonicalName}" already exists` }, { status: 409 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ field: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    id: string;
    displayName?: string;
    fieldType?: string;
    category?: string;
    description?: string;
    enumOptions?: string[] | null;
  };

  try {
    body = await request.json();
    if (!body.id) {
      return Response.json({ error: 'id is required' }, { status: 400 });
    }
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const sb = getSupabase();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.displayName !== undefined) update.display_name = body.displayName;
  if (body.fieldType !== undefined) update.field_type = body.fieldType;
  if (body.category !== undefined) update.category = body.category;
  if (body.description !== undefined) update.description = body.description;
  if (body.enumOptions !== undefined) update.enum_options = body.enumOptions;

  const { data, error } = await sb
    .from('field_catalog')
    .update(update)
    .eq('id', body.id)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ field: data });
}
