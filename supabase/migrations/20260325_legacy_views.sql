-- SQL views over extracted_records that match the legacy typed table schemas.
-- Fields are stored as {"fieldName": {"value": ..., "confidence": ...}} so
-- we use fields->'FieldName'->>'value' to extract the raw value.

CREATE OR REPLACE VIEW change_orders_v AS
SELECT
  er.id, er.project_id, er.org_id,
  er.fields->'CO ID'->>'value' AS co_id,
  er.fields->'CO Type'->>'value' AS co_type,
  er.fields->'Scope Description'->>'value' AS scope_description,
  er.fields->'Date Submitted'->>'value' AS date_submitted,
  er.fields->'Triggering Doc Ref'->>'value' AS triggering_doc_ref,
  (er.fields->'Labor Subtotal'->>'value')::numeric AS labor_subtotal,
  (er.fields->'Material Subtotal'->>'value')::numeric AS material_subtotal,
  (er.fields->'Sub Tier Amount'->>'value')::numeric AS sub_tier_amount,
  (er.fields->'GC Proposed Amount'->>'value')::numeric AS proposed_amount,
  (er.fields->'Owner Approved Amount'->>'value')::numeric AS approved_amount,
  er.fields->'CSI Division Primary'->>'value' AS csi_divisions,
  er.fields->'Approval Status'->>'value' AS approval_status,
  er.fields->'Root Cause'->>'value' AS root_cause,
  er.fields->'Preventability'->>'value' AS preventability,
  er.fields->'Initiating Party'->>'value' AS initiating_party,
  er.fields->'Change Reason'->>'value' AS change_reason,
  er.fields->'Schedule Impact'->>'value' AS schedule_impact,
  er.pipeline_log_id, er.created_at
FROM extracted_records er
WHERE er.skill_id = 'change_order' AND er.status IN ('approved', 'pushed');

CREATE OR REPLACE VIEW production_v AS
SELECT
  er.id, er.project_id, er.org_id,
  er.fields->'Cost Code'->>'value' AS cost_code,
  er.fields->'Activity Description'->>'value' AS activity_description,
  (er.fields->'Budget Labor Hours'->>'value')::numeric AS budget_labor_hours,
  (er.fields->'Actual Labor Hours'->>'value')::numeric AS actual_labor_hours,
  (er.fields->'Performance Ratio'->>'value')::numeric AS performance_ratio,
  er.fields->'Productivity Indicator'->>'value' AS productivity_indicator,
  (er.fields->'Hrs to Complete'->>'value')::numeric AS hrs_to_complete,
  er.pipeline_log_id, er.created_at
FROM extracted_records er
WHERE er.skill_id = 'production_activity' AND er.status IN ('approved', 'pushed');

CREATE OR REPLACE VIEW design_changes_v AS
SELECT
  er.id, er.project_id, er.org_id,
  er.fields->'Design Doc ID'->>'value' AS design_doc_id,
  er.fields->'Document Type'->>'value' AS doc_type,
  er.fields->'Description'->>'value' AS description,
  er.fields->'Issued By'->>'value' AS issued_by,
  er.fields->'Issue Date'->>'value' AS issue_date,
  er.fields->'Cost Impact'->>'value' AS cost_impact,
  er.fields->'Resulting COR CO'->>'value' AS resulting_cor_co,
  er.pipeline_log_id, er.created_at
FROM extracted_records er
WHERE er.skill_id IN ('design_change', 'rfi') AND er.status IN ('approved', 'pushed');

CREATE OR REPLACE VIEW documents_v AS
SELECT
  er.id, er.project_id, er.org_id,
  er.fields->'Document ID'->>'value' AS document_id,
  er.document_type AS document_type,
  er.fields->'Document Title'->>'value' AS document_title,
  er.fields->'Date on Document'->>'value' AS date_on_document,
  er.source_file AS file_name,
  er.skill_id, er.overall_confidence, er.pipeline_log_id, er.created_at
FROM extracted_records er
WHERE er.status IN ('approved', 'pushed');
