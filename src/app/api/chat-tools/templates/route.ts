import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (session as SessionPayload).orgId;
  const sb = getSupabase();

  const { data, error } = await sb
    .from('chat_prompt_templates')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ templates: data });
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !['owner', 'admin'].includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (session as SessionPayload).orgId;
  const body = await request.json();
  const { templateName, triggerDescription, triggerKeywords, systemInstructions, responseFormat, samplePrompts } = body;

  if (!templateName || !triggerDescription || !systemInstructions) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from('chat_prompt_templates')
    .insert({
      org_id: orgId,
      template_name: templateName,
      trigger_description: triggerDescription,
      trigger_keywords: triggerKeywords || [],
      system_instructions: systemInstructions,
      response_format: responseFormat || null,
      sample_prompts: samplePrompts || [],
      created_by: session.userId,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ template: data });
}
