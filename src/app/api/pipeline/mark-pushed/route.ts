import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';

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

/**
 * Mark a pipeline record as "pushed" without actually creating records
 * in target tables. Used when data was already manually pushed to Airtable.
 */
export async function POST(request: NextRequest) {
  // Auth check
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { recordId } = await request.json();

    if (!recordId) {
      return Response.json({ error: 'recordId is required' }, { status: 400 });
    }

    // Update the pipeline record status to 'pushed' with a note
    const res = await fetch(
      `${BASE_URL}/${getBaseId()}/PIPELINE_LOG/${recordId}`,
      {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({
          fields: {
            'Status': 'pushed',
            'Review Action': 'approved',
            'Reviewer': 'Admin',
            'Reviewed At': new Date().toISOString(),
            'Pushed At': new Date().toISOString(),
            'Review Notes': 'Marked as already pushed — data was manually entered to Airtable prior to pipeline setup.',
          },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error('Airtable update error:', errText);
      return Response.json({ error: 'Failed to update record' }, { status: 500 });
    }

    return Response.json({ success: true, recordId, status: 'pushed' });
  } catch (err) {
    console.error('Mark pushed error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
