import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';
import { FieldDefinition } from '@/lib/skills';

interface RouteParams {
  params: Promise<{ skillId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { skillId } = await params;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('document_skills')
    .select('*')
    .eq('skill_id', skillId)
    .single();

  if (error || !data) {
    return Response.json({ error: 'Skill not found' }, { status: 404 });
  }

  return Response.json({ skill: data });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { skillId } = await params;
  const sb = getSupabase();

  const { data: existing, error: fetchErr } = await sb
    .from('document_skills')
    .select('*')
    .eq('skill_id', skillId)
    .single();

  if (fetchErr || !existing) {
    return Response.json({ error: 'Skill not found' }, { status: 404 });
  }

  let body: {
    displayName?: string;
    fieldDefinitions?: FieldDefinition[];
    status?: string;
    classifierHints?: { description: string; keywords: string[] };
    addFields?: FieldDefinition[];
    removeFields?: string[];
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const updateFields: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  let currentFieldDefs = (existing.field_definitions as FieldDefinition[]) || [];

  if (body.removeFields && body.removeFields.length > 0) {
    const removeSet = new Set(body.removeFields);
    currentFieldDefs = currentFieldDefs.filter(f => !removeSet.has(f.name));
    updateFields.version = (existing.version || 1) + 1;
  }

  if (body.addFields && body.addFields.length > 0) {
    const existingNames = new Set(currentFieldDefs.map(f => f.name));
    for (const newField of body.addFields) {
      if (!existingNames.has(newField.name)) {
        currentFieldDefs.push(newField);
      }
    }
    updateFields.version = (existing.version || 1) + 1;
  }

  if (body.fieldDefinitions) {
    currentFieldDefs = body.fieldDefinitions;
    updateFields.version = (existing.version || 1) + 1;
  }

  if (body.removeFields || body.addFields || body.fieldDefinitions) {
    updateFields.field_definitions = currentFieldDefs;

    const columnMapping: Record<string, string> = {};
    for (const field of currentFieldDefs) {
      columnMapping[field.name] = field.name
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, '_')
        .toLowerCase();
    }
    updateFields.column_mapping = columnMapping;
  }

  if (body.displayName) updateFields.display_name = body.displayName;
  if (body.status) updateFields.status = body.status;
  if (body.classifierHints) updateFields.classifier_hints = body.classifierHints;

  const { data, error } = await sb
    .from('document_skills')
    .update(updateFields)
    .eq('skill_id', skillId)
    .select()
    .single();

  if (error) {
    console.error('Failed to update skill:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ skill: data });
}
