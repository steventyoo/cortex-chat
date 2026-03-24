-- document_skills: each row is a self-contained extraction skill for one document type
CREATE TABLE document_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'draft', 'archived')),
  system_prompt TEXT NOT NULL,
  field_definitions JSONB NOT NULL,
  target_table TEXT NOT NULL,
  multi_record_config JSONB,
  column_mapping JSONB NOT NULL,
  sample_extractions JSONB DEFAULT '[]',
  taxonomy_source JSONB,
  classifier_hints JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- skill_corrections: every human edit during review, used for feedback loop
CREATE TABLE skill_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id TEXT NOT NULL REFERENCES document_skills(skill_id),
  skill_version INT NOT NULL,
  pipeline_log_id UUID NOT NULL,
  source_snippet TEXT,
  original_extraction JSONB NOT NULL,
  corrected_extraction JSONB NOT NULL,
  fields_changed JSONB NOT NULL,
  is_few_shot_candidate BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- org_skill_configs: per-organization overrides and terminology mappings
-- v1: only document_aliases is wired into the classifier; other columns
-- are reserved for future use (field merge, custom fields, hidden fields)
CREATE TABLE org_skill_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  skill_id TEXT NOT NULL REFERENCES document_skills(skill_id),
  document_aliases JSONB DEFAULT '[]',
  field_aliases JSONB DEFAULT '{}',
  custom_fields JSONB DEFAULT '[]',
  hidden_fields TEXT[] DEFAULT '{}',
  field_defaults JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, skill_id)
);

CREATE INDEX idx_skills_status ON document_skills(status);
CREATE INDEX idx_skills_skill_id ON document_skills(skill_id);
CREATE INDEX idx_corrections_skill ON skill_corrections(skill_id);
CREATE INDEX idx_corrections_pipeline ON skill_corrections(pipeline_log_id);
CREATE INDEX idx_org_configs_org ON org_skill_configs(org_id);
CREATE INDEX idx_org_configs_skill ON org_skill_configs(skill_id);
