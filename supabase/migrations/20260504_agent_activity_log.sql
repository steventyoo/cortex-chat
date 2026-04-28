-- Persist agent extraction state so it survives function crashes/timeouts.
-- Checkpointed after each successful iteration; final state saved at end.

ALTER TABLE pipeline_log ADD COLUMN IF NOT EXISTS agent_activity_log JSONB;
ALTER TABLE pipeline_log ADD COLUMN IF NOT EXISTS agent_best_script TEXT;
ALTER TABLE pipeline_log ADD COLUMN IF NOT EXISTS agent_best_output JSONB;
ALTER TABLE pipeline_log ADD COLUMN IF NOT EXISTS agent_composite_score NUMERIC(5,2);
ALTER TABLE pipeline_log ADD COLUMN IF NOT EXISTS agent_rounds INTEGER;
ALTER TABLE pipeline_log ADD COLUMN IF NOT EXISTS agent_tool_calls INTEGER;
