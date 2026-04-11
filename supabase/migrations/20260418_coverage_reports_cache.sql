-- Migration: coverage_reports cache table
-- Stores expensive AI-generated JCR coverage reports so they don't
-- re-run on every page visit (~30-60s of Claude API calls each time).

BEGIN;

CREATE TABLE IF NOT EXISTS coverage_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  project_id TEXT,
  jcr_pipeline_id UUID,
  report JSONB NOT NULL,
  doc_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_coverage_reports_org_project ON coverage_reports(org_id, project_id);
CREATE INDEX idx_coverage_reports_created ON coverage_reports(created_at DESC);

ALTER TABLE coverage_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for coverage_reports" ON coverage_reports FOR ALL USING (true) WITH CHECK (true);

COMMIT;
