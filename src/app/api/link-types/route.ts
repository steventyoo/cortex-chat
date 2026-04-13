import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { z } from 'zod';
import { LinkTypeSchema, CreateLinkTypeInput } from '@/lib/schemas/link-types.schema';
import { listLinkTypes, insertLinkType } from '@/lib/stores/link-types.store';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const raw = await listLinkTypes();
    const linkTypes = z.array(LinkTypeSchema).parse(raw);
    return Response.json({ linkTypes });
  } catch (err) {
    console.error('[link-types] GET error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !['owner', 'admin'].includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = CreateLinkTypeInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const input = parsed.data;

  try {
    const raw = await insertLinkType({
      link_type_key: input.linkTypeKey,
      display_name: input.displayName,
      source_skill: input.sourceSkill,
      target_skill: input.targetSkill,
      relationship: input.relationship,
      match_fields: input.matchFields,
      description: input.description,
    });
    const linkType = LinkTypeSchema.parse(raw);
    return Response.json({ linkType });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[link-types] POST error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
}
