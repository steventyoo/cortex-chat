-- Stores each eval run execution
CREATE TABLE IF NOT EXISTS eval_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  run_label TEXT NOT NULL UNIQUE,
  run_type TEXT NOT NULL,
  skill_id TEXT,
  suite TEXT,
  total_items INT NOT NULL DEFAULT 0,
  passed INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  missing INT NOT NULL DEFAULT 0,
  accuracy NUMERIC(5,4) NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Stores per-item results for each run
CREATE TABLE IF NOT EXISTS eval_run_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  field TEXT,
  category TEXT,
  status TEXT NOT NULL,
  score NUMERIC(5,4) NOT NULL DEFAULT 0,
  expected TEXT,
  actual TEXT,
  delta NUMERIC(10,6),
  metadata JSONB NOT NULL DEFAULT '{}',
  UNIQUE(run_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_eval_runs_org ON eval_runs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_run_results_run ON eval_run_results(run_id);
