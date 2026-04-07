-- Migration: document_links_v2
-- Clean document linking table with proper FKs to extracted_records,
-- typed link_type_id, confidence scoring, match evidence, and dedup.

CREATE TABLE document_links_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  source_record_id UUID NOT NULL REFERENCES extracted_records(id) ON DELETE CASCADE,
  target_record_id UUID NOT NULL REFERENCES extracted_records(id) ON DELETE CASCADE,
  link_type_id UUID NOT NULL REFERENCES document_link_types(id),
  confidence FLOAT NOT NULL DEFAULT 1.0,
  method TEXT NOT NULL DEFAULT 'auto' CHECK (method IN ('auto', 'manual', 'review')),
  matched_on JSONB NOT NULL DEFAULT '{}'::jsonb,
  time_delta_days INT,
  cost_impact NUMERIC,
  notes TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(source_record_id, target_record_id, link_type_id)
);

CREATE INDEX idx_links_v2_project ON document_links_v2(project_id);
CREATE INDEX idx_links_v2_org ON document_links_v2(org_id);
CREATE INDEX idx_links_v2_source ON document_links_v2(source_record_id);
CREATE INDEX idx_links_v2_target ON document_links_v2(target_record_id);
CREATE INDEX idx_links_v2_link_type ON document_links_v2(link_type_id);
CREATE INDEX idx_links_v2_confidence ON document_links_v2(confidence);
CREATE INDEX idx_links_v2_method ON document_links_v2(method);
CREATE INDEX idx_links_v2_project_org ON document_links_v2(project_id, org_id);

ALTER TABLE document_links_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for document_links_v2" ON document_links_v2 FOR ALL USING (true) WITH CHECK (true);
