-- Migration: code interpreter infrastructure
-- Adds context_cards table, execute_readonly_query RPC, match_context_cards RPC,
-- and extends chat_tools implementation_type constraint.

-- ── context_cards ───────────────────────────────────────────────
CREATE TABLE context_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  card_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  trigger_concepts TEXT[] DEFAULT '{}',
  skills_involved TEXT[] DEFAULT '{}',
  business_logic TEXT NOT NULL,
  key_fields JSONB DEFAULT '{}',
  example_questions TEXT[] DEFAULT '{}',
  embedding vector(1536),
  is_active BOOLEAN DEFAULT true,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, card_name)
);

CREATE INDEX idx_context_cards_org ON context_cards(org_id);
CREATE INDEX idx_context_cards_active ON context_cards(org_id, is_active) WHERE is_active = true;
CREATE INDEX idx_context_cards_embedding ON context_cards
  USING hnsw (embedding vector_cosine_ops);

ALTER TABLE context_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for context_cards" ON context_cards FOR ALL USING (true) WITH CHECK (true);

-- ── match_context_cards RPC ─────────────────────────────────────
CREATE OR REPLACE FUNCTION match_context_cards(
  query_embedding vector(1536),
  filter_org_id TEXT,
  match_count INT DEFAULT 3,
  match_threshold FLOAT DEFAULT 0.3
)
RETURNS TABLE (
  id UUID,
  card_name TEXT,
  display_name TEXT,
  description TEXT,
  skills_involved TEXT[],
  business_logic TEXT,
  key_fields JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cc.id,
    cc.card_name,
    cc.display_name,
    cc.description,
    cc.skills_involved,
    cc.business_logic,
    cc.key_fields,
    1 - (cc.embedding <=> query_embedding) AS similarity
  FROM context_cards cc
  WHERE cc.org_id = filter_org_id
    AND cc.is_active = true
    AND cc.embedding IS NOT NULL
    AND 1 - (cc.embedding <=> query_embedding) > match_threshold
  ORDER BY cc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ── execute_readonly_query RPC ──────────────────────────────────
CREATE OR REPLACE FUNCTION execute_readonly_query(
  sql_query TEXT,
  p_org_id TEXT,
  p_project_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '10000'
AS $$
DECLARE
  result JSONB;
  safe_query TEXT;
BEGIN
  safe_query := trim(sql_query);

  IF NOT (lower(safe_query) ~ '^select\s') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;

  IF safe_query ~* '\b(insert|update|delete|drop|alter|truncate|create|grant|revoke)\b' THEN
    RAISE EXCEPTION 'DML/DDL statements are not allowed';
  END IF;

  safe_query := replace(safe_query, '{{org_id}}', quote_literal(p_org_id));
  IF p_project_id IS NOT NULL THEN
    safe_query := replace(safe_query, '{{project_id}}', quote_literal(p_project_id));
  END IF;

  IF NOT (safe_query ~* '\bLIMIT\b') THEN
    safe_query := safe_query || ' LIMIT 500';
  END IF;

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (%s) t',
    safe_query
  ) INTO result;

  RETURN result;
END;
$$;

-- ── Extend chat_tools implementation_type constraint ────────────
ALTER TABLE chat_tools
  DROP CONSTRAINT IF EXISTS chat_tools_implementation_type_check;

ALTER TABLE chat_tools
  ADD CONSTRAINT chat_tools_implementation_type_check
  CHECK (implementation_type IN (
    'sql_query', 'rag_search', 'api_call', 'composite',
    'skill_scan', 'project_overview',
    'sql_analytics', 'sandbox', 'context_retrieval', 'field_catalog'
  ));
