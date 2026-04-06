import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, isAdminRole } from '@/lib/auth-v2';
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
    .from('org_skill_configs')
    .select('*')
    .eq('skill_id', skillId);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ configs: data || [] });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session || !isAdminRole(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { skillId } = await params;
  const body = await request.json() as {
    orgId: string;
    pinned_version?: number | null;
    document_aliases?: string[];
    hidden_fields?: string[];
  };

  if (!body.orgId) {
    return Response.json({ error: 'orgId is required' }, { status: 400 });
  }

  const sb = getSupabase();

  const { data, error } = await sb
    .from('org_skill_configs')
    .upsert({
      org_id: body.orgId,
      skill_id: skillId,
      pinned_version: body.pinned_version ?? null,
      document_aliases: body.document_aliases || [],
      hidden_fields: body.hidden_fields || [],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id,skill_id' })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ config: data });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session || !isAdminRole(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { skillId } = await params;
  const { orgId } = await request.json() as { orgId: string };

  const sb = getSupabase();
  const { error } = await sb
    .from('org_skill_configs')
    .delete()
    .eq('skill_id', skillId)
    .eq('org_id', orgId);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
