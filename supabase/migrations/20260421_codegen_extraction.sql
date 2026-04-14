-- Add extraction_method to document_skills so operators can control
-- which extraction path each document type uses (llm, codegen, vision).
ALTER TABLE document_skills
  ADD COLUMN IF NOT EXISTS extraction_method text NOT NULL DEFAULT 'llm'
    CHECK (extraction_method IN ('llm', 'codegen', 'vision'));

-- Add discovered_fields to extracted_records for storing extra data
-- the code-gen parser finds beyond what the skill schema defines.
ALTER TABLE extracted_records
  ADD COLUMN IF NOT EXISTS discovered_fields jsonb DEFAULT '{}';
