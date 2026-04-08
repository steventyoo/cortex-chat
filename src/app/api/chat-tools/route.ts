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
    .from('chat_tools')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ tools: data });
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !['owner', 'admin'].includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (session as SessionPayload).orgId;
  const body = await request.json();
  const { toolName, displayName, description, inputSchema, implementationType, implementationConfig, samplePrompts } = body;

  if (!toolName || !displayName || !description || !implementationType) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from('chat_tools')
    .insert({
      org_id: orgId,
      tool_name: toolName,
      display_name: displayName,
      description,
      input_schema: inputSchema || {},
      implementation_type: implementationType,
      implementation_config: implementationConfig || {},
      sample_prompts: samplePrompts || [],
      created_by: session.userId,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ tool: data });
}
