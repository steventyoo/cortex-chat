import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

interface RouteParams {
  params: Promise<{ toolId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { toolId } = await params;
  const orgId = (session as SessionPayload).orgId;
  const sb = getSupabase();

  const { data, error } = await sb
    .from('chat_tools')
    .select('*')
    .eq('id', toolId)
    .eq('org_id', orgId)
    .single();

  if (error || !data) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  return Response.json({ tool: data });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !['owner', 'admin'].includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { toolId } = await params;
  const orgId = (session as SessionPayload).orgId;
  const body = await request.json();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.displayName !== undefined) updates.display_name = body.displayName;
  if (body.description !== undefined) updates.description = body.description;
  if (body.inputSchema !== undefined) updates.input_schema = body.inputSchema;
  if (body.implementationType !== undefined) updates.implementation_type = body.implementationType;
  if (body.implementationConfig !== undefined) updates.implementation_config = body.implementationConfig;
  if (body.samplePrompts !== undefined) updates.sample_prompts = body.samplePrompts;
  if (body.isActive !== undefined) updates.is_active = body.isActive;

  const sb = getSupabase();
  const { data, error } = await sb
    .from('chat_tools')
    .update(updates)
    .eq('id', toolId)
    .eq('org_id', orgId)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ tool: data });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !['owner', 'admin'].includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { toolId } = await params;
  const orgId = (session as SessionPayload).orgId;
  const sb = getSupabase();

  const { error } = await sb
    .from('chat_tools')
    .delete()
    .eq('id', toolId)
    .eq('org_id', orgId);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
