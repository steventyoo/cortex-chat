-- Migration: eval_items
-- Stores eval dataset items for Langfuse chat evaluations.
-- Managed via the Operator Workbench UI.

CREATE TABLE eval_items (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  category TEXT NOT NULL,
  question TEXT NOT NULL,
  project_id TEXT NOT NULL,
  expected_answer TEXT NOT NULL DEFAULT '',
  key_values JSONB NOT NULL DEFAULT '{}',
  expected_tool TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_eval_items_org ON eval_items(org_id);
CREATE INDEX idx_eval_items_category ON eval_items(org_id, category);

ALTER TABLE eval_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eval_items_org_read" ON eval_items
  FOR SELECT USING (true);

CREATE POLICY "eval_items_org_insert" ON eval_items
  FOR INSERT WITH CHECK (true);

CREATE POLICY "eval_items_org_update" ON eval_items
  FOR UPDATE USING (true);

CREATE POLICY "eval_items_org_delete" ON eval_items
  FOR DELETE USING (true);
