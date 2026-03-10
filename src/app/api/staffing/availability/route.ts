// Staff Availability API — manage time-off, holidays, PTO per crew member.
// GET: fetch availability for a date range
// POST: set availability status for a crew member on a date
// DELETE: remove an availability override (revert to default available)

import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';

// Status types: available, pto, holiday, sick, no_show, leave
const VALID_STATUSES = ['available', 'pto', 'holiday', 'sick', 'no_show', 'leave'];

/* ── GET: Fetch availability ────────────────────────── */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startDate = req.nextUrl.searchParams.get('startDate');
  const endDate = req.nextUrl.searchParams.get('endDate');
  const rosterId = req.nextUrl.searchParams.get('rosterId');

  if (!startDate || !endDate) {
    return Response.json({ error: 'startDate and endDate required' }, { status: 400 });
  }

  try {
    const sb = getSupabase();
    let query = sb
      .from('staff_availability')
      .select('*')
      .eq('org_id', session.orgId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });

    if (rosterId) {
      query = query.eq('roster_id', rosterId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Availability GET error:', error.message);
      return Response.json({ entries: [] });
    }

    const entries = (data || []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      rosterId: String(row.roster_id),
      date: String(row.date),
      status: String(row.status || 'available'),
      note: String(row.note || ''),
    }));

    return Response.json({ entries });
  } catch (err) {
    console.error('Availability GET error:', err);
    return Response.json({ entries: [] });
  }
}

/* ── POST: Set availability ──────────────────────────── */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { entries } = body; // Array of { rosterId, date, status, note? }

    if (!Array.isArray(entries) || entries.length === 0) {
      return Response.json({ error: 'entries[] required' }, { status: 400 });
    }

    const sb = getSupabase();
    let saved = 0;

    for (const entry of entries) {
      const { rosterId, date, status, note } = entry;

      if (!rosterId || !date || !status) continue;
      if (!VALID_STATUSES.includes(status)) continue;

      // If status is 'available', delete the override (available is default)
      if (status === 'available') {
        await sb.from('staff_availability')
          .delete()
          .eq('roster_id', rosterId)
          .eq('date', date);
        saved++;
        continue;
      }

      // Upsert: insert or update on (roster_id, date) unique constraint
      const { error } = await sb.from('staff_availability').upsert(
        {
          roster_id: rosterId,
          org_id: session.orgId,
          date,
          status,
          note: note || '',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'roster_id,date' }
      );

      if (error) {
        console.error('Availability upsert error:', error.message);
      } else {
        saved++;
      }
    }

    return Response.json({ success: true, saved });
  } catch (err) {
    console.error('Availability POST error:', err);
    return Response.json({ error: 'Failed to save' }, { status: 500 });
  }
}

/* ── DELETE: Remove availability entry ────────────────── */
export async function DELETE(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { id, rosterId, date } = body;

    const sb = getSupabase();

    if (id) {
      await sb.from('staff_availability').delete().eq('id', id);
    } else if (rosterId && date) {
      await sb.from('staff_availability').delete().eq('roster_id', rosterId).eq('date', date);
    } else {
      return Response.json({ error: 'id or (rosterId + date) required' }, { status: 400 });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error('Availability DELETE error:', err);
    return Response.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
