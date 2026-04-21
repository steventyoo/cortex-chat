-- Migration: Align field_catalog + skill_fields to JCR v4 canonical schema
-- 1. Insert missing field_catalog entries for v4 fields
-- 2. Rename JCR-specific field_catalog entries to v4 canonical names
-- 3. Delete stale JCR skill_fields rows (derived/aspirational/non-v4)
-- 4. Insert scoped skill_fields rows for doc, cost_code, payroll_transactions
--
-- Depends on: 20260427_skill_fields_scope.sql (scope column)

BEGIN;

-- ============================================================
-- PART 1: Insert missing field_catalog entries for v4
-- ============================================================

INSERT INTO field_catalog (canonical_name, display_name, field_type, category, description) VALUES
  ('cost_code', 'Cost Code', 'string', 'technical', 'Cost code identifier'),
  ('cost_category', 'Cost Category', 'string', 'financial', 'Category label (Labor, Material, Subcontract, Equipment, Other)'),
  ('job_number', 'Job Number', 'string', 'identity', 'Unique job identifier'),
  ('report_period', 'Report Period', 'string', 'schedule', 'Billing or reporting period covered'),
  ('report_date', 'Report Date', 'date', 'schedule', 'Date the report was issued'),
  ('total_revised_budget', 'Total Revised Budget', 'number', 'financial', 'Sum of all cost-code revised budgets'),
  ('total_jtd_cost', 'Total JTD Cost', 'number', 'financial', 'Sum of all cost-code JTD costs'),
  ('total_change_orders', 'Total Change Orders', 'number', 'financial', 'Total approved change orders'),
  ('overall_pct_budget_consumed', 'Overall % Budget Consumed', 'number', 'financial', 'Total JTD cost / Total revised budget'),
  ('total_over_under_budget', 'Total Over/Under Budget', 'number', 'financial', 'Total revised budget minus total JTD cost'),
  ('project_type', 'Project Type', 'string', 'identity', 'Type of construction project'),
  ('trade', 'Trade', 'string', 'technical', 'Construction trade or discipline'),
  ('client', 'Client', 'string', 'identity', 'Client or owner name'),
  ('contract_value', 'Contract Value', 'number', 'financial', 'Original contract value'),
  ('pr_amount', 'PR Amount', 'number', 'financial', 'Total payroll amount on the report'),
  ('ap_amount', 'AP Amount', 'number', 'financial', 'Total accounts payable amount on the report'),
  ('gl_amount', 'GL Amount', 'number', 'financial', 'Total general ledger amount on the report'),
  ('original_budget', 'Original Budget', 'number', 'financial', 'Original budget amount per cost code'),
  ('doubletime_hours', 'Doubletime Hours', 'number', 'financial', 'Hours worked at doubletime rate'),
  ('source', 'Source', 'string', 'admin', 'Transaction source (PR, AP, GL, etc.)'),
  ('document_date', 'Document Date', 'date', 'schedule', 'Date on the source document'),
  ('posted_date', 'Posted Date', 'date', 'schedule', 'Date the transaction was posted'),
  ('number', 'Number', 'string', 'identity', 'Transaction or document number'),
  ('name', 'Name', 'string', 'identity', 'Worker or vendor name'),
  ('regular_amount', 'Regular Amount', 'number', 'financial', 'Dollar amount for regular hours'),
  ('overtime_amount', 'Overtime Amount', 'number', 'financial', 'Dollar amount for overtime hours'),
  ('actual_amount', 'Actual Amount', 'number', 'financial', 'Total actual transaction amount'),
  ('check_number', 'Check Number', 'string', 'identity', 'Payroll check number'),
  ('regular_hours', 'Regular Hours', 'number', 'financial', 'Hours worked at regular rate'),
  ('overtime_hours', 'Overtime Hours', 'number', 'financial', 'Hours worked at overtime rate'),
  ('description', 'Description', 'string', 'general', 'Cost code or line item description'),
  ('job_name', 'Job Name', 'string', 'identity', 'Project or job name'),
  ('company', 'Company', 'string', 'admin', 'Company or entity name'),
  ('revised_budget', 'Revised Budget', 'number', 'financial', 'Current revised budget amount'),
  ('change_orders', 'Change Orders', 'number', 'financial', 'Change order amount for cost code'),
  ('jtd_cost', 'Job-to-Date Cost', 'number', 'financial', 'Cumulative cost to date per cost code'),
  ('pct_budget_consumed', '% Budget Consumed', 'number', 'financial', 'Percentage of budget used per cost code'),
  ('over_under_budget', 'Over/Under Budget', 'number', 'financial', 'Dollar over/under budget per cost code')
