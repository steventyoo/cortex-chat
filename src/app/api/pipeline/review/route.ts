import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getSupabase, pushToExtractedRecords, checkDuplicatePipeline, syncProjectMetadata } from '@/lib/supabase';
import { ExtractionResult, ReviewAction } from '@/lib/pipeline';
import { getSkill, recordCorrection } from '@/lib/skills';
import { embedAndStoreForRecord } from '@/lib/embeddings';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let recordId: string;
  let action: ReviewAction;
  let reviewer: string;
  let notes: string;
  let rejectionReason: string;
  let editedFields: Record<string, unknown> | null;
  let testMode: boolean;

  try {
    const body = await request.json();
    recordId = body.recordId;
    action = body.action;
    reviewer = body.reviewer || 'Admin';
    notes = body.notes || '';
    rejectionReason = body.rejectionReason || '';
    editedFields = body.editedFields || null;
    testMode = body.testMode === true;

    if (!recordId || !action) {
      return Response.json({ error: 'recordId and action are required' }, { status: 400 });
    }
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const sb = getSupabase();

  try {
    const { data: record, error: getError } = await sb
      .from('pipeline_log')
      .select('*')
      .eq('id', recordId)
      .eq('org_id', session.orgId)
      .single();

    if (getError || !record) {
      return Response.json({ error: 'Pipeline record not found' }, { status: 404 });
    }

    const updateFields: Record<string, unknown> = {
      status: action === 'rejected' ? 'rejected' : 'approved',
      reviewer,
      review_action: action,
      reviewed_at: now,
    };

    if (notes) updateFields.review_notes = notes;
    if (rejectionReason) updateFields.rejection_reason = rejectionReason;

    if (action === 'edited' && editedFields) {
      updateFields.review_edits = editedFields;
      updateFields.status = 'approved';

      try {
        const extractedData: ExtractionResult = typeof record.extracted_data === 'string'
          ? JSON.parse(record.extracted_data)
          : record.extracted_data;

        // Record the correction for the feedback loop (non-blocking)
        try {
          const skillId = extractedData.skillId
            || extractedData.documentType.toLowerCase().replace(/\s+/g, '_');

          await recordCorrection(
            skillId,
            recordId,
            extractedData as unknown as Record<string, unknown>,
            editedFields,
            (record.source_text || '').substring(0, 1500)
          );
        } catch (err) {
          console.error('Failed to record correction:', err);
        }

        for (const [key, value] of Object.entries(editedFields)) {
          extractedData.fields[key] = {
            value: value as string | number | null,
            confidence: 1.0,
          };
        }
        updateFields.extracted_data = extractedData;
      } catch { /* keep existing extracted data */ }
    }

    await sb.from('pipeline_log').update(updateFields).eq('id', recordId);

    let pushedRecordId: string | null = null;
    let alreadyPushed = false;

    if ((action === 'approved' || action === 'edited') && !testMode) {
      try {
        if (record.pushed_record_ids) {
          alreadyPushed = true;
          console.warn(`Pipeline ${recordId} already pushed (record: ${record.pushed_record_ids}). Skipping push.`);
        }

        if (!alreadyPushed) {
          const isDuplicate = await checkDuplicatePipeline(
            record.file_url || null,
            record.file_name || null,
            record.project_id || null,
            recordId
          );
          if (isDuplicate) {
            alreadyPushed = true;
            console.warn(`File "${record.file_name}" was already pushed. Skipping push.`);
          }
        }

        if (!alreadyPushed) {
          const extractedData: ExtractionResult = action === 'edited' && updateFields.extracted_data
            ? updateFields.extracted_data as ExtractionResult
            : (typeof record.extracted_data === 'string'
              ? JSON.parse(record.extracted_data)
              : record.extracted_data);

          const skillId = extractedData.skillId
            || extractedData.documentType.toLowerCase().replace(/\s+/g, '_');
          const skill = await getSkill(skillId);

          const projectId = record.project_id || '';
          const orgId = record.org_id || '';

          const singleFields: Record<string, { value: string | number | null; confidence: number }> = {};
          for (const [fieldName, fieldData] of Object.entries(extractedData.fields)) {
            singleFields[fieldName] = fieldData;
          }

          const existingPending = await sb
            .from('extracted_records')
            .select('id')
            .eq('pipeline_log_id', recordId)
            .maybeSingle();

          let erRecordId: string | null = null;

          if (existingPending.data?.id) {
            erRecordId = String(existingPending.data.id);
            await sb.from('extracted_records').update({
              fields: Object.fromEntries(
                Object.entries(singleFields).map(([k, v]) => [k, { value: v.value, confidence: v.confidence }])
              ),
              status: 'approved',
              updated_at: new Date().toISOString(),
            }).eq('id', erRecordId);
          } else {
            erRecordId = await pushToExtractedRecords({
              projectId,
              orgId,
              skillId,
              skillVersion: skill?.version || 1,
              pipelineLogId: recordId,
              documentType: extractedData.documentType,
              sourceFile: record.file_name || undefined,
              fields: singleFields,
              rawText: record.source_text || undefined,
              overallConfidence: extractedData.documentTypeConfidence,
              status: 'approved',
            });
          }

          if (erRecordId) {
            pushedRecordId = erRecordId;
            await sb.from('pipeline_log').update({
              status: 'pushed',
              pushed_record_ids: erRecordId,
              pushed_at: new Date().toISOString(),
              review_notes: (notes ? notes + '\n' : '') +
                `Pushed to extracted_records.`,
            }).eq('id', recordId);

            embedAndStoreForRecord(
              erRecordId,
              extractedData.documentType,
              singleFields,
              record.source_text || undefined,
            ).catch(err => console.error('Async embedding failed:', err));

            syncProjectMetadata(projectId, skillId, singleFields)
              .catch(err => console.error('Async project metadata sync failed:', err));
          }
        }
      } catch (err) {
        console.error('Error pushing data:', err);
      }
    }

    return Response.json({
      success: true,
      action,
      recordId,
      pushedRecordId,
      testMode,
      alreadyPushed,
      status: testMode
        ? 'approved (test mode — not pushed)'
        : alreadyPushed
          ? 'approved (already pushed — skipped duplicate)'
          : pushedRecordId ? 'pushed' : action === 'rejected' ? 'rejected' : 'approved',
    });
  } catch (err) {
    console.error('Review error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
