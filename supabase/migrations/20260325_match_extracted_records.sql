-- Vector similarity search function for RAG-powered chat
-- Supports include_pending flag to optionally include pending records
CREATE OR REPLACE FUNCTION match_extracted_records(
  query_embedding VECTOR(1536),
  match_count INT DEFAULT 20,
  match_threshold FLOAT DEFAULT 0.3,
  filter_project_id TEXT DEFAULT NULL,
  filter_org_id TEXT DEFAULT NULL,
  filter_skill_id TEXT DEFAULT NULL,
  include_pending BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id UUID,
  skill_id TEXT,
  document_type TEXT,
  fields JSONB,
  similarity FLOAT,
  project_id TEXT,
  org_id TEXT,
  source_file TEXT,
  created_at TIMESTAMPTZ,
  overall_confidence FLOAT,
  status TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    er.id,
    er.skill_id,
    er.document_type,
    er.fields,
    (1 - (er.embedding <=> query_embedding))::FLOAT AS similarity,
    er.project_id,
    er.org_id,
    er.source_file,
    er.created_at,
    er.overall_confidence::FLOAT,
    er.status::TEXT
  FROM extracted_records er
  WHERE er.embedding IS NOT NULL
    AND (
      (include_pending = TRUE AND er.status IN ('pending', 'approved', 'pushed'))
      OR
      (include_pending = FALSE AND er.status IN ('approved', 'pushed'))
    )
    AND (filter_project_id IS NULL OR er.project_id = filter_project_id)
    AND (filter_org_id IS NULL OR er.org_id = filter_org_id)
    AND (filter_skill_id IS NULL OR er.skill_id = filter_skill_id)
    AND (1 - (er.embedding <=> query_embedding)) > match_threshold
  ORDER BY er.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
