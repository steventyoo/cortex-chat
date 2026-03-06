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
 * DELETE handler — soft-deletes a pipeline record by setting status to 'deleted'.
 * This keeps the File URL in the database so the Drive scanner won't re-import the file.
 * Requires valid session.
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

    // Soft-delete: set status to 'deleted' instead of actually removing from Airtable.
    // This preserves the File URL so the Drive scanner won't re-import the same file.
    const res = await fetch(
      `${BASE_URL}/${getBaseId()}/PIPELINE_LOG/${recordId}`,
      {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({
          fields: {
            'Status': 'deleted',
            'Review Notes': `Soft-deleted by user at ${new Date().toISOString()}`,
          },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error('Airtable soft-delete error:', errText);
      return Response.json({ error: 'Failed to delete record' }, { status: 500 });
    }

    return Response.json({ success: true, deleted: recordId });
  } catch (err) {
    console.error('Pipeline delete error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
