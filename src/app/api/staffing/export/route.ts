// Staffing CSV Export — download all employee hours for payroll.
// GET: returns CSV file with all staffing entries filtered by date range and optional projectId.
// Query params: startDate, endDate (YYYY-MM-DD), projectId (optional)

import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startDate = req.nextUrl.searchParams.get('startDate');
  const endDate = req.nextUrl.searchParams.get('endDate');
  const projectId = req.nextUrl.searchParams.get('projectId');

  if (!startDate || !endDate) {
    return Response.json({ error: 'startDate and endDate required' }, { status: 400 });
  }

  try {
    const sb = getSupabase();

    let query = sb
      .from('daily_staffing')
      .select('*')
      .eq('org_id', session.orgId)
      .gte('staff_date', startDate)
      .lte('staff_date', endDate)
      .order('staff_date', { ascending: true })
      .order('worker_name', { ascending: true });

    if (projectId) {
      query = query.eq('project_id', projectId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Staffing export error:', error.message);
      return Response.json({ error: 'Failed to export' }, { status: 500 });
    }

    const rows = data || [];

    // Build CSV
    const headers = ['Date', 'Employee', 'Position', 'Project', 'Total Hours', 'Regular Hours', 'OT Hours', 'Entered By', 'Timestamp'];
    const csvLines = [headers.join(',')];

    for (const row of rows) {
      const reg = Number(row.regular_hours) || 0;
      const ot = Number(row.ot_hours) || 0;
      const total = reg + ot;
      const line = [
        String(row.staff_date),
        `"${String(row.worker_name || '').replace(/"/g, '""')}"`,
        `"${String(row.role || '').replace(/"/g, '""')}"`,
        `"${String(row.project_id || '').replace(/"/g, '""')}"`,
        total.toFixed(2),
        reg.toFixed(2),
        ot.toFixed(2),
        `"${String(row.entered_by || '').replace(/"/g, '""')}"`,
        `"${String(row.created_at || '').replace(/"/g, '""')}"`,
      ].join(',');
      csvLines.push(line);
    }

    // Add summary section
    csvLines.push('');
    csvLines.push('--- SUMMARY ---');

    // Per-employee totals
    const byEmployee: Record<string, { reg: number; ot: number; days: Set<string> }> = {};
    for (const row of rows) {
      const name = String(row.worker_name || 'Unknown');
      if (!byEmployee[name]) byEmployee[name] = { reg: 0, ot: 0, days: new Set() };
      byEmployee[name].reg += Number(row.regular_hours) || 0;
      byEmployee[name].ot += Number(row.ot_hours) || 0;
      byEmployee[name].days.add(String(row.staff_date));
    }

    csvLines.push('');
    csvLines.push('Employee,Days Worked,Total Reg Hours,Total OT Hours,Total Hours');
    for (const [name, totals] of Object.entries(byEmployee)) {
      csvLines.push([
        `"${name}"`,
        totals.days.size,
        totals.reg.toFixed(2),
        totals.ot.toFixed(2),
        (totals.reg + totals.ot).toFixed(2),
      ].join(','));
    }

    const csv = csvLines.join('\n');
    const filename = `payroll_${startDate}_to_${endDate}.csv`;

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error('Staffing export error:', err);
    return Response.json({ error: 'Failed to export' }, { status: 500 });
  }
}
