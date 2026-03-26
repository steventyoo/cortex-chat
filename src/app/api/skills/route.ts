import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';
import { FieldDefinition } from '@/lib/skills';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getSupabase();
  const statusFilter = request.nextUrl.searchParams.get('status') || 'active';

  let query = sb.from('document_skills').select('*');
  if (statusFilter !== 'all') {
    query = query.eq('status', statusFilter);
  }
  query = query.order('display_name', { ascending: true });

  const { data, error } = await query;
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ skills: data || [] });
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    skillId: string;
    displayName: string;
    fieldDefinitions: FieldDefinition[];
    targetTable?: string;
    status?: string;
  };

  try {
    body = await request.json();
    if (!body.skillId || !body.displayName || !body.fieldDefinitions) {
      return Response.json(
        { error: 'skillId, displayName, and fieldDefinitions are required' },
        { status: 400 }
      );
    }
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const sb = getSupabase();
  const skillId = body.skillId.toLowerCase().replace(/[^a-z0-9_]/g, '_');

  const { data: existing } = await sb
    .from('document_skills')
    .select('id')
    .eq('skill_id', skillId)
    .single();

  if (existing) {
    return Response.json(
      { error: `Skill "${skillId}" already exists` },
      { status: 409 }
    );
  }

  const columnMapping: Record<string, string> = {};
  for (const field of body.fieldDefinitions) {
    columnMapping[field.name] = field.name
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .toLowerCase();
  }

  const systemPrompt = [
    `You are a construction document data extraction AI specialized in ${body.displayName} documents.`,
    '',
    'Rules:',
    '- Extract ONLY what is explicitly stated. Never infer or fabricate.',
    '- Assign confidence scores: 0.95-1.0 = clearly stated, 0.80-0.94 = likely correct, 0.60-0.79 = uncertain, below 0.60 = low confidence.',
    '- If a field cannot be found, set value to null and confidence to 0.0.',
    '- For dollar amounts, extract as numbers (no $ sign).',
    '- For dates, use ISO format (YYYY-MM-DD).',
    '- For percentages, extract as decimal (84.5 not 0.845).',
    '',
    'Response format: valid JSON only (no markdown, no explanation).',
    '{',
    `  "documentType": "${body.displayName}",`,
    '  "documentTypeConfidence": 0.95,',
    '  "fields": { "fieldName": { "value": "...", "confidence": 0.95 } }',
    '}',
  ].join('\n');

  const classifierHints = {
    description: `${body.displayName} document`,
    keywords: body.fieldDefinitions.slice(0, 5).map(f => f.name),
  };

  const { data, error } = await sb
    .from('document_skills')
    .insert({
      skill_id: skillId,
      display_name: body.displayName,
      version: 1,
      status: body.status || 'active',
      system_prompt: systemPrompt,
      field_definitions: body.fieldDefinitions,
      target_table: body.targetTable || 'extracted_records',
      column_mapping: columnMapping,
      sample_extractions: [],
      classifier_hints: classifierHints,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create skill:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ skill: data }, { status: 201 });
}
