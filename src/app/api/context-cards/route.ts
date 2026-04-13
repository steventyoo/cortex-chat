import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { z } from 'zod';
import { generateEmbedding } from '@/lib/embeddings';
import {
  ContextCardSchema,
  CreateContextCardInput,
  UpdateContextCardInput,
} from '@/lib/schemas/context-cards.schema';
import {
  listContextCards,
  insertContextCard,
  updateContextCard,
  deleteContextCard,
} from '@/lib/stores/context-cards.store';

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

  try {
    const raw = await listContextCards(orgId);
    const cards = z.array(ContextCardSchema).parse(raw);
    return Response.json({ cards });
  } catch (err) {
    console.error('[context-cards] GET error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !['owner', 'admin'].includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (session as SessionPayload).orgId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = CreateContextCardInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const embeddingStr = await embedCardText(input);

  try {
    const raw = await insertContextCard({
      org_id: orgId,
      card_name: input.card_name,
      display_name: input.display_name,
      description: input.description,
      trigger_concepts: input.trigger_concepts,
      skills_involved: input.skills_involved,
      business_logic: input.business_logic,
      key_fields: input.key_fields,
      example_questions: input.example_questions,
      embedding: embeddingStr,
      is_active: input.is_active,
      created_by: session.userId,
    });
    const card = ContextCardSchema.parse(raw);
    return Response.json({ card });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[context-cards] POST error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !['owner', 'admin'].includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (session as SessionPayload).orgId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = UpdateContextCardInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const updates: Record<string, unknown> = {};

  const textFields = ['card_name', 'display_name', 'description', 'business_logic'] as const;
  for (const f of textFields) {
    if (input[f] !== undefined) updates[f] = input[f];
  }

  const arrayFields = ['trigger_concepts', 'skills_involved', 'example_questions'] as const;
  for (const f of arrayFields) {
    if (input[f] !== undefined) updates[f] = input[f];
  }

  if (input.key_fields !== undefined) updates.key_fields = input.key_fields;
  if (input.is_active !== undefined) updates.is_active = input.is_active;

  const needsReEmbed = input.display_name !== undefined ||
    input.description !== undefined ||
    input.trigger_concepts !== undefined ||
    input.example_questions !== undefined;

  if (needsReEmbed) {
    const embeddingStr = await embedCardText({
      display_name: input.display_name || '',
      description: input.description || '',
      trigger_concepts: input.trigger_concepts,
      example_questions: input.example_questions,
    });
    if (embeddingStr) updates.embedding = embeddingStr;
  }

  try {
    const raw = await updateContextCard(input.id, orgId, updates);
    const card = ContextCardSchema.parse(raw);
    return Response.json({ card });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[context-cards] PATCH error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
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

  try {
    await deleteContextCard(id, orgId);
    return Response.json({ success: true });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[context-cards] DELETE error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
}
