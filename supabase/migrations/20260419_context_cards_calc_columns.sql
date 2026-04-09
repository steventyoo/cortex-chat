-- Add calc library columns to context_cards for deterministic calculations
-- sql_templates: parameterized SQL queries the LLM should use to fetch data
-- calc_function: the Python function from cortex_calcs to call with the data

ALTER TABLE context_cards ADD COLUMN IF NOT EXISTS sql_templates JSONB DEFAULT '{}';
ALTER TABLE context_cards ADD COLUMN IF NOT EXISTS calc_function TEXT;

-- Update match_context_cards to return new columns
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
  sql_templates JSONB,
  calc_function TEXT,
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
    cc.sql_templates,
    cc.calc_function,
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
