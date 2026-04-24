import { NextRequest } from 'next/server';
import { z } from 'zod';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import {
  DerivedFieldSchema,
  CreateDerivedFieldInput,
  UpdateDerivedFieldInput,
} from '@/lib/schemas/derived-fields.schema';
import {
  listDerivedFields,
  insertDerivedField,
  updateDerivedField,
  deleteDerivedField,
} from '@/lib/stores/derived-fields.store';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const skillId = request.nextUrl.searchParams.get('skill_id') || undefined;

  try {
    const raw = await listDerivedFields({ skillId });
    const fields = z.array(DerivedFieldSchema).parse(raw);
    return Response.json({ fields });
  } catch (err) {
    console.error('[derived-fields] GET error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = CreateDerivedFieldInput.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const raw = await insertDerivedField(parsed.data);
    const field = DerivedFieldSchema.parse(raw);
    return Response.json({ field });
  } catch (err) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '23505') {
      return Response.json({ error: 'A derived field with that canonical name already exists for this skill' }, { status: 409 });
    }
    console.error('[derived-fields] POST error:', err);
    return Response.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = UpdateDerivedFieldInput.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { id, ...updates } = parsed.data;
    const raw = await updateDerivedField(id, updates);
    const field = DerivedFieldSchema.parse(raw);
    return Response.json({ field });
  } catch (err) {
    console.error('[derived-fields] PATCH error:', err);
    return Response.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id } = z.object({ id: z.string().uuid() }).parse(body);
    await deleteDerivedField(id);
    return Response.json({ success: true });
  } catch (err) {
    console.error('[derived-fields] DELETE error:', err);
    return Response.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 });
  }
}
