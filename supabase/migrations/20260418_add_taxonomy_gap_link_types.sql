BEGIN;

INSERT INTO document_link_types (link_type_key, display_name, source_skill, target_skill, relationship, match_fields, description) VALUES
('contract_to_backcharge', 'Contract Clause to Back-Charge', 'contract', 'change_order', 'back_charge', '["clause_type", "subcontractor"]', 'Contract clause risk analysis linked to back-charge change orders'),
('jcr_to_estimate', 'JCR Feedback to Estimate', 'job_cost_report', 'estimate', 'feedback_loop', '["cost_code", "csi_division"]', 'JCR actual costs feed back to improve future estimates'),
('jcr_to_production', 'JCR vs Production Actuals', 'job_cost_report', 'production_activity', 'labor_reconciliation', '["cost_code", "csi_division"]', 'JCR labor costs reconciled against production activity records')
ON CONFLICT (link_type_key) DO NOTHING;

COMMIT;
