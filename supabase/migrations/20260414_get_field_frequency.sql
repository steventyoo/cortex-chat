-- Returns the actual field names and their frequency in extracted_records for a given skill.
-- This lets the LLM discover what fields actually exist in the data vs. what's defined in the schema.
CREATE OR REPLACE FUNCTION get_field_frequency(p_org_id text, p_skill_id text, p_include_pending boolean DEFAULT false)
RETURNS TABLE(field_name text, record_count bigint, sample_value text) AS $$
  SELECT
    key AS field_name,
    count(*) AS record_count,
    (array_agg(val->>'value' ORDER BY er.created_at DESC))[1] AS sample_value
  FROM extracted_records er,
       jsonb_each(er.fields) AS kv(key, val)
  WHERE er.org_id = p_org_id
    AND er.skill_id = p_skill_id
    AND (
      er.status IN ('approved', 'pushed')
      OR (p_include_pending AND er.status = 'pending')
    )
  GROUP BY key
  ORDER BY record_count DESC;
$$ LANGUAGE sql STABLE;
