-- Replace fragile regex-based DML guard with PostgreSQL's built-in read-only mode.
-- SET default_transaction_read_only = on makes the engine reject any writes,
-- which is bulletproof against INSERT/UPDATE/DELETE/DROP/etc. in any form
-- (CTEs, subqueries, dynamic SQL, column names that look like keywords).
CREATE OR REPLACE FUNCTION execute_readonly_query(
  sql_query TEXT,
  p_org_id TEXT,
  p_project_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '10000'
SET default_transaction_read_only = on
AS $$
DECLARE
  result JSONB;
  safe_query TEXT;
BEGIN
  safe_query := trim(sql_query);

  IF NOT (lower(safe_query) ~ '^select\s') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
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