ON CONFLICT (canonical_name) DO NOTHING;

-- Fix types for fields that were seeded as 'string' but are actually 'number'
UPDATE field_catalog SET field_type = 'number' WHERE canonical_name = 'contract_value' AND field_type = 'string';
UPDATE field_catalog SET field_type = 'number' WHERE canonical_name = 'regular_hours' AND field_type = 'string';
UPDATE field_catalog SET field_type = 'number' WHERE canonical_name = 'overtime_hours' AND field_type = 'string';
UPDATE field_catalog SET field_type = 'number' WHERE canonical_name = 'revised_budget' AND field_type = 'string';
UPDATE field_catalog SET field_type = 'number' WHERE canonical_name = 'jtd_cost' AND field_type = 'string';
UPDATE field_catalog SET field_type = 'number' WHERE canonical_name = 'change_orders' AND field_type = 'string';
UPDATE field_catalog SET field_type = 'number' WHERE canonical_name = 'pct_budget_consumed' AND field_type = 'string';
UPDATE field_catalog SET field_type = 'number' WHERE canonical_name = 'over_under_budget' AND field_type = 'string';
UPDATE field_catalog SET field_type = 'number' WHERE canonical_name = 'total_revised_budget' AND field_type = 'string';
UPDATE field_catalog SET field_type = 'number' WHERE canonical_name = 'total_jtd_cost' AND field_type = 'string';
UPDATE field_catalog SET field_type = 'number' WHERE canonical_name = 'total_change_orders' AND field_type = 'string';
UPDATE field_catalog SET field_type = 'number' WHERE canonical_name = 'total_over_under_budget' AND field_type = 'string';
UPDATE field_catalog SET field_type = 'number' WHERE canonical_name = 'overall_pct_budget_consumed' AND field_type = 'string';

-- ============================================================
-- PART 2: Delete stale JCR skill_fields rows (16 non-v4 fields)
-- These are either derived (now in derived_fields), aspirational, or not in v4.
-- ============================================================

DELETE FROM skill_fields
WHERE skill_id = 'job_cost_report'
  AND field_id IN (
    SELECT id FROM field_catalog WHERE canonical_name IN (
      'report_id',
      'report_category',
      'cost_to_complete',
      'estimated_margin',
      'work_phase',
      'csi_division',
      'uniformat_code',
      'variance_trend',
      'labor_productivity_rate',
      'estimated_labor_rate',
      'material_price_variance',
      'labor_to_material_ratio',
      'co_absorption_rate',
      'variance_root_cause',
      'forecast_to_complete',
      'lessons_learned'
    )
  );

-- Also delete old cost_code / line-item fields that used non-v4 canonical names
-- (they will be re-inserted below with correct v4 names + scopes)
DELETE FROM skill_fields
WHERE skill_id = 'job_cost_report'
  AND field_id IN (
    SELECT id FROM field_catalog WHERE canonical_name IN (
      'company_entity',
      'project',
      'line_item_description',
      'revised_budget_line',
      'change_orders_line',
      'jtd_cost_line',
      'pct_budget_consumed_line',
      'over_under_budget_line',
      'quantity'
    )
  );

-- ============================================================
-- PART 3: Update existing doc-scoped skill_fields for JCR
-- Set display_override = NULL so canonical_name is used,
-- update descriptions with v4 notes, fix tier/required.
-- ============================================================

-- job_number (already correct canonical, update metadata)
UPDATE skill_fields SET
  display_override = NULL,
  description = 'Unique job identifier from the cost report header',
  tier = 0, required = true, importance = 'E', scope = 'doc'
WHERE skill_id = 'job_cost_report'
  AND field_id = (SELECT id FROM field_catalog WHERE canonical_name = 'job_number');

-- report_period
UPDATE skill_fields SET
  display_override = NULL,
  description = 'Reporting period covered (e.g., "01/01/2024 – 01/31/2024")',
  tier = 0, required = true, importance = 'P', scope = 'doc'
