-- Sync document_type enum with skill IDs from document_skills table.
-- These were missing, causing the final pipeline_log update to fail silently
-- when the AI classifier returned a skill_id not in the enum.

ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'design_change';
ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'project_admin';
ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'safety_inspection';
