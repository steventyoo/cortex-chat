-- Rename jcr_export to computed_export (generic for all document types)
-- and add skill_id column to support multi-skill data in one table.

ALTER TABLE jcr_export RENAME TO computed_export;

ALTER TABLE computed_export
  ADD COLUMN skill_id TEXT NOT NULL DEFAULT 'job_cost_report';

ALTER INDEX idx_jcr_export_project RENAME TO idx_computed_export_project;
ALTER INDEX idx_jcr_export_canonical RENAME TO idx_computed_export_canonical;
ALTER INDEX idx_jcr_export_run RENAME TO idx_computed_export_run;

CREATE INDEX idx_computed_export_skill ON computed_export(skill_id, project_id);

ALTER POLICY "Allow all for jcr_export" ON computed_export
  RENAME TO "Allow all for computed_export";
