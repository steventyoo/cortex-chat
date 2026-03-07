// Daily Note API — log-based daily notes with version history.
// GET: fetch all notes for a project (log format)
// POST: create or update a note (saves version before update)
// DELETE: soft-delete a note (saves version snapshot)

import { NextRequest } from 'next/server';
import { fetchTable, createRecord, updateRecord } from '@/lib/airtable';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';

export const maxDuration = 15;

/* ── Helpers ─────────────────────────────────────────────── */
function todayStr() {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

// Save a snapshot of the note before modifying it
async function saveVersion(
  noteId: string,
  fields: Record<string, unknown>,
  changeType: 'edit' | 'delete',
  changedBy: string
) {
  try {
    await createRecord('DAILY_NOTE_VERSIONS', {
      'Note Record ID': noteId,
      'Previous Content': fields['Content'] || '',
      'Previous Crew Count': fields['Crew Count'] ?? null,
      'Previous Weather': fields['Weather'] || '',
      'Changed By': changedBy,
      'Changed At': new Date().toISOString(),
      'Change Type': changeType,
    });
  } catch (err) {
    // Version logging is best-effort — don't block the main operation
    console.error('Failed to save note version:', err);
  }
}

/* ── GET: Fetch notes for a project ─────────────────────── */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const projectId = req.nextUrl.searchParams.get('projectId');
  const date = req.nextUrl.searchParams.get('date');
  const mode = req.nextUrl.searchParams.get('mode') || 'log'; // 'log' (all) or 'single' (one date)

  if (!projectId) {
    return Response.json({ error: 'projectId required' }, { status: 400 });
  }

  try {
    // Build filter: always filter by project, optionally by date
    let filter: string;
    if (mode === 'single' && date) {
      filter = `AND({Project ID}='${projectId}', {Date}='${date}', {Status}!='deleted')`;
    } else {
      filter = `AND({Project ID}='${projectId}', {Status}!='deleted')`;
    }

    const records = await fetchTable('DAILY_NOTES', filter);

    // Map and sort by date descending (most recent first)
    const notes = records
      .map((rec) => ({
        id: rec.id,
        content: String(rec.fields['Content'] || ''),
        crewCount: rec.fields['Crew Count'] != null ? Number(rec.fields['Crew Count']) : null,
        weather: rec.fields['Weather'] ? String(rec.fields['Weather']) : null,
        authorName: String(rec.fields['Author Name'] || ''),
        authorEmail: String(rec.fields['Author Email'] || ''),
        date: String(rec.fields['Date'] || ''),
        createdAt: String(rec.fields['Created At'] || ''),
        updatedAt: String(rec.fields['Updated At'] || ''),
      }))
      .sort((a, b) => {
        // Sort by date descending, then by createdAt descending
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return b.createdAt.localeCompare(a.createdAt);
      });

    // For backward compat: if mode=single, return first note as 'note'
    if (mode === 'single') {
      return Response.json({ note: notes[0] || null, notes });
    }

    return Response.json({ notes });
  } catch (err) {
    console.error('Daily note GET error:', err);
    return Response.json({ notes: [], note: null });
  }
}

/* ── POST: Create or update a note ──────────────────────── */
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

    // Update existing note — save version first
    if (noteId) {
      // Fetch current state to save as version
      try {
        const existing = await fetchTable(
          'DAILY_NOTES',
          `RECORD_ID()='${noteId}'`
        );
        if (existing.length > 0) {
          await saveVersion(noteId, existing[0].fields, 'edit', session.email);
        }
      } catch {
        // Best-effort version save
      }

      const updated = await updateRecord('DAILY_NOTES', noteId, {
        'Content': content.trim(),
        'Crew Count': crewCount ?? null,
        'Weather': weather || null,
        'Updated At': new Date().toISOString(),
      });

      if (!updated) {
        return Response.json({ error: 'Failed to update note' }, { status: 500 });
      }

      return Response.json({
        success: true,
        note: {
          id: noteId,
          content: content.trim(),
          crewCount: crewCount ?? null,
          weather: weather || null,
          authorName: session.name || session.email,
          authorEmail: session.email,
          date,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
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
      'Crew Count': crewCount ?? null,
      'Weather': weather || null,
      'Status': 'active',
      'Created At': new Date().toISOString(),
      'Updated At': new Date().toISOString(),
    });

    if (!record) {
      return Response.json({ error: 'Failed to save note. Make sure DAILY_NOTES table exists in Airtable.' }, { status: 500 });
    }

    return Response.json({
      success: true,
      note: {
        id: record.id,
        content: content.trim(),
        crewCount: crewCount ?? null,
        weather: weather || null,
        authorName: session.name || session.email,
        authorEmail: session.email,
        date,
        createdAt: new Date().toISOString(),
        updatedAt: '',
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

/* ── DELETE: Soft-delete a note ──────────────────────────── */
export async function DELETE(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { noteId } = body;

    if (!noteId) {
      return Response.json({ error: 'noteId required' }, { status: 400 });
    }

    // Fetch current state to save as version
    try {
      const existing = await fetchTable(
        'DAILY_NOTES',
        `RECORD_ID()='${noteId}'`
      );
      if (existing.length > 0) {
        await saveVersion(noteId, existing[0].fields, 'delete', session.email);
      }
    } catch {
      // Best-effort version save
    }

    // Soft delete: mark as deleted
    const updated = await updateRecord('DAILY_NOTES', noteId, {
      'Status': 'deleted',
      'Updated At': new Date().toISOString(),
    });

    if (!updated) {
      return Response.json({ error: 'Failed to delete note' }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error('Daily note DELETE error:', err);
    return Response.json(
      { error: 'Failed to delete note', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 }
    );
  }
}
