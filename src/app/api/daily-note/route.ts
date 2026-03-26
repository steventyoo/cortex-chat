// Daily Note API — log-based daily notes with version history.
// GET: fetch all notes for a project (log format)
// POST: create or update a note (saves version before update)
// DELETE: soft-delete a note (saves version snapshot)

import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { fetchWeather } from '@/lib/weather';

export const maxDuration = 15;

/* ── Helpers ─────────────────────────────────────────────── */
function todayStr() {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

// Save a snapshot of the note before modifying it
async function saveVersion(
  noteId: string,
  row: Record<string, unknown>,
  changeType: 'edit' | 'delete',
  changedBy: string
) {
  const sb = getSupabase();
  try {
    await sb.from('daily_note_versions').insert({
      note_id: noteId,
      previous_content: row.content || '',
      previous_crew_count: row.crew_count ?? null,
      previous_weather: row.weather || '',
      changed_by: changedBy,
      changed_at: new Date().toISOString(),
      change_type: changeType,
    });
  } catch (err) {
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
  const mode = req.nextUrl.searchParams.get('mode') || 'log';

  if (!projectId) {
    return Response.json({ error: 'projectId required' }, { status: 400 });
  }

  try {
    const sb = getSupabase();
    let query = sb.from('daily_notes').select('*')
      .eq('project_id', projectId)
      .eq('org_id', session.orgId)
      .neq('status', 'deleted');

    if (mode === 'single' && date) {
      query = query.eq('note_date', date);
    }

    const { data, error } = await query.order('note_date', { ascending: false }).order('created_at', { ascending: false });

    if (error) {
      console.error('Daily note GET error:', error.message);
      return Response.json({ notes: [], note: null });
    }

    const notes = (data || []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      content: String(row.content || ''),
      crewCount: row.crew_count != null ? Number(row.crew_count) : null,
      weather: row.weather ? String(row.weather) : null,
      productionData: row.production_data || null,
      authorName: String(row.author_name || ''),
      authorEmail: String(row.author_email || ''),
      date: String(row.note_date || ''),
      createdAt: String(row.created_at || ''),
      updatedAt: String(row.updated_at || ''),
    }));

    // Fetch weather for this project if requested
    let currentWeather: string | null = null;
    if (req.nextUrl.searchParams.get('includeWeather') === 'true') {
      try {
        const { data: project } = await sb
          .from('projects')
          .select('latitude, longitude')
          .eq('project_id', projectId)
          .single();
        if (project?.latitude && project?.longitude) {
          const wx = await fetchWeather(Number(project.latitude), Number(project.longitude));
          if (wx) currentWeather = wx.summary;
        }
      } catch { /* best-effort */ }
    }

    if (mode === 'single') {
      return Response.json({ note: notes[0] || null, notes, currentWeather });
    }

    return Response.json({ notes, currentWeather });
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
    const { projectId, content, crewCount, weather, noteId, productionData } = body;
    const date = body.date || todayStr();

    if (!projectId || !content?.trim()) {
      return Response.json({ error: 'projectId and content required' }, { status: 400 });
    }

    const sb = getSupabase();

    // Update existing note
    if (noteId) {
      // Fetch current state to save as version
      try {
        const { data: existing } = await sb.from('daily_notes').select('*').eq('id', noteId).eq('org_id', session.orgId).single();
        if (existing) {
          await saveVersion(noteId, existing, 'edit', session.email);
        }
      } catch { /* Best-effort version save */ }

      const { error } = await sb.from('daily_notes').update({
        content: content.trim(),
        crew_count: crewCount ?? null,
        weather: weather || null,
        production_data: productionData || null,
        updated_at: new Date().toISOString(),
      }).eq('id', noteId).eq('org_id', session.orgId);

      if (error) {
        console.error('Daily note UPDATE error:', error?.message, error?.details, error?.hint);
        return Response.json({ error: error?.message || 'Failed to update note' }, { status: 500 });
      }

      return Response.json({
        success: true,
        note: {
          id: noteId,
          content: content.trim(),
          crewCount: crewCount ?? null,
          weather: weather || null,
          productionData: productionData || null,
          authorName: session.name || session.email,
          authorEmail: session.email,
          date,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
    }

    // Auto-fetch weather if not provided by user
    let resolvedWeather = weather || null;
    if (!resolvedWeather) {
      try {
        const { data: project } = await sb
          .from('projects')
          .select('latitude, longitude')
          .eq('project_id', projectId)
          .single();
        if (project?.latitude && project?.longitude) {
          const wx = await fetchWeather(Number(project.latitude), Number(project.longitude));
          if (wx) resolvedWeather = wx.summary;
        }
      } catch { /* Weather is best-effort */ }
    }

    // Create new note
    const { data: record, error } = await sb.from('daily_notes').insert({
      project_id: projectId,
      org_id: session.orgId,
      note_date: date,
      author_email: session.email,
      author_name: session.name || session.email,
      content: content.trim(),
      crew_count: crewCount ?? null,
      weather: resolvedWeather,
      production_data: productionData || null,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).select('id').single();

    if (error || !record) {
      console.error('Daily note INSERT error:', error?.message, error?.details, error?.hint);
      return Response.json({ error: error?.message || 'Failed to save note.' }, { status: 500 });
    }

    return Response.json({
      success: true,
      note: {
        id: String(record.id),
        content: content.trim(),
        crewCount: crewCount ?? null,
        weather: resolvedWeather,
        productionData: productionData || null,
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

    const sb = getSupabase();

    // Fetch current state to save as version
    try {
      const { data: existing } = await sb.from('daily_notes').select('*').eq('id', noteId).eq('org_id', session.orgId).single();
      if (existing) {
        await saveVersion(noteId, existing, 'delete', session.email);
      }
    } catch { /* Best-effort version save */ }

    // Soft delete: mark as deleted
    const { error } = await sb.from('daily_notes').update({
      status: 'deleted',
      updated_at: new Date().toISOString(),
    }).eq('id', noteId).eq('org_id', session.orgId);

    if (error) {
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
