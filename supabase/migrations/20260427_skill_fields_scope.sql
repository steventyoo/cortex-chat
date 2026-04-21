-- Migration: Add scope column to skill_fields
-- Allows the same field_catalog entry to appear in multiple scopes per skill
-- (e.g. "regular_hours" in both cost_code records and payroll_transactions).

BEGIN;

ALTER TABLE skill_fields
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'doc';

ALTER TABLE skill_fields
  DROP CONSTRAINT IF EXISTS skill_fields_skill_id_field_id_key;

ALTER TABLE skill_fields
  ADD CONSTRAINT skill_fields_skill_field_scope_key
  UNIQUE(skill_id, field_id, scope);

CREATE INDEX IF NOT EXISTS idx_skill_fields_scope
  ON skill_fields(skill_id, scope, sort_order);

COMMIT;
