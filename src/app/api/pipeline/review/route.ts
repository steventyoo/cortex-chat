import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { DOC_TYPE_TO_TABLE, ExtractionResult, ReviewAction } from '@/lib/pipeline';

const BASE_URL = 'https://api.airtable.com/v0';

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_PAT}`,
    'Content-Type': 'application/json',
  };
}

function getBaseId() {
  return process.env.AIRTABLE_BASE_ID || '';
}

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
    action = body.action; // 'approved' | 'rejected' | 'edited'
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

  try {
    // 1. Get the current pipeline record
    const getRes = await fetch(
      `${BASE_URL}/${getBaseId()}/PIPELINE_LOG/${recordId}`,
      { headers: getHeaders() }
    );

    if (!getRes.ok) {
      return Response.json({ error: 'Pipeline record not found' }, { status: 404 });
    }

    const record = await getRes.json();
    const fields = record.fields;

    // 2. Update pipeline record with review action
    const updateFields: Record<string, unknown> = {
      'Status': action === 'rejected' ? 'rejected' : 'approved',
      'Reviewer': reviewer,
      'Review Action': action,
      'Reviewed At': now,
    };

    if (notes) updateFields['Review Notes'] = notes;
    if (rejectionReason) updateFields['Rejection Reason'] = rejectionReason;

    // If edited, store the edits and update extracted data
    if (action === 'edited' && editedFields) {
      updateFields['Review Edits'] = JSON.stringify(editedFields);
      updateFields['Status'] = 'approved'; // edited = approved with changes

      // Merge edits into extracted data
      try {
        const extractedData: ExtractionResult = JSON.parse(fields['Extracted Data']);
        for (const [key, value] of Object.entries(editedFields)) {
          if (extractedData.fields[key]) {
            extractedData.fields[key] = {
              value: value as string | number | null,
              confidence: 1.0, // Human-verified = 100% confidence
            };
          } else {
            extractedData.fields[key] = {
              value: value as string | number | null,
              confidence: 1.0,
            };
          }
        }
        updateFields['Extracted Data'] = JSON.stringify(extractedData);
      } catch { /* keep existing extracted data */ }
    }

    await fetch(`${BASE_URL}/${getBaseId()}/PIPELINE_LOG/${recordId}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ fields: updateFields }),
    });

    // 3. If approved, push data to the appropriate Airtable table
    //    UNLESS testMode is on — then skip the push and just keep status as 'approved'
    let pushedRecordId: string | null = null;
    let alreadyPushed = false;

    if ((action === 'approved' || action === 'edited') && !testMode) {
      try {
        // ── DUPLICATE PUSH SAFEGUARD ──
        // Check 1: Was THIS record already pushed? (has Airtable Record IDs)
        if (fields['Airtable Record IDs']) {
          alreadyPushed = true;
          console.warn(`Pipeline ${recordId} already pushed (record: ${fields['Airtable Record IDs']}). Skipping push.`);
        }

        // Check 2: Is there another PIPELINE_LOG entry for the same file that was already pushed?
        if (!alreadyPushed && fields['File URL']) {
          const dupCheckRes = await fetch(
            `${BASE_URL}/${getBaseId()}/PIPELINE_LOG?` +
              new URLSearchParams({
                filterByFormula: `AND({File URL}='${String(fields['File URL']).replace(/'/g, "\\'")}',{Status}='pushed',RECORD_ID()!='${recordId}')`,
                pageSize: '1',
              }),
            { headers: getHeaders() }
          );
          if (dupCheckRes.ok) {
            const dupData = await dupCheckRes.json();
            if (dupData.records && dupData.records.length > 0) {
              alreadyPushed = true;
              console.warn(`File "${fields['File Name']}" was already pushed by pipeline ${dupData.records[0].fields['Pipeline ID']}. Skipping push.`);
            }
          }
        }

        // Check 3: Is there another PIPELINE_LOG entry for the same filename + project that was pushed?
        if (!alreadyPushed && fields['File Name'] && fields['Project ID']) {
          const nameCheckRes = await fetch(
            `${BASE_URL}/${getBaseId()}/PIPELINE_LOG?` +
              new URLSearchParams({
                filterByFormula: `AND({File Name}='${String(fields['File Name']).replace(/'/g, "\\'")}',{Project ID}='${String(fields['Project ID']).replace(/'/g, "\\'")}',{Status}='pushed',RECORD_ID()!='${recordId}')`,
                pageSize: '1',
              }),
            { headers: getHeaders() }
          );
          if (nameCheckRes.ok) {
            const nameData = await nameCheckRes.json();
            if (nameData.records && nameData.records.length > 0) {
              alreadyPushed = true;
              console.warn(`File "${fields['File Name']}" for project "${fields['Project ID']}" was already pushed. Skipping push.`);
            }
          }
        }

        if (alreadyPushed) {
          // Mark as approved but DON'T push — data already exists
          // The status was already set to 'approved' in step 2
        } else {
          const extractedData: ExtractionResult = JSON.parse(
            action === 'edited' && updateFields['Extracted Data']
              ? String(updateFields['Extracted Data'])
              : fields['Extracted Data']
          );

          const targetTable = DOC_TYPE_TO_TABLE[extractedData.documentType] || 'DOCUMENTS';
          const projectId = fields['Project ID'];
          const allPushedIds: string[] = [];

          // ── HELPER: Push batch of records to a table (max 10 per Airtable API call) ──
          async function pushRecordsToTable(
            table: string,
            records: Array<Record<string, { value: string | number | null; confidence: number }>>
          ): Promise<string[]> {
            const ids: string[] = [];
            // Airtable allows max 10 records per POST
            for (let i = 0; i < records.length; i += 10) {
              const batch = records.slice(i, i + 10);
              const airtableRecords = batch.map((rec) => {
                const recFields: Record<string, unknown> = { 'Project ID': projectId };
                for (const [fieldName, fieldData] of Object.entries(rec)) {
                  if (fieldData.value !== null) {
                    recFields[fieldName] = fieldData.value;
                  }
                }
                return { fields: recFields };
              });

              const pushRes = await fetch(
                `${BASE_URL}/${getBaseId()}/${encodeURIComponent(table)}`,
                {
                  method: 'POST',
                  headers: getHeaders(),
                  body: JSON.stringify({ records: airtableRecords }),
                }
              );

              if (pushRes.ok) {
                const pushData = await pushRes.json();
                for (const r of pushData.records || []) {
                  if (r.id) ids.push(r.id);
                }
              } else {
                const errText = await pushRes.text();
                console.error(`Failed to push batch to ${table}:`, errText);
              }

              // Small delay between batches to avoid rate limits
              if (i + 10 < records.length) {
                await new Promise((resolve) => setTimeout(resolve, 200));
              }
            }
            return ids;
          }

          // ── Push multi-record extraction (records array → primary target table) ──
          if (extractedData.records && extractedData.records.length > 0) {
            console.log(`Pushing ${extractedData.records.length} records to ${targetTable}`);
            const ids = await pushRecordsToTable(targetTable, extractedData.records);
            allPushedIds.push(...ids);
          }

          // ── Push to additional target tables (e.g., PRODUCTION from a Job Cost Report) ──
          if (extractedData.targetTables && extractedData.targetTables.length > 0) {
            for (const tt of extractedData.targetTables) {
              if (tt.records && tt.records.length > 0) {
                console.log(`Pushing ${tt.records.length} records to ${tt.table}`);
                const ids = await pushRecordsToTable(tt.table, tt.records);
                allPushedIds.push(...ids);
              }
            }
          }

          // ── Push single-record summary fields (if no multi-record, or as supplement) ──
          if (!extractedData.records || extractedData.records.length === 0) {
            // Traditional single-record push
            const targetFields: Record<string, unknown> = {
              'Project ID': projectId,
            };
            for (const [fieldName, fieldData] of Object.entries(extractedData.fields)) {
              if (fieldData.value !== null) {
                targetFields[fieldName] = fieldData.value;
              }
            }
            const pushRes = await fetch(
              `${BASE_URL}/${getBaseId()}/${encodeURIComponent(targetTable)}`,
              {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ records: [{ fields: targetFields }] }),
              }
            );
            if (pushRes.ok) {
              const pushData = await pushRes.json();
              const id = pushData.records?.[0]?.id;
              if (id) allPushedIds.push(id);
            } else {
              const errText = await pushRes.text();
              console.error('Failed to push to target table:', errText);
            }
          }

          // ── Update pipeline record with all pushed record IDs ──
          if (allPushedIds.length > 0) {
            pushedRecordId = allPushedIds.join(',');
            await fetch(`${BASE_URL}/${getBaseId()}/PIPELINE_LOG/${recordId}`, {
              method: 'PATCH',
              headers: getHeaders(),
              body: JSON.stringify({
                fields: {
                  'Status': 'pushed',
                  'Airtable Record IDs': pushedRecordId,
                  'Pushed At': new Date().toISOString(),
                  'Review Notes': (notes ? notes + '\n' : '') +
                    `Pushed ${allPushedIds.length} record(s) to Airtable.`,
                },
              }),
            });
          }
        }
      } catch (err) {
        console.error('Error pushing data to Airtable:', err);
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
