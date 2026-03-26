-- Unified storage for all extracted document data
-- Replaces per-document-type tables (change_orders, design_changes, etc.)
-- with a single JSONB-based table + pgvector for semantic search

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE extracted_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  skill_version INT NOT NULL DEFAULT 1,
  pipeline_log_id UUID,
  document_type TEXT,
  source_file TEXT,
  fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_text TEXT,
  embedding VECTOR(1536),
  overall_confidence FLOAT,
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'pushed')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_er_skill ON extracted_records(skill_id);
CREATE INDEX idx_er_project ON extracted_records(project_id);
CREATE INDEX idx_er_org ON extracted_records(org_id);
CREATE INDEX idx_er_status ON extracted_records(status);
CREATE INDEX idx_er_pipeline_log ON extracted_records(pipeline_log_id);
CREATE INDEX idx_er_fields ON extracted_records USING GIN(fields);
CREATE INDEX idx_er_document_type ON extracted_records(document_type);
