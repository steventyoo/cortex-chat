// Daily Staffing API — track hours per worker per day.
// GET: fetch staffing entries for a project (optionally filtered by date)
// POST: batch save staffing entries for a date (totalHours auto-splits into reg/OT at 8hr threshold)
// DELETE: remove a staffing entry

import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

/* ── GET: Fetch staffing entries ──────────────────────── */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const projectId = req.nextUrl.searchParams.get('projectId');
  const date = req.nextUrl.searchParams.get('date');
  const summary = req.nextUrl.searchParams.get('summary') === 'true';

  if (!projectId) {
    return Response.json({ error: 'projectId required' }, { status: 400 });
  }

  try {
    const sb = getSupabase();

    // Summary mode: aggregate totals across all dates
    if (summary) {
      const { data, error } = await sb
        .from('daily_staffing')
        .select('*')
        .eq('project_id', projectId)
        .order('staff_date', { ascending: false });

      if (error) {
        console.error('Staffing summary error:', error.message);
        return Response.json({ summary: null });
      }

      const rows = data || [];
      let totalRegHours = 0;
      let totalOtHours = 0;
      const byDate: Record<string, { regHours: number; otHours: number; headcount: number }> = {};

      for (const row of rows) {
        const reg = Number(row.regular_hours) || 0;
        const ot = Number(row.ot_hours) || 0;

        totalRegHours += reg;
        totalOtHours += ot;

        const d = String(row.staff_date);
        if (!byDate[d]) byDate[d] = { regHours: 0, otHours: 0, headcount: 0 };
        byDate[d].regHours += reg;
        byDate[d].otHours += ot;
        byDate[d].headcount += 1;
      }

      const workDays = Object.keys(byDate).length;

      return Response.json({
        summary: {
          totalRegHours,
          totalOtHours,
          workDays,
          otPercent: (totalRegHours + totalOtHours) > 0
            ? Math.round((totalOtHours / (totalRegHours + totalOtHours)) * 100)
            : 0,
          byDate,
        },
      });
    }

    // Normal mode: entries for a specific date
    let query = sb
      .from('daily_staffing')
      .select('*')
      .eq('project_id', projectId);

    if (date) {
      query = query.eq('staff_date', date);
    }

    const { data, error } = await query
      .order('staff_date', { ascending: false })
      .order('worker_name', { ascending: true });

    if (error) {
      console.error('Staffing GET error:', error.message);
      return Response.json({ entries: [] });
    }

    const entries = (data || []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      workerName: String(row.worker_name || ''),
      role: String(row.role || ''),
      totalHours: (Number(row.regular_hours) || 0) + (Number(row.ot_hours) || 0),
      regularHours: row.regular_hours != null ? Number(row.regular_hours) : 0,
      otHours: row.ot_hours != null ? Number(row.ot_hours) : 0,
      date: String(row.staff_date || ''),
    }));

    return Response.json({ entries });
  } catch (err) {
    console.error('Staffing GET error:', err);
    return Response.json({ entries: [] });
  }
}

/* ── POST: Batch save staffing entries for a date ─────── */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { projectId, date, entries } = body;
    const staffDate = date || todayStr();

    if (!projectId || !Array.isArray(entries)) {
      return Response.json({ error: 'projectId and entries[] required' }, { status: 400 });
    }

    const sb = getSupabase();

    // Delete existing entries for this project+date, then re-insert
    await sb
      .from('daily_staffing')
      .delete()
      .eq('project_id', projectId)
      .eq('staff_date', staffDate);

    // Filter out rows with no hours
    const validEntries = entries.filter(
      (e: Record<string, unknown>) =>
        e.workerName && String(e.workerName).trim() &&
        (Number(e.totalHours) || 0) > 0
    );

    if (validEntries.length === 0) {
      return Response.json({ success: true, saved: 0 });
    }

    // Auto-split: >8 hrs = OT
    const rows = validEntries.map((e: Record<string, unknown>) => {
      const total = Number(e.totalHours) || 0;
      const reg = Math.min(total, 8);
      const ot = Math.max(total - 8, 0);
      return {
        project_id: projectId,
        org_id: session.orgId,
        staff_date: staffDate,
        worker_name: String(e.workerName).trim(),
        role: String(e.role || '').trim(),
        regular_hours: reg,
        ot_hours: ot,
        hourly_rate: 0,
        entered_by: session.email,
        created_at: new Date().toISOString(),
      };
    });

    const { error } = await sb.from('daily_staffing').insert(rows);

    if (error) {
      console.error('Staffing POST error:', error.message);
      return Response.json({ error: 'Failed to save staffing' }, { status: 500 });
    }

    return Response.json({ success: true, saved: rows.length });
  } catch (err) {
    console.error('Staffing POST error:', err);
    return Response.json(
      { error: 'Failed to save', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 }
    );
  }
}

/* ── DELETE: Remove a single staffing entry ───────────── */
export async function DELETE(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { entryId } = body;

    if (!entryId) {
      return Response.json({ error: 'entryId required' }, { status: 400 });
    }

    const sb = getSupabase();
    const { error } = await sb.from('daily_staffing').delete().eq('id', entryId);

    if (error) {
      return Response.json({ error: 'Failed to delete' }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error('Staffing DELETE error:', err);
    return Response.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
