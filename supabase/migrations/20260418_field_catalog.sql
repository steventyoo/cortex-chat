-- Migration: field_catalog
-- Creates a master field registry so fields are defined once and selected per-skill.
-- Fixes the root cause of linker inconsistency: same concept, different names across skills.

BEGIN;

-- ============================================================
-- PART 1: field_catalog — canonical field definitions
-- ============================================================

CREATE TABLE IF NOT EXISTS field_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'string'
    CHECK (field_type IN ('string', 'number', 'date', 'enum', 'boolean', 'array')),
  category TEXT NOT NULL DEFAULT 'general'
    CHECK (category IN ('identity', 'financial', 'schedule', 'technical', 'quality', 'admin', 'general')),
  description TEXT NOT NULL DEFAULT '',
  enum_options JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_field_catalog_category ON field_catalog(category);
CREATE INDEX idx_field_catalog_canonical ON field_catalog(canonical_name);

ALTER TABLE field_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for field_catalog" ON field_catalog FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- PART 2: skill_fields — join table linking catalog to skills
-- ============================================================

CREATE TABLE IF NOT EXISTS skill_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id TEXT NOT NULL REFERENCES document_skills(skill_id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES field_catalog(id) ON DELETE CASCADE,
  display_override TEXT,
  tier INT NOT NULL DEFAULT 1 CHECK (tier BETWEEN 0 AND 3),
  required BOOLEAN NOT NULL DEFAULT false,
  importance TEXT CHECK (importance IN ('P', 'S', 'E', 'A')),
  disambiguation_rules TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(skill_id, field_id)
);

CREATE INDEX idx_skill_fields_skill ON skill_fields(skill_id);
CREATE INDEX idx_skill_fields_field ON skill_fields(field_id);

ALTER TABLE skill_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for skill_fields" ON skill_fields FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- PART 3: Seed canonical fields from known concepts
-- ============================================================
-- These cover the cross-document concepts that the linker and
-- link types rely on, plus commonly shared fields.

INSERT INTO field_catalog (canonical_name, display_name, field_type, category, description) VALUES
-- Identity fields
('project_name',       'Project Name',              'string',  'identity',  'Name or description of the construction project'),
('project_number',     'Project Number',            'string',  'identity',  'Unique project identifier or job number'),
('document_id',        'Document ID',               'string',  'identity',  'Unique document reference number'),
('report_id',          'Report ID',                 'string',  'identity',  'Report identification number'),
('co_number',          'CO Number',                 'string',  'identity',  'Change order number'),
('rfi_number',         'RFI Number',                'string',  'identity',  'Request for information number'),
('po_number',          'PO Number',                 'string',  'identity',  'Purchase order number'),
('submittal_number',   'Submittal Number',          'string',  'identity',  'Submittal tracking number'),
('asi_number',         'ASI Number',                'string',  'identity',  'Architect supplemental instruction number'),
('ccd_number',         'CCD Number',                'string',  'identity',  'Construction change directive number'),
('bulletin_number',    'Bulletin Number',           'string',  'identity',  'Design bulletin number'),

-- Technical fields
('cost_code',          'Cost Code',                 'string',  'technical', 'Line item number or cost code identifier'),
('csi_division',       'CSI Division',              'string',  'technical', 'CSI MasterFormat division code (e.g. 03 Concrete, 09 Finishes)'),
('spec_section',       'Spec Section',              'string',  'technical', 'Specification section reference'),
('building_system',    'Building System',           'string',  'technical', 'Building system category (structural, MEP, envelope, etc.)'),
('trade',              'Trade',                     'string',  'technical', 'Construction trade or discipline'),
('location',           'Location',                  'string',  'technical', 'Physical location, area, or zone on the project'),
('scope_description',  'Scope Description',         'string',  'technical', 'Description of work scope'),
('activity_description','Activity Description',     'string',  'technical', 'Description of work activity performed'),

-- Financial fields
('amount',             'Amount',                    'number',  'financial', 'Dollar amount (generic)'),
('proposed_amount',    'GC Proposed Amount',        'number',  'financial', 'Amount proposed by general contractor'),
('approved_amount',    'Owner Approved Amount',     'number',  'financial', 'Amount approved by owner'),
('revised_budget',     'Revised Budget',            'number',  'financial', 'Current revised budget amount'),
('jtd_cost',           'Job-to-Date Cost',          'number',  'financial', 'Cumulative cost to date'),
('total_amount',       'Total Amount',              'number',  'financial', 'Total contract or document amount'),
('markup_rate',        'Markup Rate',               'number',  'financial', 'Overhead and profit markup percentage'),
('retention_pct',      'Retention Percentage',      'number',  'financial', 'Retention held back as percentage'),

-- Schedule fields
('date',               'Date',                      'date',    'schedule',  'Primary date for the document'),
('date_range',         'Date Range',                'string',  'schedule',  'Start and end date period'),
('report_date',        'Report Date',               'date',    'schedule',  'Date the report was issued'),
('report_period',      'Report Period',             'string',  'schedule',  'Billing or reporting period covered'),
('billing_period',     'Billing Period',            'string',  'schedule',  'Pay application billing period'),
('schedule_impact',    'Schedule Impact',           'string',  'schedule',  'Impact on project schedule in days or description'),