WHERE skill_id = 'job_cost_report'
  AND field_id = (SELECT id FROM field_catalog WHERE canonical_name = 'report_period');

-- report_date
UPDATE skill_fields SET
  display_override = NULL,
  description = 'Date the report was generated or printed',
  tier = 0, required = true, importance = 'E', scope = 'doc'
WHERE skill_id = 'job_cost_report'
  AND field_id = (SELECT id FROM field_catalog WHERE canonical_name = 'report_date');

-- total_revised_budget
UPDATE skill_fields SET
  display_override = NULL,
  description = 'Sum of all cost-code revised budgets; document-level total',
  tier = 0, required = true, importance = 'P', scope = 'doc'
WHERE skill_id = 'job_cost_report'
  AND field_id = (SELECT id FROM field_catalog WHERE canonical_name = 'total_revised_budget');

-- total_jtd_cost
UPDATE skill_fields SET
  display_override = NULL,
  description = 'Sum of all cost-code JTD costs; document-level total',
  tier = 0, required = true, importance = 'P', scope = 'doc'
WHERE skill_id = 'job_cost_report'
  AND field_id = (SELECT id FROM field_catalog WHERE canonical_name = 'total_jtd_cost');

-- total_change_orders
UPDATE skill_fields SET
  display_override = NULL,
  description = 'Total approved change orders across all cost codes',
  tier = 0, required = true, importance = 'P', scope = 'doc'
WHERE skill_id = 'job_cost_report'
  AND field_id = (SELECT id FROM field_catalog WHERE canonical_name = 'total_change_orders');

-- overall_pct_budget_consumed
UPDATE skill_fields SET
  display_override = NULL,
  description = 'Total JTD cost / Total revised budget × 100',
  tier = 0, required = true, importance = 'P', scope = 'doc'
WHERE skill_id = 'job_cost_report'
  AND field_id = (SELECT id FROM field_catalog WHERE canonical_name = 'overall_pct_budget_consumed');

-- total_over_under_budget
UPDATE skill_fields SET
  display_override = NULL,
  description = 'Total revised budget – Total JTD cost; positive = under budget',
  tier = 0, required = true, importance = 'P', scope = 'doc'
WHERE skill_id = 'job_cost_report'
  AND field_id = (SELECT id FROM field_catalog WHERE canonical_name = 'total_over_under_budget');

-- project_type
UPDATE skill_fields SET
  display_override = NULL,
  description = 'Type of construction project (Healthcare, Commercial, K-12, etc.)',
  tier = 1, required = false, importance = 'P', scope = 'doc'
WHERE skill_id = 'job_cost_report'
  AND field_id = (SELECT id FROM field_catalog WHERE canonical_name = 'project_type');

-- trade
UPDATE skill_fields SET
  display_override = NULL,
  description = 'Primary trade or scope of work (Mechanical, Electrical, etc.)',
  tier = 1, required = false, importance = 'P', scope = 'doc'
WHERE skill_id = 'job_cost_report'
  AND field_id = (SELECT id FROM field_catalog WHERE canonical_name = 'trade');

-- ============================================================
-- PART 4: Insert new doc-scoped skill_fields for JCR
-- Fields that didn't exist before (company, job_name, client, etc.)
-- ============================================================

INSERT INTO skill_fields (skill_id, field_id, display_override, tier, required, importance, description, scope, sort_order)
VALUES
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'job_name'),
   NULL, 0, true, 'E', 'Project or job name/description from the report header', 'doc', 2),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'company'),
   NULL, 0, true, 'E', 'Company or entity that owns the job', 'doc', 3),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'client'),
   NULL, 1, false, 'S', 'Client or owner name if listed', 'doc', 4),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'contract_value'),
   NULL, 0, true, 'P', 'Original contract value or total contract amount', 'doc', 15),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'pr_amount'),
   NULL, 1, false, 'P', 'Total payroll amount shown on the report', 'doc', 16),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'ap_amount'),
   NULL, 1, false, 'P', 'Total accounts payable amount shown on the report', 'doc', 17),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'gl_amount'),
   NULL, 1, false, 'P', 'Total general ledger amount shown on the report', 'doc', 18)
ON CONFLICT (skill_id, field_id, scope) DO NOTHING;

