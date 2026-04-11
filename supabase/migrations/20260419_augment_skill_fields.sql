-- Migration: Augment skill_fields with per-skill extraction config
-- Carries description, options, example, and extraction_hint from the
-- legacy field_definitions JSONB so the catalog can be the single source of truth.

BEGIN;

ALTER TABLE skill_fields
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS options JSONB,
  ADD COLUMN IF NOT EXISTS example TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS extraction_hint TEXT;

COMMIT;
