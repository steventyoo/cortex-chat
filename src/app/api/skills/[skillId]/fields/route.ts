import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

interface RouteParams {
  params: Promise<{ skillId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { skillId } = await params;
  const sb = getSupabase();

  const { data, error } = await sb
    .from('skill_fields')
    .select(`
      id,
      skill_id,
      field_id,
      display_override,
      tier,
      required,
      importance,
      disambiguation_rules,
      sort_order,
      field_catalog (
        id,
        canonical_name,
        display_name,
        field_type,
        category,
        description,
        enum_options
      )
    `)
    .eq('skill_id', skillId)
    .order('sort_order');

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ fields: data || [] });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { skillId } = await params;

  let body: {
    fieldId: string;
    displayOverride?: string;
    tier?: number;
    required?: boolean;
    importance?: string;
    disambiguationRules?: string;
  };

  try {
    body = await request.json();
    if (!body.fieldId) {
      return Response.json({ error: 'fieldId is required' }, { status: 400 });
    }
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const sb = getSupabase();

  const { data: maxOrder } = await sb
    .from('skill_fields')
    .select('sort_order')
    .eq('skill_id', skillId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .single();

  const nextOrder = (maxOrder?.sort_order ?? 0) + 1;

  const { data, error } = await sb
    .from('skill_fields')
    .insert({
      skill_id: skillId,
      field_id: body.fieldId,
      display_override: body.displayOverride || null,
      tier: body.tier ?? 1,
      required: body.required ?? false,
      importance: body.importance || 'E',
      disambiguation_rules: body.disambiguationRules || null,
      sort_order: nextOrder,
    })
    .select(`
      id,
      skill_id,
      field_id,
      display_override,
      tier,
      required,
      importance,
      disambiguation_rules,
      sort_order,
      field_catalog (
        id,
        canonical_name,
        display_name,
        field_type,
        category,
        description,
        enum_options
      )
    `)
    .single();

  if (error) {
    if (error.code === '23505') {
      return Response.json({ error: 'Field already assigned to this skill' }, { status: 409 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ field: data }, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { skillId } = await params;
  const skillFieldId = request.nextUrl.searchParams.get('id');
  if (!skillFieldId) {
    return Response.json({ error: 'id query param is required' }, { status: 400 });
  }

  const sb = getSupabase();
  const { error } = await sb
    .from('skill_fields')
    .delete()
    .eq('id', skillFieldId)
    .eq('skill_id', skillId);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
