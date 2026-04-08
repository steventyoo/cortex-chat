import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getSupabase, pushToExtractedRecords } from '@/lib/supabase';
import { embedAndStoreForRecord } from '@/lib/embeddings';
import { ExtractionResult } from '@/lib/pipeline';
import { getSkill } from '@/lib/skills';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let projectId: string;
  try {
    const body = await request.json();
    projectId = body.projectId;
    if (!projectId) {
      return Response.json({ error: 'projectId is required' }, { status: 400 });
    }
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const orgId = session.orgId;
  const sb = getSupabase();

  const { data: records, error: fetchErr } = await sb
    .from('pipeline_log')
    .select('id, extracted_data, source_text, file_name, project_id, org_id')
    .eq('project_id', projectId)
    .eq('org_id', orgId)
    .is('pushed_record_ids', null)
    .not('extracted_data', 'is', null)
    .neq('status', 'rejected');

  if (fetchErr) {
    return Response.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!records || records.length === 0) {
    return Response.json({ embedded: 0, skipped: 0, message: 'No un-pushed pipeline records found for this project' });
  }

  let embedded = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const record of records) {
    try {
      const extractedData: ExtractionResult = typeof record.extracted_data === 'string'
        ? JSON.parse(record.extracted_data)
        : record.extracted_data;

      if (!extractedData?.fields) {
        skipped++;
        continue;
      }

      const skillId = extractedData.skillId
        || extractedData.documentType?.toLowerCase().replace(/\s+/g, '_')
        || 'unknown';
      const skill = await getSkill(skillId);

      const singleFields: Record<string, { value: string | number | null; confidence: number }> = {};
      for (const [fieldName, fieldData] of Object.entries(extractedData.fields)) {
        singleFields[fieldName] = fieldData;
      }

      const existing = await sb
        .from('extracted_records')
        .select('id')
        .eq('pipeline_log_id', record.id)
        .maybeSingle();

      let erRecordId: string | null = null;

      if (existing.data?.id) {
        erRecordId = String(existing.data.id);
      } else {
        erRecordId = await pushToExtractedRecords({
          projectId: record.project_id || projectId,
          orgId: record.org_id || orgId,
          skillId,
          skillVersion: skill?.version || 1,
          pipelineLogId: record.id,
          documentType: extractedData.documentType,
          sourceFile: record.file_name || undefined,
          fields: singleFields,
          rawText: record.source_text || undefined,
          overallConfidence: extractedData.documentTypeConfidence,
          status: 'pending',
        });
      }

      if (erRecordId) {
        await embedAndStoreForRecord(
          erRecordId,
          extractedData.documentType,
          singleFields,
          record.source_text || undefined,
        );
        embedded++;
      } else {
        skipped++;
      }
    } catch (err) {
      errors.push(`Record ${record.id}: ${err instanceof Error ? err.message : String(err)}`);
      skipped++;
    }
  }

  return Response.json({
    embedded,
    skipped,
    total: records.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
