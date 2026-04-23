-- Migration: JCR Schema v4 alignment
-- 1. Add extraction_hint to key skill_fields rows for better codegen parsing
-- 2. Insert missing job_totals_by_source fields into field_catalog + skill_fields
-- 3. Add job_totals_net_due to field_catalog + skill_fields + derived_fields

BEGIN;

-- ============================================================
-- PART 1: Add extraction hints to cost_code-scoped fields
-- These give the LLM explicit guidance on where/how to parse values
-- ============================================================

-- regular_hours (cost_code scope): in the "Cost Code Totals" columns
UPDATE skill_fields
SET extraction_hint = 'Found in the Cost Code Totals row for each cost code section. Column order in Sage: Cost Code | Description | Original Budget | Revised Budget | Open Commits | JTD Cost | Over/Under Budget | Regular Hours | Overtime Hours. Hours appear as integers or decimals (e.g. "155.00"). Only labor cost codes (011, 1xx) have hours.'
WHERE skill_id = 'job_cost_report'
  AND scope = 'cost_code'
  AND field_id = (SELECT id FROM field_catalog WHERE canonical_name = 'regular_hours');

-- overtime_hours (cost_code scope)
UPDATE skill_fields
SET extraction_hint = 'Same row as regular_hours in Cost Code Totals. Appears in the last column. May be 0.00 for non-labor codes. Look for decimal values like "28.00" or "1261.50".'
WHERE skill_id = 'job_cost_report'
  AND scope = 'cost_code'
  AND field_id = (SELECT id FROM field_catalog WHERE canonical_name = 'overtime_hours');

-- regular_amount (payroll_transactions scope): base wage on PR transaction lines
UPDATE skill_fields
SET extraction_hint = 'BASE WAGE amount on the PR transaction line — NOT the burdened/loaded amount. Each PR line in a cost code section shows: "PR <ref> <date> <emp_code> <Worker Name>" on one line, followed by "MM/DD/YY Regular: N hours AMOUNT" on the next. The AMOUNT after "Regular:" is the base wage. Do NOT include burden (codes 995/998).'
WHERE skill_id = 'job_cost_report'
  AND scope = 'payroll_transactions'
  AND field_id = (SELECT id FROM field_catalog WHERE canonical_name = 'regular_amount');

-- actual_amount (payroll_transactions scope)
UPDATE skill_fields
SET extraction_hint = 'Total line amount for the PR transaction — sum of regular_amount + overtime_amount for that line. This is the base wage total, NOT including burden allocation.'
WHERE skill_id = 'job_cost_report'
  AND scope = 'payroll_transactions'
  AND field_id = (SELECT id FROM field_catalog WHERE canonical_name = 'actual_amount');

-- contract_value (doc scope)
UPDATE skill_fields
SET extraction_hint = 'Found in the report header or "Job Totals" section as total contract value or total billings. In Sage JDR, this equals the absolute value of revenue code 999 actual amount, or appears as "Total AR Billings" in the Job Totals section.'
WHERE skill_id = 'job_cost_report'
  AND scope = 'doc'
  AND field_id = (SELECT id FROM field_catalog WHERE canonical_name = 'contract_value');

-- ============================================================
-- PART 2: Insert job_totals_by_source fields
-- The "by Source" section in Job Totals breaks total expenses by PR/AP/GL
-- ============================================================

INSERT INTO field_catalog (canonical_name, display_name, field_type, category, description) VALUES
  ('job_totals_by_source_pr', 'Job Totals by Source: PR', 'number', 'financial', 'Total payroll cost from the "by Source" subsection of Job Totals — includes base wages + burden allocation'),
  ('job_totals_by_source_ap', 'Job Totals by Source: AP', 'number', 'financial', 'Total accounts payable cost from the "by Source" subsection of Job Totals'),
  ('job_totals_by_source_gl', 'Job Totals by Source: GL', 'number', 'financial', 'Total general ledger cost from the "by Source" subsection of Job Totals'),
  ('job_totals_net_due', 'Job Totals Net Due', 'number', 'financial', 'Net amount due (revenue - expenses - retainage) from the Job Totals section')
ON CONFLICT (canonical_name) DO NOTHING;

-- Insert into skill_fields for codegen visibility
INSERT INTO skill_fields (skill_id, field_id, display_override, tier, required, importance, description, scope, sort_order, extraction_hint)
VALUES
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'job_totals_by_source_pr'),
   NULL, 0, true, 'P', 'Total payroll (PR) from the Job Totals "by Source" subsection',
   'doc', 30,
   'Found in the "Job Totals" section at the end of the report, under the "by Source" breakdown. Look for a line like "PR  439,953.72" or "Payroll  439,953.72". This is the BURDENED total including burden codes 995/998.'),

  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'job_totals_by_source_ap'),
   NULL, 0, true, 'P', 'Total AP from the Job Totals "by Source" subsection',
   'doc', 31,
   'Found next to PR in the Job Totals by Source subsection. Look for "AP  408,537.07" or "Accounts Payable" line.'),

  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'job_totals_by_source_gl'),
   NULL, 0, true, 'P', 'Total GL from the Job Totals "by Source" subsection',
   'doc', 32,
   'Found next to AP in the Job Totals by Source subsection. Look for "GL  9,689.91" or "General Ledger" line.'),

  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'job_totals_net_due'),
   NULL, 1, false, 'P', 'Net amount due from the Job Totals section (revenue - expenses - retainage)',
   'doc', 33,
   'Found in the Job Totals section, typically labeled "Net Due" or calculated as revenue minus expenses minus retainage.')
