import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getSupabase, pushRecordsToTable, pushToExtractedRecords, checkDuplicatePipeline } from '@/lib/supabase';
import { ExtractionResult, ReviewAction } from '@/lib/pipeline';
import { getSkill, recordCorrection } from '@/lib/skills';
import { embedAndStoreForRecord } from '@/lib/embeddings';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
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

          // Look up the skill to get target table and column mapping
          const skillId = extractedData.skillId
            || extractedData.documentType.toLowerCase().replace(/\s+/g, '_');
          const skill = await getSkill(skillId);

          const targetTable = skill?.targetTable || 'documents';
          const columnMapping = skill?.columnMapping;
          const projectId = record.project_id || '';
          const orgId = record.org_id || '';
          const allPushedIds: string[] = [];

          if (extractedData.records && extractedData.records.length > 0) {
            console.log(`Pushing ${extractedData.records.length} records to ${targetTable}`);
            const ids = await pushRecordsToTable(targetTable, projectId, orgId, extractedData.records, columnMapping);
            allPushedIds.push(...ids);
          }

          if (extractedData.targetTables && extractedData.targetTables.length > 0) {
            for (const tt of extractedData.targetTables) {
              if (tt.records && tt.records.length > 0) {
                console.log(`Pushing ${tt.records.length} records to ${tt.table}`);
                const ids = await pushRecordsToTable(tt.table, projectId, orgId, tt.records, columnMapping);
                allPushedIds.push(...ids);
              }
            }
          }

          if (!extractedData.records || extractedData.records.length === 0) {
            const singleRecord: Record<string, { value: string | number | null; confidence: number }> = {};
            for (const [fieldName, fieldData] of Object.entries(extractedData.fields)) {
              if (fieldData.value !== null) {
                singleRecord[fieldName] = fieldData;
              }
            }
            const ids = await pushRecordsToTable(targetTable, projectId, orgId, [singleRecord], columnMapping);
            allPushedIds.push(...ids);
          }

          if (allPushedIds.length > 0) {
            pushedRecordId = allPushedIds.join(',');
            await sb.from('pipeline_log').update({
              status: 'pushed',
              pushed_record_ids: pushedRecordId,
              pushed_at: new Date().toISOString(),
              review_notes: (notes ? notes + '\n' : '') +
                `Pushed ${allPushedIds.length} record(s) to database.`,
            }).eq('id', recordId);
          }

          // Dual-write to extracted_records for unified storage
          try {
            const singleFields: Record<string, { value: string | number | null; confidence: number }> = {};
            for (const [fieldName, fieldData] of Object.entries(extractedData.fields)) {
              singleFields[fieldName] = fieldData;
            }
            await pushToExtractedRecords({
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
            }).then(async (erRecordId) => {
              if (erRecordId) {
                embedAndStoreForRecord(
                  erRecordId,
                  extractedData.documentType,
                  singleFields,
                  record.source_text || undefined,
                ).catch(err => console.error('Async embedding failed:', err));
              }
            });
          } catch (erErr) {
            console.error('Dual-write to extracted_records failed:', erErr);
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
