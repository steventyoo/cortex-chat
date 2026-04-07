import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from('document_link_types')
    .select('*')
    .order('source_skill')
    .order('target_skill');

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ linkTypes: data });
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !['owner', 'admin'].includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { linkTypeKey, displayName, sourceSkill, targetSkill, relationship, matchFields, description } = body;

  if (!linkTypeKey || !displayName || !sourceSkill || !targetSkill || !relationship) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from('document_link_types')
    .insert({
      link_type_key: linkTypeKey,
      display_name: displayName,
      source_skill: sourceSkill,
      target_skill: targetSkill,
      relationship,
      match_fields: matchFields || [],
      description: description || '',
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ linkType: data });
}
