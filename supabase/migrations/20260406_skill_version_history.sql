-- Version history: snapshot skill state at each save for rollback and audit
CREATE TABLE skill_version_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id TEXT NOT NULL REFERENCES document_skills(skill_id),
  version INT NOT NULL,
  snapshot JSONB NOT NULL,
  changed_by TEXT,
  change_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(skill_id, version)
);

CREATE INDEX idx_skill_versions_skill ON skill_version_history(skill_id);

ALTER TABLE skill_version_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role bypass skill_version_history"
  ON skill_version_history FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Allow orgs to pin a specific skill version
ALTER TABLE org_skill_configs
  ADD COLUMN IF NOT EXISTS pinned_version INT DEFAULT NULL;
