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

  // Fetch version history
  const { data: versions } = await sb
    .from('skill_version_history')
    .select('version, change_summary, changed_by, created_at')
    .eq('skill_id', skillId)
    .order('version', { ascending: false })
    .limit(50);

  return Response.json({ skill: data, versions: versions || [] });
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

    // Sync to skill_fields (catalog-based): full replace
    await sb.from('skill_fields').delete().eq('skill_id', skillId);
    for (let i = 0; i < currentFieldDefs.length; i++) {
      const fd = currentFieldDefs[i];
      const canonical = fd.name
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, '_')
        .toLowerCase()
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');

      let catalogId: string | null = null;
      const { data: catRow } = await sb
        .from('field_catalog')
        .select('id')
        .eq('canonical_name', canonical)
        .single();

      if (catRow) {
        catalogId = catRow.id;
      } else {
        const { data: created } = await sb
          .from('field_catalog')
          .insert({
            canonical_name: canonical,
            display_name: fd.name,
            field_type: fd.type || 'string',
            category: 'general',
            description: fd.description || '',
            enum_options: fd.options || null,
          })
          .select('id')
          .single();
        catalogId = created?.id ?? null;
      }

      if (catalogId) {
        await sb.from('skill_fields').insert({
          skill_id: skillId,
          field_id: catalogId,
          display_override: fd.name,
          tier: fd.tier ?? 1,
          required: fd.required ?? false,
          importance: fd.importance || null,
          description: fd.description || '',
          options: fd.options || null,
          extraction_hint: fd.disambiguationRules || null,
          disambiguation_rules: fd.disambiguationRules || null,
          sort_order: i + 1,
        });
      }
    }
  }

  if (body.displayName) updateFields.display_name = body.displayName;
  if (body.status) updateFields.status = body.status;
  if (body.classifierHints) updateFields.classifier_hints = body.classifierHints;
  if (body.systemPrompt !== undefined) updateFields.system_prompt = body.systemPrompt;
  if (body.extractionInstructions !== undefined) updateFields.extraction_instructions = body.extractionInstructions;
  if (body.referenceDocIds !== undefined) updateFields.reference_doc_ids = body.referenceDocIds;
  if (body.sampleExtractions !== undefined) updateFields.sample_extractions = body.sampleExtractions;

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

  // Save version snapshot for history/rollback
  const newVersion = data.version || 1;
  const changedKeys = Object.keys(updateFields).filter(k => k !== 'updated_at' && k !== 'version');
  await sb.from('skill_version_history').upsert({
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
  }, { onConflict: 'skill_id,version' });

  return Response.json({ skill: data });
}
