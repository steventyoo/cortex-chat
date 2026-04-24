import { NextRequest } from 'next/server';
import { z } from 'zod';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import {
  ConsistencyCheckSchema,
  CreateConsistencyCheckInput,
  UpdateConsistencyCheckInput,
} from '@/lib/schemas/consistency-checks.schema';
import {
  listConsistencyChecks,
  insertConsistencyCheck,
  updateConsistencyCheck,
  deleteConsistencyCheck,
} from '@/lib/stores/consistency-checks.store';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const skillId = request.nextUrl.searchParams.get('skill_id') || undefined;

  try {
    const raw = await listConsistencyChecks({ skillId });
    const checks = z.array(ConsistencyCheckSchema).parse(raw);
    return Response.json({ checks });
  } catch (err) {
    console.error('[consistency-checks] GET error:', err);
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
    const parsed = CreateConsistencyCheckInput.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const raw = await insertConsistencyCheck(parsed.data);
    const check = ConsistencyCheckSchema.parse(raw);
    return Response.json({ check });
  } catch (err) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '23505') {
      return Response.json({ error: 'A check with that name already exists for this skill' }, { status: 409 });
    }
    console.error('[consistency-checks] POST error:', err);
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
    const parsed = UpdateConsistencyCheckInput.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { id, ...updates } = parsed.data;
    const raw = await updateConsistencyCheck(id, updates);
    const check = ConsistencyCheckSchema.parse(raw);
    return Response.json({ check });
  } catch (err) {
    console.error('[consistency-checks] PATCH error:', err);
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
    await deleteConsistencyCheck(id);
    return Response.json({ success: true });
  } catch (err) {
    console.error('[consistency-checks] DELETE error:', err);
    return Response.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 });
  }
}
