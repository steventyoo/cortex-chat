import { NextRequest } from 'next/server';
import { validateToken, SESSION_COOKIE } from '@/lib/auth';
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

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  // Auth check
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateToken(token))) {
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
    if ((action === 'approved' || action === 'edited') && !testMode) {
      try {
        const extractedData: ExtractionResult = JSON.parse(
          action === 'edited' && updateFields['Extracted Data']
            ? String(updateFields['Extracted Data'])
            : fields['Extracted Data']
        );

        const targetTable = DOC_TYPE_TO_TABLE[extractedData.documentType] || 'DOCUMENTS';
        const projectId = fields['Project ID'];

        // Build the fields for the target table
        const targetFields: Record<string, unknown> = {
          'Project ID': projectId,
        };

        // Map extracted fields to Airtable fields
        for (const [fieldName, fieldData] of Object.entries(extractedData.fields)) {
          if (fieldData.value !== null) {
            targetFields[fieldName] = fieldData.value;
          }
        }

        // Create record in target table
        const pushRes = await fetch(`${BASE_URL}/${getBaseId()}/${encodeURIComponent(targetTable)}`, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({
            records: [{ fields: targetFields }],
          }),
        });

        if (pushRes.ok) {
          const pushData = await pushRes.json();
          pushedRecordId = pushData.records?.[0]?.id;

          // Update pipeline record with pushed info
          await fetch(`${BASE_URL}/${getBaseId()}/PIPELINE_LOG/${recordId}`, {
            method: 'PATCH',
            headers: getHeaders(),
            body: JSON.stringify({
              fields: {
                'Status': 'pushed',
                'Airtable Record IDs': pushedRecordId,
                'Pushed At': new Date().toISOString(),
              },
            }),
          });
        } else {
          const errText = await pushRes.text();
          console.error('Failed to push to target table:', errText);
          // Still keep as approved even if push failed
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
      status: testMode
        ? 'approved (test mode — not pushed)'
        : pushedRecordId ? 'pushed' : action === 'rejected' ? 'rejected' : 'approved',
    });
  } catch (err) {
    console.error('Review error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
