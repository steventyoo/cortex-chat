-- HNSW vector index for faster similarity search on extracted_records
CREATE INDEX IF NOT EXISTS idx_extracted_records_embedding
ON extracted_records
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