ON CONFLICT (skill_id, field_id, scope) DO NOTHING;

-- ============================================================
-- PART 3: Add extraction hints to job_totals fields added in 20260429
-- (field_definitions were added but not as skill_fields with hints)
-- ============================================================

INSERT INTO skill_fields (skill_id, field_id, display_override, tier, required, importance, description, scope, sort_order, extraction_hint)
VALUES
  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'job_totals_revenue'),
   NULL, 0, true, 'P', 'Total revenue from the Job Totals section',
   'doc', 26,
   'Found in the "Job Totals" section near the end of the report. Look for "Revenue" or "Total AR Billings". In Sage, revenue is code 999 and shown as a NEGATIVE number (credit). Convert to positive (abs). Typical format: "Revenue  (1,391,455.00)" or "Revenue  -1,391,455.00"'),

  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'job_totals_expenses'),
   NULL, 0, true, 'P', 'Total expenses from the Job Totals section',
   'doc', 27,
   'Found in the "Job Totals" section. This is the sum of PR + AP + GL from "by Source". Typically labeled "Total Expenses" or "Total Cost". Should be a positive number.'),

  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'job_totals_net'),
   NULL, 0, true, 'P', 'Net profit from the Job Totals section (revenue - expenses)',
   'doc', 28,
   'Found in the "Job Totals" section as "Net" or "Net Profit". Equals abs(Revenue) - Total Expenses. Positive = profitable.'),

  ('job_cost_report', (SELECT id FROM field_catalog WHERE canonical_name = 'job_totals_retainage'),
   NULL, 1, false, 'P', 'Total retainage from the Job Totals section',
   'doc', 29,
   'Found in the "Job Totals" section as "Retainage" or "Retention". This is the amount held back from AR billings.')
ON CONFLICT (skill_id, field_id, scope) DO NOTHING;

-- ============================================================
-- PART 4: Add derived field for job_totals_net_due
-- ============================================================

INSERT INTO derived_fields (canonical_name, display_name, source_skill_ids, primary_skill_id, tab, section, data_type, status, scope, formula, expression, depends_on, is_active)
VALUES
  ('job_totals_net_due', 'Job Totals Net Due', ARRAY['job_cost_report'], 'job_cost_report', 'overview', 'financial_overview', 'currency', 'Derived', 'project',
   'Extracted from JDR Job Totals. Fallback: net - retainage',
   'safe(() => { const extracted = ctx.doc.job_totals_net_due; if (extracted != null && extracted !== 0) return extracted; const net = ctx.doc.job_totals_net; const ret = ctx.doc.job_totals_retainage; return (net != null && ret != null) ? rd(net - ret, 2) : null; })',
   ARRAY['job_totals_net', 'job_totals_retainage']::text[], true)
ON CONFLICT (canonical_name) DO NOTHING;

-- ============================================================
-- PART 5: Fix straight_time_rate and effective_hourly_rate to use base wages
-- (These were computing from burdened amounts; schema v4 says use base PR line amounts)
-- ============================================================

UPDATE derived_fields
SET formula = 'SUM(base regular_amount from PR transactions) / SUM(regular_hours from PR transactions)',
    expression = 'safe(() => { const txns = ctx.collections.payroll_transactions || []; if (txns.length === 0) return null; let totalAmt = 0, totalHrs = 0; for (const t of txns) { totalAmt += t.regular_amount || 0; totalHrs += t.regular_hours || 0; } return totalHrs > 0 ? rd(totalAmt / totalHrs, 2) : null; })'
WHERE canonical_name = 'straight_time_rate';

UPDATE derived_fields
SET formula = 'SUM(base regular_amount + overtime_amount from PR transactions) / SUM(regular_hours + overtime_hours)',
    expression = 'safe(() => { const txns = ctx.collections.payroll_transactions || []; if (txns.length === 0) return null; let totalAmt = 0, totalHrs = 0; for (const t of txns) { totalAmt += (t.regular_amount || 0) + (t.overtime_amount || 0); totalHrs += (t.regular_hours || 0) + (t.overtime_hours || 0); } return totalHrs > 0 ? rd(totalAmt / totalHrs, 2) : null; })'
WHERE canonical_name = 'effective_hourly_rate';

UPDATE derived_fields
SET formula = 'SUM(overtime_amount) - (straight_time_rate × SUM(overtime_hours))',
    expression = 'safe(() => { const txns = ctx.collections.payroll_transactions || []; if (txns.length === 0) return null; let totalRegAmt = 0, totalRegHrs = 0, totalOtAmt = 0, totalOtHrs = 0; for (const t of txns) { totalRegAmt += t.regular_amount || 0; totalRegHrs += t.regular_hours || 0; totalOtAmt += t.overtime_amount || 0; totalOtHrs += t.overtime_hours || 0; } const str8 = totalRegHrs > 0 ? totalRegAmt / totalRegHrs : 0; return rd(totalOtAmt - (str8 * totalOtHrs), 2); })'
WHERE canonical_name = 'ot_premium_cost';

COMMIT;
