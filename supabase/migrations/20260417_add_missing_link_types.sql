-- Migration: add 8 missing cross-doc link types
-- These relationships exist in the taxonomy doc (Cortex_Taxonomy_to_UseCase_Mapping_v4)
-- but were not included in the original 20260408_cross_doc_link_types.sql seed.

INSERT INTO document_link_types (link_type_key, display_name, source_skill, target_skill, relationship, match_fields, description) VALUES
('daily_to_production', 'Daily Report to Production Activity', 'daily_report', 'production_activity', 'narrative_to_record', '["date", "activity_description", "crew_data"]', 'NLP narrative in daily report maps to structured production activity records'),
('estimate_to_subbid', 'Estimate Budget vs Sub Bids', 'estimate', 'sub_bid', 'budget_comparison', '["csi_division", "cost_code"]', 'GC budget line items compared to sub bids received for buyout performance'),
('inspection_to_rfi', 'Inspection Fail generates RFI', 'safety_inspection', 'rfi', 'generates', '["date", "csi_division", "location"]', 'Failed inspections that trigger RFIs for design clarification or rework'),
('rfi_to_daily', 'Open RFI impacts Daily Report', 'rfi', 'daily_report', 'productivity_impact', '["date_range", "csi_division"]', 'Open/pending RFIs correlate with productivity losses documented in daily reports'),
('rfi_to_estimate', 'RFI Pattern to Estimate Feedback', 'rfi', 'estimate', 'feedback_loop', '["csi_division", "root_cause"]', 'RFI patterns from past projects feed into bid risk factors for future estimates'),
('punchlist_to_retention', 'Punch List to Retention Release', 'project_admin', 'project_admin', 'drives_release', '["project_id", "punch_status"]', 'Punch list completion timing directly drives retention release cash flow'),
('warranty_to_production', 'Warranty Callback to Production/Crew', 'project_admin', 'production_activity', 'traces_to', '["trade", "location", "crew_data"]', 'Warranty failures traced back to original crew and installation method'),
('contract_to_payment_terms', 'Contract Clause to Payment Terms', 'contract', 'project_admin', 'defines_terms', '["payment_terms", "retention_percentage"]', 'Contract payment clauses define the baseline for GC payment velocity benchmarking')
ON CONFLICT (link_type_key) DO NOTHING;
