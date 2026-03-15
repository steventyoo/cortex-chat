-- Schema improvements from data analyst review (March 2026)
-- 1. Add document_id FK to domain tables for document provenance
-- 2. Add root_cause and preventability enum columns
-- 3. Fix daily_notes missing columns

-- ── 1. Add document_id FK to change_orders and design_changes ──

ALTER TABLE change_orders
  ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES documents(id);

ALTER TABLE design_changes
  ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES documents(id);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_change_orders_document_id ON change_orders(document_id);
CREATE INDEX IF NOT EXISTS idx_design_changes_document_id ON design_changes(document_id);

-- ── 2. Add root_cause and preventability to change_orders ──

ALTER TABLE change_orders
  ADD COLUMN IF NOT EXISTS root_cause TEXT
    CHECK (root_cause IS NULL OR root_cause IN (
      'Design Error',
      'Design Omission',
      'Owner Request',
      'Field Condition',
      'Unforeseen Condition',
      'Code/Regulation Change',
      'Coordination Issue',
      'Scope Change',
      'Material Substitution',
      'Vendor/Supplier Issue'
    ));

ALTER TABLE change_orders
  ADD COLUMN IF NOT EXISTS preventability TEXT
    CHECK (preventability IS NULL OR preventability IN (
      'Preventable',
      'Partially Preventable',
      'Not Preventable',
      'Under Review'
    ));

-- ── 3. Add root_cause and preventability to design_changes ──

ALTER TABLE design_changes
  ADD COLUMN IF NOT EXISTS root_cause TEXT
    CHECK (root_cause IS NULL OR root_cause IN (
      'Design Error',
      'Design Omission',
      'Owner Request',
      'Field Condition',
      'Unforeseen Condition',
      'Code/Regulation Change',
      'Coordination Issue',
      'Scope Change',
      'Material Substitution',
      'Vendor/Supplier Issue'
    ));

ALTER TABLE design_changes
  ADD COLUMN IF NOT EXISTS preventability TEXT
    CHECK (preventability IS NULL OR preventability IN (
      'Preventable',
      'Partially Preventable',
      'Not Preventable',
      'Under Review'
    ));

-- ── 4. Fix daily_notes missing columns (from previous session) ──

ALTER TABLE daily_notes ADD COLUMN IF NOT EXISTS production_data JSONB;
ALTER TABLE daily_notes ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE daily_notes ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE daily_notes ADD COLUMN IF NOT EXISTS author_name TEXT DEFAULT '';

-- ── 5. Create daily_note_versions table if missing ──

CREATE TABLE IF NOT EXISTS daily_note_versions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  note_id UUID REFERENCES daily_notes(id),
  previous_content TEXT,
  previous_crew_count INTEGER,
  previous_weather TEXT,
  changed_by TEXT,
  changed_at TIMESTAMPTZ DEFAULT now(),
  change_type TEXT
);
