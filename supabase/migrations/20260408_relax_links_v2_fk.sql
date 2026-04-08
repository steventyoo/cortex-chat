-- Drop FK constraints so document_links_v2 can reference both pipeline_log and extracted_records
-- The linking engine runs against pipeline_log records during review, and the links
-- persist when records are pushed to extracted_records (same UUIDs via pipeline_log_id)
ALTER TABLE document_links_v2 DROP CONSTRAINT IF EXISTS document_links_v2_source_record_id_fkey;
ALTER TABLE document_links_v2 DROP CONSTRAINT IF EXISTS document_links_v2_target_record_id_fkey;

COMMENT ON COLUMN document_links_v2.source_record_id IS 'References pipeline_log.id or extracted_records.id';
COMMENT ON COLUMN document_links_v2.target_record_id IS 'References pipeline_log.id or extracted_records.id';
