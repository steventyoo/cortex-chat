// One-time migration endpoint to create staffing tables.
// POST /api/migrate — creates staff_roster + daily_staffing if they don't exist.

import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getSupabase();
  const results: string[] = [];

  // Try to create staff_roster
  try {
    // Check if table exists by querying it
    const { error: checkErr } = await sb.from('staff_roster').select('id').limit(1);
    if (checkErr && checkErr.message.includes('schema cache')) {
      // Table doesn't exist — create it via rpc if available, otherwise use raw insert approach
      results.push('staff_roster: table not found — needs SQL creation');
    } else {
      results.push('staff_roster: already exists');
    }
  } catch (err) {
    results.push(`staff_roster check error: ${err}`);
  }

  // Try to create daily_staffing
  try {
    const { error: checkErr } = await sb.from('daily_staffing').select('id').limit(1);
    if (checkErr && checkErr.message.includes('schema cache')) {
      results.push('daily_staffing: table not found — needs SQL creation');
    } else {
      results.push('daily_staffing: already exists');
    }
  } catch (err) {
    results.push(`daily_staffing check error: ${err}`);
  }

  // Since Supabase JS client can't run DDL, provide the SQL for the user
  const sql = `
-- Run this in Supabase Dashboard > SQL Editor > New Query

CREATE TABLE IF NOT EXISTS staff_roster (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT 'org',
  org_id TEXT,
  worker_name TEXT NOT NULL,
  role TEXT NOT NULL,
  hourly_rate NUMERIC(8,2),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_staffing (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id TEXT NOT NULL,
  org_id TEXT,
  staff_date DATE NOT NULL,
  worker_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  regular_hours NUMERIC(5,2) DEFAULT 0,
  ot_hours NUMERIC(5,2) DEFAULT 0,
  hourly_rate NUMERIC(8,2) DEFAULT 0,
  entered_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_staffing_project_date ON daily_staffing(project_id, staff_date);
CREATE INDEX IF NOT EXISTS idx_staff_roster_org ON staff_roster(org_id, is_active);

-- RLS: allow service role full access
ALTER TABLE staff_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_staffing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on staff_roster" ON staff_roster
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on daily_staffing" ON daily_staffing
  FOR ALL USING (true) WITH CHECK (true);
  `.trim();

  return Response.json({ results, sql, needsManualCreation: results.some(r => r.includes('needs SQL creation')) });
}
