-- Schema Improvements v2: Better data collection for calculation library
-- Phase 1: document_skills field_definitions handled by seed-document-skills.js
-- Phase 2: Project-level metadata for cross-project aggregation

-- ── 1. Add metadata columns to projects table ──

ALTER TABLE projects ADD COLUMN IF NOT EXISTS gc_name TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_name TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_type TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_subtype TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS building_type TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS delivery_method TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS gross_sf NUMERIC;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS stories INT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS geographic_market TEXT;

-- ── 2. Indexes for common cross-project grouping queries ──

CREATE INDEX IF NOT EXISTS idx_projects_gc_name ON projects(gc_name) WHERE gc_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_project_type ON projects(project_type) WHERE project_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_building_type ON projects(building_type) WHERE building_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_geographic_market ON projects(geographic_market) WHERE geographic_market IS NOT NULL;
