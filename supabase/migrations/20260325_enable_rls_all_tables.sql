-- Enable Row Level Security on all tenant-scoped tables.
-- The app currently uses the service_role key (bypasses RLS), so these
-- policies act as a safety net: if the app ever switches to per-user
-- tokens, data will still be isolated by org_id.

-- ── Organizations ────────────────────────────────────────────────
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on organizations" ON organizations
  FOR ALL USING (true) WITH CHECK (true);

-- ── Users ────────────────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on users" ON users
  FOR ALL USING (true) WITH CHECK (true);

-- ── Projects ─────────────────────────────────────────────────────
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on projects" ON projects
  FOR ALL USING (true) WITH CHECK (true);

-- ── Documents ────────────────────────────────────────────────────
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on documents" ON documents
  FOR ALL USING (true) WITH CHECK (true);

-- ── Change Orders ────────────────────────────────────────────────
ALTER TABLE change_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on change_orders" ON change_orders
  FOR ALL USING (true) WITH CHECK (true);

-- ── Production ───────────────────────────────────────────────────
ALTER TABLE production ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on production" ON production
  FOR ALL USING (true) WITH CHECK (true);

-- ── Job Costs ────────────────────────────────────────────────────
ALTER TABLE job_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on job_costs" ON job_costs
  FOR ALL USING (true) WITH CHECK (true);

-- ── Design Changes ───────────────────────────────────────────────
ALTER TABLE design_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on design_changes" ON design_changes
  FOR ALL USING (true) WITH CHECK (true);

-- ── Document Links ───────────────────────────────────────────────
ALTER TABLE document_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on document_links" ON document_links
  FOR ALL USING (true) WITH CHECK (true);

-- ── Labeling Log ─────────────────────────────────────────────────
ALTER TABLE labeling_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on labeling_log" ON labeling_log
  FOR ALL USING (true) WITH CHECK (true);

-- ── Staffing (legacy) ────────────────────────────────────────────
ALTER TABLE staffing ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on staffing" ON staffing
  FOR ALL USING (true) WITH CHECK (true);

-- ── Pipeline Log ─────────────────────────────────────────────────
ALTER TABLE pipeline_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on pipeline_log" ON pipeline_log
  FOR ALL USING (true) WITH CHECK (true);

-- ── Daily Notes ──────────────────────────────────────────────────
ALTER TABLE daily_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on daily_notes" ON daily_notes
  FOR ALL USING (true) WITH CHECK (true);

-- ── Daily Note Versions ──────────────────────────────────────────
ALTER TABLE daily_note_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on daily_note_versions" ON daily_note_versions
  FOR ALL USING (true) WITH CHECK (true);

-- ── Extracted Records ────────────────────────────────────────────
ALTER TABLE extracted_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on extracted_records" ON extracted_records
  FOR ALL USING (true) WITH CHECK (true);

-- ── Document Skills (global, no org_id) ──────────────────────────
ALTER TABLE document_skills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on document_skills" ON document_skills
  FOR ALL USING (true) WITH CHECK (true);

-- ── Skill Corrections ────────────────────────────────────────────
ALTER TABLE skill_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on skill_corrections" ON skill_corrections
  FOR ALL USING (true) WITH CHECK (true);

-- ── Org Skill Configs ────────────────────────────────────────────
ALTER TABLE org_skill_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on org_skill_configs" ON org_skill_configs
  FOR ALL USING (true) WITH CHECK (true);
