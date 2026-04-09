-- Add 'calc_function' to the chat_tools implementation_type constraint
ALTER TABLE chat_tools
  DROP CONSTRAINT IF EXISTS chat_tools_implementation_type_check;

ALTER TABLE chat_tools
  ADD CONSTRAINT chat_tools_implementation_type_check
  CHECK (implementation_type IN (
    'sql_query', 'rag_search', 'api_call', 'composite',
    'skill_scan', 'project_overview',
    'sql_analytics', 'sandbox', 'context_retrieval', 'field_catalog',
    'calc_function'
  ));
