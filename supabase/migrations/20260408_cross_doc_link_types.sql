-- Migration: cross_doc_link_types
-- Creates document_link_types table for typed cross-document relationships
-- and adds link_type_id FK to existing document_links table.

BEGIN;

-- ============================================================
-- PART 1: Create document_link_types table
-- ============================================================

CREATE TABLE IF NOT EXISTS document_link_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_type_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  source_skill TEXT NOT NULL,
  target_skill TEXT NOT NULL,
  relationship TEXT NOT NULL,
  match_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  description TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_link_types_source ON document_link_types(source_skill);
CREATE INDEX idx_link_types_target ON document_link_types(target_skill);
CREATE INDEX idx_link_types_active ON document_link_types(is_active) WHERE is_active = true;

ALTER TABLE document_link_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for document_link_types" ON document_link_types FOR ALL USING (true) WITH CHECK (true);

-- Add FK column to document_links (nullable for backward compat with existing rows)
ALTER TABLE document_links ADD COLUMN IF NOT EXISTS link_type_id UUID REFERENCES document_link_types(id);
CREATE INDEX IF NOT EXISTS idx_document_links_link_type_id ON document_links(link_type_id);

-- ============================================================
-- PART 2: Seed relationship type definitions
-- ============================================================

INSERT INTO document_link_types (link_type_key, display_name, source_skill, target_skill, relationship, match_fields, description) VALUES
-- Change Management Pipeline (cause-to-cost)
('rfi_triggers_asi', 'RFI triggers ASI', 'rfi', 'design_change', 'triggers', '["rfi_number", "triggering_document"]', 'RFI raises a question that results in an ASI from the architect'),
('asi_generates_co', 'ASI generates CO', 'design_change', 'change_order', 'generates', '["resulting_cor_co", "co_number"]', 'ASI/CCD design change results in a change order for cost/schedule impact'),
('rfi_originates_co', 'RFI originates CO', 'rfi', 'change_order', 'originates', '["originating_document_chain", "rfi_number"]', 'RFI directly leads to a change order without intermediate ASI'),
('co_billed_in_payapp', 'CO billed in Pay App', 'change_order', 'project_admin', 'billed_via', '["co_number", "approved_amount"]', 'Approved CO amount flows into pay application line items'),
('pco_rolled_into_co', 'PCO rolled into CO', 'design_change', 'change_order', 'rolled_into', '["resulting_co_number"]', 'Proposed change order (PCO/PR) gets approved and rolled into a formal CO'),

-- Estimating Feedback Loop
('estimate_vs_production', 'Estimate vs Production Actuals', 'estimate', 'production_activity', 'feedback_loop', '["cost_code", "csi_division"]', 'Compare estimated labor rates/quantities against actual production data'),
('estimate_vs_co', 'Estimate Contingency vs COs', 'estimate', 'change_order', 'contingency_check', '["csi_division", "cost_code"]', 'Compare estimated contingency against actual change order costs'),
('subbid_vs_co', 'Sub Bid Performance vs COs', 'sub_bid', 'change_order', 'performance_check', '["subcontractor", "csi_division"]', 'Track low-bidder subs: did their COs erode the savings?'),
('subbid_vs_rfi', 'Sub Bid Performance vs RFIs', 'sub_bid', 'rfi', 'performance_check', '["subcontractor", "csi_division"]', 'Track sub RFI volume as a quality indicator'),
('estimate_vs_jcr', 'Estimate vs JCR Actuals', 'estimate', 'job_cost_report', 'budget_comparison', '["cost_code", "csi_division"]', 'Compare original bid line items against JCR actual costs'),

-- JCR Hub Relationships
('co_absorption_jcr', 'CO Absorption in JCR', 'change_order', 'job_cost_report', 'cost_allocation', '["cost_code", "csi_division", "co_number"]', 'Map change order dollars to JCR line items to compute CO absorption rate'),
('production_vs_jcr', 'Production Labor vs JCR', 'production_activity', 'job_cost_report', 'labor_reconciliation', '["cost_code", "activity_description"]', 'Reconcile production labor hours/rates against JCR labor costs'),
('daily_report_vs_jcr', 'Daily Report vs JCR', 'daily_report', 'job_cost_report', 'cost_verification', '["date", "crew_data"]', 'Verify JCR labor costs against daily report crew counts and activities'),

-- Productivity Compound Effects
('rfi_impacts_production', 'Open RFIs Impact Production', 'rfi', 'production_activity', 'productivity_impact', '["date_range", "csi_division"]', 'Open/pending RFIs correlate with ~22 LH productivity loss per open RFI'),
('weather_impacts_production', 'Weather Impacts Production', 'daily_report', 'production_activity', 'weather_impact', '["date", "weather"]', 'Weather conditions affect trade-specific productivity rates'),

-- Safety & Quality Chain
('inspection_to_daily', 'Inspection cross-ref Daily Report', 'safety_inspection', 'daily_report', 'cross_reference', '["date", "location"]', 'Safety inspection findings linked to daily report for the same date/area'),
('inspection_to_production', 'Inspection cross-ref Production', 'safety_inspection', 'production_activity', 'cross_reference', '["date", "location"]', 'Inspection failures linked to production records showing rework/delays'),
('inspection_to_punchlist', 'Inspection generates Punch Item', 'safety_inspection', 'project_admin', 'generates', '["punch_list_items"]', 'Failed inspection creates punch list items for corrective action'),

-- Contract & Admin Chain
('contract_clause_to_co', 'Contract Clause to CO Dispute', 'contract', 'change_order', 'clause_reference', '["clause_type", "dispute_category"]', 'Contract clause risk analysis linked to CO disputes and back-charges'),
('contract_to_submittal', 'Contract Spec to Submittal', 'contract', 'submittal', 'spec_reference', '["spec_section", "csi_division"]', 'Contract specification sections linked to required submittals'),
('submittal_generates_rfi', 'Submittal Review generates RFI', 'submittal', 'rfi', 'generates', '["submittal_number", "related_rfis"]', 'Submittal review process generates RFIs for clarification'),
('meeting_refs_rfi_co', 'Meeting Minutes ref RFIs/COs', 'project_admin', 'rfi', 'references', '["meeting_date", "rfi_numbers"]', 'Meeting minutes reference and discuss open RFIs'),
('meeting_refs_co', 'Meeting Minutes ref COs', 'project_admin', 'change_order', 'references', '["meeting_date", "co_numbers"]', 'Meeting minutes reference and discuss change orders'),
('payapp_vs_jcr', 'Pay App vs JCR', 'project_admin', 'job_cost_report', 'billing_verification', '["billing_period", "amount"]', 'Pay application amounts verified against JCR job-to-date costs'),

-- Design Change Variants
('ccd_to_co', 'CCD rolled into CO', 'design_change', 'change_order', 'rolled_into', '["resulting_co", "ccd_number"]', 'Construction change directive rolled into formal change order'),
('bulletin_to_asi', 'Bulletin to ASI', 'design_change', 'design_change', 'supersedes', '["bulletin_number", "asi_number"]', 'Design bulletin superseded by or formalized as an ASI'),

-- Sub Bid Quality
('subbid_vs_punchlist', 'Sub Bid vs Punch List Cost', 'sub_bid', 'project_admin', 'performance_check', '["subcontractor"]', 'Track low-bidder sub punch list costs as quality indicator')

ON CONFLICT (link_type_key) DO NOTHING;

COMMIT;
