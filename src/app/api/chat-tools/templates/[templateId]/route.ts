import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

interface RouteParams {
  params: Promise<{ templateId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { templateId } = await params;
  const orgId = (session as SessionPayload).orgId;
  const sb = getSupabase();

  const { data, error } = await sb
    .from('chat_prompt_templates')
    .select('*')
    .eq('id', templateId)
    .eq('org_id', orgId)
    .single();

  if (error || !data) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  return Response.json({ template: data });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !['owner', 'admin'].includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { templateId } = await params;
  const orgId = (session as SessionPayload).orgId;
  const body = await request.json();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.templateName !== undefined) updates.template_name = body.templateName;
  if (body.triggerDescription !== undefined) updates.trigger_description = body.triggerDescription;
  if (body.triggerKeywords !== undefined) updates.trigger_keywords = body.triggerKeywords;
  if (body.systemInstructions !== undefined) updates.system_instructions = body.systemInstructions;
  if (body.responseFormat !== undefined) updates.response_format = body.responseFormat;
  if (body.samplePrompts !== undefined) updates.sample_prompts = body.samplePrompts;
  if (body.isActive !== undefined) updates.is_active = body.isActive;

  const sb = getSupabase();
  const { data, error } = await sb
    .from('chat_prompt_templates')
    .update(updates)
    .eq('id', templateId)
    .eq('org_id', orgId)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ template: data });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !['owner', 'admin'].includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { templateId } = await params;
  const orgId = (session as SessionPayload).orgId;
  const sb = getSupabase();

  const { error } = await sb
    .from('chat_prompt_templates')
    .delete()
    .eq('id', templateId)
    .eq('org_id', orgId);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
