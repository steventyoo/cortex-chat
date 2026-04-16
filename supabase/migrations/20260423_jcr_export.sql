-- Migration: JCR Export table
-- Stores 907 canonical fields produced by the JCR Model Engine

CREATE TABLE jcr_export (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id text NOT NULL,
  project_id text NOT NULL,
  run_id uuid NOT NULL,
  pipeline_log_id uuid REFERENCES pipeline_log(id),
  tab text NOT NULL,
  section text NOT NULL,
  record_key text NOT NULL,
  field text NOT NULL,
  canonical_name text NOT NULL,
  display_name text NOT NULL,
  data_type text NOT NULL CHECK (data_type IN ('currency','number','string','percent','integer','ratio','date')),
  status text NOT NULL CHECK (status IN ('Extracted','Derived','Cross-Ref')),
  value_text text,
  value_number double precision,
  notes text,
  confidence text DEFAULT 'Verified',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_jcr_export_project ON jcr_export(project_id, tab);
CREATE INDEX idx_jcr_export_canonical ON jcr_export(project_id, canonical_name);
CREATE INDEX idx_jcr_export_run ON jcr_export(run_id);

ALTER TABLE jcr_export ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for jcr_export" ON jcr_export
  FOR ALL USING (true) WITH CHECK (true);
