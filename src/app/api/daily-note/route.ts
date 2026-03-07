// Daily Note API — save and retrieve PM daily notes per project per day.

import { NextRequest } from 'next/server';
import { fetchTable, createRecord, updateRecord } from '@/lib/airtable';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';

export const maxDuration = 15;

function todayStr() {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const projectId = req.nextUrl.searchParams.get('projectId');
  const date = req.nextUrl.searchParams.get('date') || todayStr();

  if (!projectId) {
    return Response.json({ error: 'projectId required' }, { status: 400 });
  }

  try {
    const records = await fetchTable(
      'DAILY_NOTES',
      `AND({Project ID}='${projectId}', {Date}='${date}')`
    );

    if (records.length === 0) {
      return Response.json({ note: null });
    }

    // Return the most recent note for this project+date
    const rec = records[0];
    return Response.json({
      note: {
        id: rec.id,
        content: String(rec.fields['Content'] || ''),
        crewCount: rec.fields['Crew Count'] != null ? Number(rec.fields['Crew Count']) : null,
        weather: rec.fields['Weather'] ? String(rec.fields['Weather']) : null,
        authorName: String(rec.fields['Author Name'] || ''),
        authorEmail: String(rec.fields['Author Email'] || ''),
        createdAt: String(rec.fields['Created At'] || ''),
      },
    });
  } catch (err) {
    console.error('Daily note GET error:', err);
    return Response.json({ note: null });
  }
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { projectId, content, crewCount, weather, noteId } = body;
    const date = body.date || todayStr();

    if (!projectId || !content?.trim()) {
      return Response.json({ error: 'projectId and content required' }, { status: 400 });
    }

    // Update existing note
    if (noteId) {
      const updated = await updateRecord('DAILY_NOTES', noteId, {
        'Content': content.trim(),
        'Crew Count': crewCount || null,
        'Weather': weather || null,
      });

      if (!updated) {
        return Response.json({ error: 'Failed to update note' }, { status: 500 });
      }

      return Response.json({
        success: true,
        note: {
          id: noteId,
          content: content.trim(),
          crewCount: crewCount || null,
          weather: weather || null,
          authorName: session.name || session.email,
          authorEmail: session.email,
          createdAt: new Date().toISOString(),
        },
      });
    }

    // Create new note
    const record = await createRecord('DAILY_NOTES', {
      'Project ID': projectId,
      'Organization ID': session.orgId,
      'Date': date,
      'Author Email': session.email,
      'Author Name': session.name || session.email,
      'Content': content.trim(),
      'Crew Count': crewCount || null,
      'Weather': weather || null,
      'Created At': new Date().toISOString(),
    });

    if (!record) {
      return Response.json({ error: 'Failed to save note. Make sure DAILY_NOTES table exists in Airtable.' }, { status: 500 });
    }

    return Response.json({
      success: true,
      note: {
        id: record.id,
        content: content.trim(),
        crewCount: crewCount || null,
        weather: weather || null,
        authorName: session.name || session.email,
        authorEmail: session.email,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Daily note POST error:', err);
    return Response.json(
      { error: 'Failed to save note', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 }
    );
  }
}
