-- Add Drive metadata and version tracking columns to pipeline_log.
-- Enables: storing files in Supabase Storage, detecting updated Drive files,
-- linking back to original Drive location for chat citations.

ALTER TABLE pipeline_log ADD COLUMN IF NOT EXISTS drive_file_id TEXT;
ALTER TABLE pipeline_log ADD COLUMN IF NOT EXISTS drive_modified_time TIMESTAMPTZ;
ALTER TABLE pipeline_log ADD COLUMN IF NOT EXISTS drive_web_view_link TEXT;
ALTER TABLE pipeline_log ADD COLUMN IF NOT EXISTS drive_folder_path TEXT;
ALTER TABLE pipeline_log ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE pipeline_log ADD COLUMN IF NOT EXISTS is_latest_version BOOLEAN DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_pipeline_log_drive_file
  ON pipeline_log (org_id, drive_file_id, is_latest_version)
  WHERE drive_file_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pipeline_log_latest_version
  ON pipeline_log (org_id, is_latest_version)
  WHERE is_latest_version = true;
