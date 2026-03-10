// Staff Roster API — manage org-wide crew members (name, role, email, mobile).
// GET: fetch roster (org-wide or project-scoped)
// POST: add or update a roster entry
// DELETE: deactivate a roster entry

import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';

const ROLE_ORDER = ['Foreman', 'Journeyman', 'Apprentice', 'Laborer', 'Helper'];

/* ── GET: Fetch roster ───────────────────────────────── */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const scope = req.nextUrl.searchParams.get('scope'); // 'org' = all active for the org

  try {
    const sb = getSupabase();
    let query = sb
      .from('staff_roster')
      .select('*')
      .eq('is_active', true)
      .eq('org_id', session.orgId)
      .order('role', { ascending: true })
      .order('worker_name', { ascending: true });

    // If not org scope, filter by projectId
    if (scope !== 'org') {
      const projectId = req.nextUrl.searchParams.get('projectId');
      if (!projectId) {
        return Response.json({ error: 'projectId required (or use scope=org)' }, { status: 400 });
      }
      query = query.eq('project_id', projectId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Roster GET error:', error.message);
      return Response.json({ roster: [] });
    }

    const roster = (data || []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      workerName: String(row.worker_name || ''),
      role: String(row.role || ''),
      email: String(row.email || ''),
      mobile: String(row.mobile || ''),
    }));

    // Sort by rank order (Foreman > Journeyman > ... > Helper), then alphabetically by name
    roster.sort((a, b) => {
      const rankA = ROLE_ORDER.indexOf(a.role);
      const rankB = ROLE_ORDER.indexOf(b.role);
      const rA = rankA === -1 ? 999 : rankA;
      const rB = rankB === -1 ? 999 : rankB;
      if (rA !== rB) return rA - rB;
      return a.workerName.localeCompare(b.workerName);
    });

    return Response.json({ roster });
  } catch (err) {
    console.error('Roster GET error:', err);
    return Response.json({ roster: [] });
  }
}

/* ── POST: Add or update a roster entry ───────────────── */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { workerName, role, rosterId, email, mobile, projectId } = body;

    if (!workerName?.trim() || !role?.trim()) {
      return Response.json({ error: 'workerName and role required' }, { status: 400 });
    }

    const sb = getSupabase();

    // Update existing
    if (rosterId) {
      const updateFields: Record<string, unknown> = {
        worker_name: workerName.trim(),
        role: role.trim(),
        updated_at: new Date().toISOString(),
      };
      if (email !== undefined) updateFields.email = email.trim();
      if (mobile !== undefined) updateFields.mobile = mobile.trim();

      const { error } = await sb.from('staff_roster').update(updateFields).eq('id', rosterId);

      if (error) {
        return Response.json({ error: 'Failed to update roster entry' }, { status: 500 });
      }

      return Response.json({ success: true, id: rosterId });
    }

    // Check for duplicate (same name anywhere in the org)
    const targetProject = projectId || 'org';
    const { data: existing } = await sb
      .from('staff_roster')
      .select('id, project_id')
      .eq('org_id', session.orgId)
      .eq('worker_name', workerName.trim())
      .eq('is_active', true)
      .limit(1);

    if (existing && existing.length > 0) {
      // If adding to a specific project and worker exists, assign them to that project
      if (projectId && projectId !== 'org') {
        const { error: assignErr } = await sb.from('staff_roster').update({
          project_id: projectId,
          updated_at: new Date().toISOString(),
        }).eq('id', existing[0].id);

        if (assignErr) {
          return Response.json({ error: 'Failed to assign crew to project' }, { status: 500 });
        }
        return Response.json({ success: true, id: String(existing[0].id) });
      }

      // Otherwise it's a true duplicate — reject
      return Response.json(
        { error: `${workerName.trim()} already exists in the roster` },
        { status: 409 }
      );
    }

    // Create new — org-level or project-specific roster entry
    const { data: record, error } = await sb.from('staff_roster').insert({
      project_id: targetProject,
      org_id: session.orgId,
      worker_name: workerName.trim(),
      role: role.trim(),
      email: (email || '').trim(),
      mobile: (mobile || '').trim(),
      hourly_rate: null,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).select('id').single();

    if (error || !record) {
      return Response.json({ error: 'Failed to add roster entry' }, { status: 500 });
    }

    return Response.json({ success: true, id: String(record.id) });
  } catch (err) {
    console.error('Roster POST error:', err);
    return Response.json(
      { error: 'Failed to save', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 }
    );
  }
}

/* ── DELETE: Deactivate a roster entry ────────────────── */
export async function DELETE(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { rosterId } = body;

    if (!rosterId) {
      return Response.json({ error: 'rosterId required' }, { status: 400 });
    }

    const sb = getSupabase();
    const { error } = await sb.from('staff_roster').update({
      is_active: false,
      updated_at: new Date().toISOString(),
    }).eq('id', rosterId);

    if (error) {
      return Response.json({ error: 'Failed to remove roster entry' }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error('Roster DELETE error:', err);
    return Response.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
