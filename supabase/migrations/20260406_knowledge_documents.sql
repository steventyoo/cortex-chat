-- Knowledge documents: reference materials (textbooks, manuals, specs) that provide
-- domain context for AI extraction. Chunked and embedded for retrieval during extraction.

CREATE TABLE knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  extracted_text TEXT,
  chunk_count INTEGER DEFAULT 0,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_knowledge_chunks_document ON knowledge_chunks(document_id);
CREATE INDEX idx_knowledge_chunks_embedding ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
CREATE INDEX idx_knowledge_documents_org ON knowledge_documents(org_id);

-- Add extraction_instructions and reference_doc_ids to document_skills
ALTER TABLE document_skills
  ADD COLUMN IF NOT EXISTS extraction_instructions TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS reference_doc_ids UUID[] DEFAULT '{}';

-- RLS
ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role bypass knowledge_documents"
  ON knowledge_documents FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass knowledge_chunks"
  ON knowledge_chunks FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Similarity search function for knowledge chunks
CREATE OR REPLACE FUNCTION match_knowledge_chunks(
  query_embedding VECTOR(1536),
  match_count INT DEFAULT 5,
  match_threshold FLOAT DEFAULT 0.3,
  filter_document_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  chunk_index INT,
  content TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kc.id,
    kc.document_id,
    kc.chunk_index,
    kc.content,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM knowledge_chunks kc
  WHERE
    kc.embedding IS NOT NULL
    AND (filter_document_ids IS NULL OR kc.document_id = ANY(filter_document_ids))
    AND 1 - (kc.embedding <=> query_embedding) > match_threshold
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
