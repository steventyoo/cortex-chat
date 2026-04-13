import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { z } from 'zod';
import {
  SkillFieldSchema,
  CreateSkillFieldInput,
  UpdateSkillFieldInput,
} from '@/lib/schemas/field-catalog.schema';
import {
  listSkillFields,
  getNextSortOrder,
  insertSkillField,
  updateSkillField,
  deleteSkillField,
} from '@/lib/stores/field-catalog.store';

interface RouteParams {
  params: Promise<{ skillId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { skillId } = await params;

  try {
    const raw = await listSkillFields(skillId);
    const fields = z.array(SkillFieldSchema).parse(raw);
    return Response.json({ fields });
  } catch (err) {
    console.error('[skill-fields] GET validation/query error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { skillId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = CreateSkillFieldInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const input = parsed.data;

  try {
    const nextOrder = await getNextSortOrder(skillId);
    const raw = await insertSkillField({
      skill_id: skillId,
      field_id: input.fieldId,
      display_override: input.displayOverride || null,
      tier: input.tier ?? 1,
      required: input.required ?? false,
      importance: input.importance || 'E',
      description: input.description || '',
      options: input.options || null,
      example: input.example || '',
      extraction_hint: input.extractionHint || null,
      disambiguation_rules: input.disambiguationRules || null,
      sort_order: nextOrder,
    });
    const field = SkillFieldSchema.parse(raw);
    return Response.json({ field }, { status: 201 });
  } catch (err: unknown) {
    const pgErr = err as { code?: string; message?: string };
    if (pgErr.code === '23505') {
      return Response.json({ error: 'Field already assigned to this skill' }, { status: 409 });
    }
    console.error('[skill-fields] POST error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { skillId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = UpdateSkillFieldInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const updateFields: Record<string, unknown> = {};
  if (input.displayOverride !== undefined) updateFields.display_override = input.displayOverride;
  if (input.tier !== undefined) updateFields.tier = input.tier;
  if (input.required !== undefined) updateFields.required = input.required;
  if (input.importance !== undefined) updateFields.importance = input.importance;
  if (input.description !== undefined) updateFields.description = input.description;
  if (input.options !== undefined) updateFields.options = input.options;
  if (input.example !== undefined) updateFields.example = input.example;
  if (input.extractionHint !== undefined) updateFields.extraction_hint = input.extractionHint;
  if (input.disambiguationRules !== undefined) updateFields.disambiguation_rules = input.disambiguationRules;
  if (input.sortOrder !== undefined) updateFields.sort_order = input.sortOrder;

  if (Object.keys(updateFields).length === 0) {
    return Response.json({ error: 'No fields to update' }, { status: 400 });
  }

  try {
    const raw = await updateSkillField(input.id, skillId, updateFields);
    const field = SkillFieldSchema.parse(raw);
    return Response.json({ field });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[skill-fields] PATCH error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { skillId } = await params;
  const skillFieldId = request.nextUrl.searchParams.get('id');
  if (!skillFieldId) {
    return Response.json({ error: 'id query param is required' }, { status: 400 });
  }

  try {
    await deleteSkillField(skillFieldId, skillId);
    return Response.json({ success: true });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[skill-fields] DELETE error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
}
