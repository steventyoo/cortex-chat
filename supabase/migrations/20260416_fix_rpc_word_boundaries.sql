-- Fix: PostgreSQL uses \y for word boundaries, not \b (\b = backspace in PG regex).
-- The previous DML guard and LIMIT check used \b which silently matched nothing,
-- leaving the DML guard non-functional and the LIMIT check always appending LIMIT 500.
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

  IF safe_query ~* '\y(insert|update|delete|drop|alter|truncate|grant|revoke)\y' THEN
    RAISE EXCEPTION 'DML/DDL statements are not allowed';
  END IF;

  -- Replace quoted variants first: '{{org_id}}' → 'value'
  safe_query := replace(safe_query, '''{{org_id}}''', quote_literal(p_org_id));
  safe_query := replace(safe_query, '{{org_id}}', quote_literal(p_org_id));

  IF p_project_id IS NOT NULL THEN
    safe_query := replace(safe_query, '''{{project_id}}''', quote_literal(p_project_id));
    safe_query := replace(safe_query, '{{project_id}}', quote_literal(p_project_id));
  END IF;

  IF NOT (safe_query ~* '\yLIMIT\y') THEN
    safe_query := safe_query || ' LIMIT 500';
  END IF;

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (%s) t',
    safe_query
  ) INTO result;

  RETURN result;
END;
$$;
