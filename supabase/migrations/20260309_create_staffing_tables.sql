-- Staff Roster: org-wide crew list
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

-- Daily Staffing: per-project daily hours
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_daily_staffing_project_date ON daily_staffing(project_id, staff_date);
CREATE INDEX IF NOT EXISTS idx_staff_roster_org ON staff_roster(org_id, is_active);

-- RLS policies
ALTER TABLE staff_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_staffing ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access on staff_roster" ON staff_roster
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on daily_staffing" ON daily_staffing
  FOR ALL USING (true) WITH CHECK (true);
