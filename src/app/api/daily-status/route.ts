// Daily Status API — check if daily notes & staffing have been submitted today per project.
// GET: returns { status: { [projectId]: { hasNotes: bool, hasStaffing: bool } } }

import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const date = req.nextUrl.searchParams.get('date') || new Date().toISOString().split('T')[0];

  try {
    const sb = getSupabase();

    // Fetch daily notes for today across all org projects
    const { data: notes } = await sb
      .from('daily_notes')
      .select('project_id')
      .eq('org_id', session.orgId)
      .eq('note_date', date)
      .eq('status', 'active');

    // Fetch daily staffing entries for today across all org projects
    const { data: staffing } = await sb
      .from('daily_staffing')
      .select('project_id')
      .eq('org_id', session.orgId)
      .eq('staff_date', date);

    const noteProjects = new Set((notes || []).map((n) => n.project_id));
    const staffingProjects = new Set((staffing || []).map((s) => s.project_id));

    // Get all active projects for the org
    const { data: projects } = await sb
      .from('projects')
      .select('project_id')
      .eq('org_id', session.orgId);

    const status: Record<string, { hasNotes: boolean; hasStaffing: boolean }> = {};
    for (const p of projects || []) {
      const pid = String(p.project_id);
      status[pid] = {
        hasNotes: noteProjects.has(pid),
        hasStaffing: staffingProjects.has(pid),
      };
    }

    return Response.json({ status, date });
  } catch (err) {
    console.error('Daily status error:', err);
    return Response.json({ status: {} });
  }
}
