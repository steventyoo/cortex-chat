-- Add page_count column and stored_only status for large PDF handling

ALTER TABLE pipeline_log ADD COLUMN IF NOT EXISTS page_count integer;

-- Add stored_only to the pipeline_status enum
ALTER TYPE pipeline_status ADD VALUE IF NOT EXISTS 'stored_only' AFTER 'failed';
