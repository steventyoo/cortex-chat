import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';
import { generateEmbedding } from '@/lib/embeddings';

async function embedCardText(card: {
  display_name: string;
  description: string;
  trigger_concepts?: string[];
  example_questions?: string[];
}): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  const text = [
    card.display_name,
    card.description,
    ...(card.trigger_concepts || []),
    ...(card.example_questions || []),
  ].join('\n');

  try {
    const embedding = await generateEmbedding(text);
    return `[${embedding.join(',')}]`;
  } catch (err) {
    console.error('Failed to embed context card:', err);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (session as SessionPayload).orgId;
  const sb = getSupabase();

  const { data, error } = await sb
    .from('context_cards')
    .select('*')
    .eq('org_id', orgId)
    .order('display_name');

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ cards: data || [] });
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !['owner', 'admin'].includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (session as SessionPayload).orgId;
  const body = await request.json();

  const embeddingStr = await embedCardText(body);

  const sb = getSupabase();
  const { data, error } = await sb
    .from('context_cards')
    .insert({
      org_id: orgId,
      card_name: body.card_name,
      display_name: body.display_name,
      description: body.description,
      trigger_concepts: body.trigger_concepts || [],
      skills_involved: body.skills_involved || [],
      business_logic: body.business_logic,
      key_fields: body.key_fields || {},
      example_questions: body.example_questions || [],
      embedding: embeddingStr,
      is_active: body.is_active !== false,
      created_by: session.userId,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ card: data });
}

export async function PATCH(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !['owner', 'admin'].includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (session as SessionPayload).orgId;
  const body = await request.json();

  if (!body.id) return Response.json({ error: 'Missing card id' }, { status: 400 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  const textFields = ['card_name', 'display_name', 'description', 'business_logic'] as const;
  for (const f of textFields) {
    if (body[f] !== undefined) updates[f] = body[f];
  }

  const arrayFields = ['trigger_concepts', 'skills_involved', 'example_questions'] as const;
  for (const f of arrayFields) {
    if (body[f] !== undefined) updates[f] = body[f];
  }

  if (body.key_fields !== undefined) updates.key_fields = body.key_fields;
  if (body.is_active !== undefined) updates.is_active = body.is_active;

  const needsReEmbed = body.display_name !== undefined ||
    body.description !== undefined ||
    body.trigger_concepts !== undefined ||
    body.example_questions !== undefined;

  if (needsReEmbed) {
    const embeddingStr = await embedCardText({
      display_name: body.display_name || '',
      description: body.description || '',
      trigger_concepts: body.trigger_concepts,
      example_questions: body.example_questions,
    });
    if (embeddingStr) updates.embedding = embeddingStr;
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from('context_cards')
    .update(updates)
    .eq('id', body.id)
    .eq('org_id', orgId)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ card: data });
}

export async function DELETE(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !['owner', 'admin'].includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (session as SessionPayload).orgId;
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 });

  const sb = getSupabase();
  const { error } = await sb
    .from('context_cards')
    .delete()
    .eq('id', id)
    .eq('org_id', orgId);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
