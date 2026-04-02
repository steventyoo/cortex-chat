-- Document categories: per-org configurable folder system for organizing documents.
-- 17 defaults are seeded on org creation; admins can add custom categories.

CREATE TABLE IF NOT EXISTS document_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES organizations(org_id),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  priority TEXT DEFAULT 'P3',
  sort_order INT NOT NULL,
  search_keywords TEXT,
  is_default BOOLEAN DEFAULT false,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, key)
);

CREATE INDEX IF NOT EXISTS idx_doc_categories_org ON document_categories(org_id);

-- Audit trail for document moves between categories
CREATE TABLE IF NOT EXISTS document_moves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_log_id UUID NOT NULL REFERENCES pipeline_log(id),
  from_category_id UUID REFERENCES document_categories(id),
  to_category_id UUID NOT NULL REFERENCES document_categories(id),
  moved_by TEXT NOT NULL,
  moved_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doc_moves_pipeline ON document_moves(pipeline_log_id);

-- Add category_id and canonical_name to pipeline_log
ALTER TABLE pipeline_log ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES document_categories(id);
ALTER TABLE pipeline_log ADD COLUMN IF NOT EXISTS canonical_name TEXT;

-- Add client_code to organizations for canonical naming
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS client_code TEXT;

-- RLS policies
ALTER TABLE document_categories ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_all_document_categories" ON document_categories
    FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE document_moves ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_all_document_moves" ON document_moves
    FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
