-- Per-project data sources: supports multiple file/API sources per project.
-- File sources (gdrive, s3) are scanned for documents.
-- API sources (future) pull structured data from external software.

-- Source kind: distinguishes file-based vs API-based ingestion paths
CREATE TYPE source_kind AS ENUM ('file', 'api');

-- Org-level integration credentials (for future API providers like Procore, ComputerEase)
CREATE TABLE IF NOT EXISTS org_integrations (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id      TEXT NOT NULL,
  provider    TEXT NOT NULL,
  credentials JSONB NOT NULL DEFAULT '{}',
  label       TEXT NOT NULL DEFAULT '',
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, provider)
);

-- Per-project sources: each row connects a project to a specific data source
CREATE TABLE IF NOT EXISTS project_sources (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id      TEXT NOT NULL,
  org_id          TEXT NOT NULL,
  kind            source_kind NOT NULL DEFAULT 'file',
  provider        TEXT NOT NULL DEFAULT 'gdrive',
  config          JSONB NOT NULL DEFAULT '{}',
  integration_id  UUID REFERENCES org_integrations(id),
  label           TEXT NOT NULL DEFAULT '',
  active          BOOLEAN NOT NULL DEFAULT true,
  last_synced_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_project_sources_project ON project_sources(project_id, org_id);
CREATE INDEX idx_project_sources_org_active ON project_sources(org_id, kind) WHERE active = true;
CREATE INDEX idx_org_integrations_org ON org_integrations(org_id) WHERE active = true;

ALTER TABLE org_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON org_integrations
  FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE project_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON project_sources
  FOR ALL USING (true) WITH CHECK (true);
