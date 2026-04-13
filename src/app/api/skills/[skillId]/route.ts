import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { z } from 'zod';
import { SkillSchema, SkillVersionSchema } from '@/lib/schemas/skills.schema';
import {
  getSkillById,
  listSkillVersions,
  updateSkill,
  upsertSkillVersion,
  replaceSkillFields,
} from '@/lib/stores/skills.store';
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

  try {
    const raw = await getSkillById(skillId);
    if (!raw) {
      return Response.json({ error: 'Skill not found' }, { status: 404 });
    }
    const skill = SkillSchema.parse(raw);

    const rawVersions = await listSkillVersions(skillId);
    const versions = z.array(SkillVersionSchema).parse(rawVersions);

    return Response.json({ skill, versions });
  } catch (err) {
    console.error('[skills/:id] GET error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { skillId } = await params;

  let existing;
  try {
    existing = await getSkillById(skillId);
  } catch {
    return Response.json({ error: 'Skill not found' }, { status: 404 });
  }
  if (!existing) {
    return Response.json({ error: 'Skill not found' }, { status: 404 });
  }

  let body: {
    displayName?: string;
    fieldDefinitions?: FieldDefinition[];
    status?: string;
    classifierHints?: { description: string; keywords: string[] };
    addFields?: FieldDefinition[];
    removeFields?: string[];
    systemPrompt?: string;
    extractionInstructions?: string;
    referenceDocIds?: string[];
    sampleExtractions?: Array<{ inputSnippet: string; expectedOutput: Record<string, unknown> }>;
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

    await replaceSkillFields(skillId, currentFieldDefs);
  }

  if (body.displayName) updateFields.display_name = body.displayName;
  if (body.status) updateFields.status = body.status;
  if (body.classifierHints) updateFields.classifier_hints = body.classifierHints;
  if (body.systemPrompt !== undefined) updateFields.system_prompt = body.systemPrompt;
  if (body.extractionInstructions !== undefined) updateFields.extraction_instructions = body.extractionInstructions;
  if (body.referenceDocIds !== undefined) updateFields.reference_doc_ids = body.referenceDocIds;
  if (body.sampleExtractions !== undefined) updateFields.sample_extractions = body.sampleExtractions;

  try {
    const raw = await updateSkill(skillId, updateFields);
    const data = SkillSchema.parse(raw);

    const newVersion = data.version || 1;
    const changedKeys = Object.keys(updateFields).filter(k => k !== 'updated_at' && k !== 'version');
    await upsertSkillVersion({
      skill_id: skillId,
      version: newVersion,
      snapshot: {
        display_name: data.display_name,
        system_prompt: data.system_prompt,
        extraction_instructions: data.extraction_instructions,
        field_definitions: data.field_definitions,
        classifier_hints: data.classifier_hints,
        sample_extractions: data.sample_extractions,
        reference_doc_ids: data.reference_doc_ids,
        status: data.status,
      },
      changed_by: session.email,
      change_summary: `Updated: ${changedKeys.join(', ')}`,
    });

    return Response.json({ skill: data });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[skills/:id] PATCH error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
}
