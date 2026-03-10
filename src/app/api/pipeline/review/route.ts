import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getSupabase, pushRecordsToTable, checkDuplicatePipeline } from '@/lib/supabase';
import { DOC_TYPE_TO_TABLE, ExtractionResult, ReviewAction } from '@/lib/pipeline';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // Auth check
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
    // 1. Get the current pipeline record
    const { data: record, error: getError } = await sb
      .from('pipeline_log')
      .select('*')
      .eq('id', recordId)
      .single();

    if (getError || !record) {
      return Response.json({ error: 'Pipeline record not found' }, { status: 404 });
    }

    // 2. Update pipeline record with review action
    const updateFields: Record<string, unknown> = {
      status: action === 'rejected' ? 'rejected' : 'approved',
      reviewer,
      review_action: action,
      reviewed_at: now,
    };

    if (notes) updateFields.review_notes = notes;
    if (rejectionReason) updateFields.rejection_reason = rejectionReason;

    // If edited, store the edits and update extracted data
    if (action === 'edited' && editedFields) {
      updateFields.review_edits = editedFields;
      updateFields.status = 'approved';

      try {
        const extractedData: ExtractionResult = typeof record.extracted_data === 'string'
          ? JSON.parse(record.extracted_data)
          : record.extracted_data;

        for (const [key, value] of Object.entries(editedFields)) {
          if (extractedData.fields[key]) {
            extractedData.fields[key] = {
              value: value as string | number | null,
              confidence: 1.0,
            };
          } else {
            extractedData.fields[key] = {
              value: value as string | number | null,
              confidence: 1.0,
            };
          }
        }
        updateFields.extracted_data = extractedData;
      } catch { /* keep existing extracted data */ }
    }

    await sb.from('pipeline_log').update(updateFields).eq('id', recordId);

    // 3. If approved, push data to the appropriate Supabase table
    let pushedRecordId: string | null = null;
    let alreadyPushed = false;

    if ((action === 'approved' || action === 'edited') && !testMode) {
      try {
        // ── DUPLICATE PUSH SAFEGUARD ──

        // Check 1: Was THIS record already pushed?
        if (record.pushed_record_ids) {
          alreadyPushed = true;
          console.warn(`Pipeline ${recordId} already pushed (record: ${record.pushed_record_ids}). Skipping push.`);
        }

        // Check 2 & 3: Is there another pipeline entry for the same file that was already pushed?
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

          const targetTable = DOC_TYPE_TO_TABLE[extractedData.documentType] || 'DOCUMENTS';
          const projectId = record.project_id || '';
          const orgId = record.org_id || '';
          const allPushedIds: string[] = [];

          // Push multi-record extraction
          if (extractedData.records && extractedData.records.length > 0) {
            console.log(`Pushing ${extractedData.records.length} records to ${targetTable}`);
            const ids = await pushRecordsToTable(targetTable, projectId, orgId, extractedData.records);
            allPushedIds.push(...ids);
          }

          // Push to additional target tables
          if (extractedData.targetTables && extractedData.targetTables.length > 0) {
            for (const tt of extractedData.targetTables) {
              if (tt.records && tt.records.length > 0) {
                console.log(`Pushing ${tt.records.length} records to ${tt.table}`);
                const ids = await pushRecordsToTable(tt.table, projectId, orgId, tt.records);
                allPushedIds.push(...ids);
              }
            }
          }

          // Push single-record summary fields (if no multi-record)
          if (!extractedData.records || extractedData.records.length === 0) {
            const singleRecord: Record<string, { value: string | number | null; confidence: number }> = {};
            for (const [fieldName, fieldData] of Object.entries(extractedData.fields)) {
              if (fieldData.value !== null) {
                singleRecord[fieldName] = fieldData;
              }
            }
            const ids = await pushRecordsToTable(targetTable, projectId, orgId, [singleRecord]);
            allPushedIds.push(...ids);
          }

          // Update pipeline record with all pushed record IDs
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
