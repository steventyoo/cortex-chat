import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { z } from 'zod';
import {
  CatalogFieldSchema,
  CatalogFieldWithUsageSchema,
  CreateCatalogFieldInput,
  UpdateCatalogFieldInput,
} from '@/lib/schemas/field-catalog.schema';
import {
  listCatalogFields,
  getFieldUsageCounts,
  insertCatalogField,
  updateCatalogField,
} from '@/lib/stores/field-catalog.store';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const category = request.nextUrl.searchParams.get('category') || undefined;
  const withUsage = request.nextUrl.searchParams.get('withUsage') === 'true';

  try {
    const raw = await listCatalogFields({ category });

    if (withUsage) {
      const countMap = await getFieldUsageCounts();
      const enriched = raw.map(f => ({ ...f, usage_count: countMap.get(f.id) || 0 }));
      const fields = z.array(CatalogFieldWithUsageSchema).parse(enriched);
      return Response.json({ fields });
    }

    const fields = z.array(CatalogFieldSchema).parse(raw);
    return Response.json({ fields });
  } catch (err) {
    console.error('[field-catalog] GET validation/query error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = CreateCatalogFieldInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { canonicalName, displayName, fieldType, category, description, enumOptions } = parsed.data;
  const canonical = canonicalName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .trim();

  try {
    const data = await insertCatalogField({
      canonical_name: canonical,
      display_name: displayName,
      field_type: fieldType,
      category,
      description,
      enum_options: enumOptions ?? null,
    });
    const field = CatalogFieldSchema.parse(data);
    return Response.json({ field }, { status: 201 });
  } catch (err: unknown) {
    const pgErr = err as { code?: string; message?: string };
    if (pgErr.code === '23505') {
      return Response.json({ error: `Field "${canonical}" already exists` }, { status: 409 });
    }
    console.error('[field-catalog] POST error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = UpdateCatalogFieldInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { id, displayName, fieldType, category, description, enumOptions } = parsed.data;
  const update: Record<string, unknown> = {};
  if (displayName !== undefined) update.display_name = displayName;
  if (fieldType !== undefined) update.field_type = fieldType;
  if (category !== undefined) update.category = category;
  if (description !== undefined) update.description = description;
  if (enumOptions !== undefined) update.enum_options = enumOptions;

  try {
    const data = await updateCatalogField(id, update);
    const field = CatalogFieldSchema.parse(data);
    return Response.json({ field });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[field-catalog] PATCH error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
}