-- ============================================================
-- PART 5: Insert cost_code-scoped skill_fields for JCR (12 fields)
-- ============================================================

INSERT INTO skill_fields (skill_id, field_id, display_override, tier, required, importance, description, scope, sort_order)
VALUES
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'cost_code'),
   NULL, 0, true, 'E', 'Cost code identifier (e.g., 011, 020, 300)', 'cost_code', 1),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'description'),
   NULL, 0, true, 'E', 'Cost code description (e.g., "DS & RD Labor", "Earthwork")', 'cost_code', 2),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'cost_category'),
   NULL, 1, false, 'S', 'Category label (Labor, Material, Subcontract, Equipment, Other)', 'cost_code', 3),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'original_budget'),
   NULL, 0, true, 'P', 'Original budgeted amount for this cost code', 'cost_code', 4),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'revised_budget'),
   NULL, 0, true, 'P', 'Current revised budget after approved changes', 'cost_code', 5),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'change_orders'),
   NULL, 0, true, 'P', 'Net approved change order amount for this cost code', 'cost_code', 6),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'jtd_cost'),
   NULL, 0, true, 'P', 'Cumulative job-to-date cost for this cost code', 'cost_code', 7),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'over_under_budget'),
   NULL, 0, true, 'P', 'Revised budget minus JTD cost; positive = under budget', 'cost_code', 8),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'pct_budget_consumed'),
   NULL, 0, true, 'P', 'JTD cost / Revised budget × 100', 'cost_code', 9),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'regular_hours'),
   NULL, 1, false, 'P', 'Regular (straight-time) labor hours for this cost code', 'cost_code', 10),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'overtime_hours'),
   NULL, 1, false, 'P', 'Overtime labor hours for this cost code', 'cost_code', 11),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'doubletime_hours'),
   NULL, 1, false, 'P', 'Doubletime labor hours for this cost code', 'cost_code', 12)
ON CONFLICT (skill_id, field_id, scope) DO NOTHING;

-- ============================================================
-- PART 6: Insert payroll_transactions-scoped skill_fields for JCR (13 fields)
-- ============================================================

INSERT INTO skill_fields (skill_id, field_id, display_override, tier, required, importance, description, scope, sort_order)
VALUES
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'cost_code'),
   NULL, 0, true, 'E', 'Cost code the payroll transaction is charged to', 'payroll_transactions', 1),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'description'),
   NULL, 0, true, 'E', 'Cost code description for context', 'payroll_transactions', 2),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'source'),
   NULL, 0, true, 'A', 'Transaction source type (PR = Payroll)', 'payroll_transactions', 3),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'document_date'),
   NULL, 1, false, 'S', 'Date on the source payroll document', 'payroll_transactions', 4),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'posted_date'),
   NULL, 1, false, 'S', 'Date the transaction was posted to the ledger', 'payroll_transactions', 5),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'number'),
   NULL, 1, false, 'A', 'Transaction reference number', 'payroll_transactions', 6),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'name'),
   NULL, 0, true, 'E', 'Worker name from the payroll line', 'payroll_transactions', 7),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'regular_hours'),
   NULL, 0, true, 'P', 'Regular (straight-time) hours for this transaction', 'payroll_transactions', 8),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'overtime_hours'),
   NULL, 0, true, 'P', 'Overtime hours for this transaction', 'payroll_transactions', 9),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'regular_amount'),
   NULL, 0, true, 'P', 'Dollar amount for regular hours', 'payroll_transactions', 10),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'overtime_amount'),
   NULL, 0, true, 'P', 'Dollar amount for overtime hours', 'payroll_transactions', 11),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'actual_amount'),
   NULL, 0, true, 'P', 'Total actual amount for this transaction', 'payroll_transactions', 12),
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'check_number'),
   NULL, 1, false, 'A', 'Payroll check number if available', 'payroll_transactions', 13)
ON CONFLICT (skill_id, field_id, scope) DO NOTHING;

-- Also remove the old doc-scoped cost_code + cost_category that were line-item fields
-- misplaced in doc scope (they now live in cost_code scope)
DELETE FROM skill_fields
WHERE skill_id = 'job_cost_report'
  AND scope = 'doc'
  AND field_id IN (
    SELECT id FROM field_catalog WHERE canonical_name IN ('cost_code', 'cost_category')
  );

COMMIT;