-- Quality / causal fields
('root_cause',         'Root Cause',                'string',  'quality',   'Primary root cause or reason for change'),
('change_reason',      'Change Reason',             'string',  'quality',   'Detailed reason the change was initiated'),
('preventability',     'Preventability',            'enum',    'quality',   'Whether the issue could have been prevented', '["Preventable","Partially Preventable","Not Preventable","Unknown"]'),
('resolution_outcome', 'Resolution Outcome',        'string',  'quality',   'How the issue was resolved'),
('recurring_pattern',  'Recurring Pattern',         'string',  'quality',   'Flag for recurring issues across documents'),
('lessons_learned',    'Lessons Learned',           'string',  'quality',   'Key takeaways for future projects'),

-- Admin / cross-reference fields
('subcontractor',      'Subcontractor',             'string',  'admin',     'Subcontractor, vendor, or trade partner name'),
('initiating_party',   'Initiating Party',          'string',  'admin',     'Party that initiated the document or change'),
('author',             'Author',                    'string',  'admin',     'Person who authored or submitted the document'),
('approval_status',    'Approval Status',           'enum',    'admin',     'Current approval state', '["Pending","Approved","Rejected","Void","Conditional"]'),
('weather_conditions', 'Weather Conditions',        'string',  'admin',     'Weather conditions affecting work'),
('crew_data',          'Crew Data',                 'string',  'admin',     'Crew size, composition, or headcount information'),
('punch_status',       'Punch Status',              'string',  'admin',     'Punch list item completion status'),
('payment_terms',      'Payment Terms',             'string',  'admin',     'Contract payment terms and conditions'),

-- Document chain fields (cross-references)
('triggering_document','Triggering Document',       'string',  'identity',  'Reference to the document that triggered this one'),
('originating_chain',  'Originating Document Chain', 'string', 'identity',  'Chain of documents that led to this one'),
('resulting_co',       'Resulting CO',              'string',  'identity',  'Change order number resulting from this document'),
('related_rfis',       'Related RFIs',              'string',  'identity',  'RFI numbers referenced or related'),
('related_cos',        'Related COs',               'string',  'identity',  'Change order numbers referenced or related'),
('clause_type',        'Clause Type',               'string',  'technical', 'Contract clause type relevant to the change'),
('dispute_category',   'Dispute Category',          'string',  'quality',   'Category of dispute or claim')

ON CONFLICT (canonical_name) DO NOTHING;

-- ============================================================
-- PART 4: Populate skill_fields from existing field_definitions
-- ============================================================
-- This bridges existing skills to the catalog. For each skill's
-- field_definitions entry, we try to match a catalog entry by name
-- similarity. Unmatched fields get auto-created in the catalog.

-- We do this via a PL/pgSQL block for the initial backfill.
DO $$
DECLARE
  skill_rec RECORD;
  field_rec RECORD;
  catalog_id UUID;
  canonical TEXT;
  sort_idx INT;
BEGIN
  FOR skill_rec IN
    SELECT skill_id, field_definitions
    FROM document_skills
    WHERE status = 'active'
  LOOP
    sort_idx := 0;
    FOR field_rec IN
      SELECT * FROM jsonb_array_elements(skill_rec.field_definitions) AS f
    LOOP
      sort_idx := sort_idx + 1;

      -- Try to find a matching catalog entry
      -- First try exact canonical_name match (lowered, cleaned)
      canonical := lower(regexp_replace(
        regexp_replace(field_rec.f->>'name', '[^a-zA-Z0-9\s]', '', 'g'),
        '\s+', '_', 'g'
      ));

      SELECT id INTO catalog_id
      FROM field_catalog
      WHERE canonical_name = canonical;

      -- If no match, try common mappings
      IF catalog_id IS NULL THEN
        SELECT id INTO catalog_id
        FROM field_catalog
        WHERE lower(display_name) = lower(field_rec.f->>'name')
           OR canonical_name = canonical;
      END IF;

      -- If still no match, create a new catalog entry
      IF catalog_id IS NULL THEN
        INSERT INTO field_catalog (canonical_name, display_name, field_type, category, description)
        VALUES (
          canonical,
          field_rec.f->>'name',
          COALESCE(field_rec.f->>'type', 'string'),
          'general',
          COALESCE(field_rec.f->>'description', '')
        )
        ON CONFLICT (canonical_name) DO NOTHING
        RETURNING id INTO catalog_id;

        -- If ON CONFLICT hit, fetch the existing one
        IF catalog_id IS NULL THEN
          SELECT id INTO catalog_id FROM field_catalog WHERE canonical_name = canonical;
        END IF;
      END IF;

      -- Insert the skill_fields join row
      IF catalog_id IS NOT NULL THEN
        INSERT INTO skill_fields (skill_id, field_id, display_override, tier, required, importance, disambiguation_rules, sort_order)
        VALUES (
          skill_rec.skill_id,
          catalog_id,
          field_rec.f->>'name',
          COALESCE((field_rec.f->>'tier')::int, 1),
          COALESCE((field_rec.f->>'required')::boolean, false),
          field_rec.f->>'importance',
          field_rec.f->>'disambiguationRules',
          sort_idx
        )
        ON CONFLICT (skill_id, field_id) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
END $$;

COMMIT;
