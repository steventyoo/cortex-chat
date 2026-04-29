-- Generic Skill Pipeline: schema-driven ops, org-customizable code ranges,
-- new derived fields, and null-safety fixes for consistency checks.

-- ================================================================
-- 1. Create skill_pipeline_ops table
-- ================================================================

CREATE TABLE IF NOT EXISTS skill_pipeline_ops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id TEXT NOT NULL REFERENCES document_skills(skill_id),
  op_name TEXT NOT NULL,
  op_type TEXT NOT NULL CHECK (op_type IN (
    'column_swap', 'aggregate', 'filter', 'deduplicate', 'rename', 'coerce', 'split'
  )),
  scope TEXT NOT NULL,
  target_collection TEXT,
  config JSONB NOT NULL,
  priority INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(skill_id, op_name)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_ops_skill ON skill_pipeline_ops(skill_id);

ALTER TABLE skill_pipeline_ops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for skill_pipeline_ops" ON skill_pipeline_ops
  FOR ALL USING (true) WITH CHECK (true);

-- ================================================================
-- 2. Add code_ranges to org_skill_configs for per-org overrides
-- ================================================================

ALTER TABLE org_skill_configs
  ADD COLUMN IF NOT EXISTS code_ranges JSONB DEFAULT NULL;

-- ================================================================
-- 3. Seed JCR pipeline ops
-- ================================================================

INSERT INTO skill_pipeline_ops (skill_id, op_name, op_type, scope, target_collection, config, priority)
VALUES
('job_cost_report', 'column_swap_jtd_ou', 'column_swap', 'cost_code', NULL, '{
  "field_a": "jtd_cost",
  "field_b": "over_under_budget",
  "detection": "majority_abs_greater",
  "recompute_after_swap": {
    "over_under_budget": "jtd_cost - (revised_budget || original_budget)"
  }
}'::jsonb, 0),

('job_cost_report', 'aggregate_workers', 'aggregate', 'payroll_transactions', 'worker', '{
  "group_by": ["name"],
  "name_aliases": ["worker_name", "employee_name", "employee", "emp_name", "worker"],
  "aggregations": {
    "regular_hours": "SUM",
    "overtime_hours": "SUM",
    "doubletime_hours": "SUM",
    "actual_amount": "SUM",
    "regular_amount": "SUM",
    "overtime_amount": "SUM",
    "doubletime_amount": "SUM"
  },
  "computed_fields": {
    "transaction_count": "COUNT",
    "worker_total_hrs": "regular_hours + overtime_hours + doubletime_hours",
    "worker_ot_pct": "safe(overtime_hours, regular_hours + overtime_hours + doubletime_hours) * 100",
    "worker_rate": "safe(actual_amount, regular_hours + overtime_hours + doubletime_hours)",
    "worker_nominal_rate": "safe(regular_amount, regular_hours)",
    "worker_codes": "COUNT_DISTINCT(cost_code)"
  },
  "reversal_detection": {
    "indicator_field": "actual_amount",
    "indicator_condition": "< 0",
    "negate_fields": ["regular_hours", "overtime_hours", "doubletime_hours"]
  }
}'::jsonb, 10);

-- ================================================================
-- 4. Insert new derived fields (base aggregations using ctx.meta.code_ranges)
-- ================================================================

-- Remove any existing rows for fields we're about to insert/update
DELETE FROM derived_fields WHERE primary_skill_id = 'job_cost_report'
  AND canonical_name IN (
    'total_revised_budget', 'total_jtd_cost', 'overunder_budget_line',
    'overall_pct_budget_consumed', 'pr_amount', 'ap_amount', 'gl_amount',
    'pct_budget_consumed', 'change_orders'
  );

INSERT INTO derived_fields (canonical_name, display_name, source_skill_ids, primary_skill_id, tab, section, data_type, status, scope, formula, expression, depends_on, is_active)
VALUES

-- Doc-scope base aggregations
('total_revised_budget', 'Total Revised Budget', ARRAY['job_cost_report'], 'job_cost_report',
 'Overview', 'Financial Summary', 'currency', 'Derived', 'doc',
 'SUM(revised_budget) excl. revenue codes from ctx.meta.code_ranges',
 'safe(() => { const revCodes = (ctx.meta.code_ranges || {}).revenue || [999]; const isRev = (n) => revCodes.some(r => Array.isArray(r) ? n >= r[0] && n <= r[1] : n === r); const codes = ctx.collections.cost_code || []; return rd(codes.filter(c => !isRev(parseInt(c.cost_code, 10))).reduce((s, c) => s + (c.revised_budget || 0), 0), 2); })',
 '{}', true),

('total_jtd_cost', 'Total JTD Cost', ARRAY['job_cost_report'], 'job_cost_report',
 'Overview', 'Financial Summary', 'currency', 'Derived', 'doc',
 'SUM(jtd_cost) excl. revenue codes from ctx.meta.code_ranges',
 'safe(() => { const revCodes = (ctx.meta.code_ranges || {}).revenue || [999]; const isRev = (n) => revCodes.some(r => Array.isArray(r) ? n >= r[0] && n <= r[1] : n === r); const codes = ctx.collections.cost_code || []; return rd(codes.filter(c => !isRev(parseInt(c.cost_code, 10))).reduce((s, c) => s + (c.jtd_cost || 0), 0), 2); })',
 '{}', true),

('overunder_budget_line', 'Over/Under Budget', ARRAY['job_cost_report'], 'job_cost_report',
 'Overview', 'Financial Summary', 'currency', 'Derived', 'doc',
 'total_revised_budget - total_jtd_cost',
 'safe(() => rd((ctx.doc.total_revised_budget || 0) - (ctx.doc.total_jtd_cost || 0), 2))',
 '{total_revised_budget,total_jtd_cost}', true),

('overall_pct_budget_consumed', 'Budget Consumed %', ARRAY['job_cost_report'], 'job_cost_report',
 'Overview', 'Financial Summary', 'percent', 'Derived', 'doc',
 'total_jtd_cost / total_revised_budget * 100',
 'safe(() => { const bud = ctx.doc.total_revised_budget || 0; const jtd = ctx.doc.total_jtd_cost || 0; return bud > 0 ? rd(jtd / bud * 100, 2) : null; })',
 '{total_revised_budget,total_jtd_cost}', true),

('pr_amount', 'PR Amount (Payroll)', ARRAY['job_cost_report'], 'job_cost_report',
 'Overview', 'Cost by Source', 'currency', 'Derived', 'doc',
 'SUM(actual_amount) WHERE source = PR from payroll_transactions',
 'safe(() => { const txns = ctx.collections.payroll_transactions || []; return rd(txns.filter(t => String(t.source || "").toUpperCase() === "PR").reduce((s, t) => s + (t.actual_amount || 0), 0), 2); })',
 '{}', true),

('ap_amount', 'AP Amount (Accounts Payable)', ARRAY['job_cost_report'], 'job_cost_report',
 'Overview', 'Cost by Source', 'currency', 'Derived', 'doc',
 'SUM(actual_amount) WHERE source = AP from payroll_transactions',
 'safe(() => { const txns = ctx.collections.payroll_transactions || []; return rd(txns.filter(t => String(t.source || "").toUpperCase() === "AP").reduce((s, t) => s + (t.actual_amount || 0), 0), 2); })',
 '{}', true),

('gl_amount', 'GL Amount (General Ledger)', ARRAY['job_cost_report'], 'job_cost_report',
 'Overview', 'Cost by Source', 'currency', 'Derived', 'doc',
 'SUM(actual_amount) WHERE source = GL from payroll_transactions',
 'safe(() => { const txns = ctx.collections.payroll_transactions || []; return rd(txns.filter(t => String(t.source || "").toUpperCase() === "GL").reduce((s, t) => s + (t.actual_amount || 0), 0), 2); })',
 '{}', true),

-- Per-record (cost_code scope) derived fields
('pct_budget_consumed', 'Budget Consumed %', ARRAY['job_cost_report'], 'job_cost_report',
 'Budget vs Actual', 'Per Code', 'percent', 'Derived', 'cost_code',
 '(jtd_cost / revised_budget) * 100',
 'safe(() => { const bud = ctx.current.revised_budget || 0; const jtd = ctx.current.jtd_cost || 0; return bud > 0 ? rd(jtd / bud * 100, 2) : null; })',
 '{}', true),

('change_orders', 'Change Orders', ARRAY['job_cost_report'], 'job_cost_report',
 'Budget vs Actual', 'Per Code', 'currency', 'Derived', 'cost_code',
 'revised_budget - original_budget',
 'safe(() => rd((ctx.current.revised_budget || 0) - (ctx.current.original_budget || 0), 2))',
 '{}', true);

-- ================================================================
-- 5. Update existing derived expressions to use ctx.meta.code_ranges
-- ================================================================

-- material_cost: use ctx.meta.code_ranges.material instead of hardcoded ranges
UPDATE derived_fields SET
  expression = 'safe(() => { const matCodes = (ctx.meta.code_ranges || {}).material || [39, [200, 299]]; const isMatch = (n) => matCodes.some(r => Array.isArray(r) ? n >= r[0] && n <= r[1] : n === r); const codes = ctx.collections.cost_code || []; return rd(codes.filter(c => isMatch(parseInt(c.cost_code, 10))).reduce((s, c) => s + (c.jtd_cost || 0), 0), 2); })',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'material_cost';

-- material_total_budget
UPDATE derived_fields SET
  expression = 'safe(() => { const matCodes = (ctx.meta.code_ranges || {}).material || [39, [200, 299]]; const isMatch = (n) => matCodes.some(r => Array.isArray(r) ? n >= r[0] && n <= r[1] : n === r); const codes = ctx.collections.cost_code || []; return rd(codes.filter(c => isMatch(parseInt(c.cost_code, 10))).reduce((s, c) => s + (c.revised_budget || 0), 0), 2); })',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'material_total_budget';

-- material_total_actual
UPDATE derived_fields SET
  expression = 'safe(() => { const matCodes = (ctx.meta.code_ranges || {}).material || [39, [200, 299]]; const isMatch = (n) => matCodes.some(r => Array.isArray(r) ? n >= r[0] && n <= r[1] : n === r); const codes = ctx.collections.cost_code || []; return rd(codes.filter(c => isMatch(parseInt(c.cost_code, 10))).reduce((s, c) => s + (c.jtd_cost || 0), 0), 2); })',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'material_total_actual';

-- labor_unit_cost_per_hr: use ctx.meta.code_ranges.labor
UPDATE derived_fields SET
  expression = 'safe(() => { const labCodes = (ctx.meta.code_ranges || {}).labor || [11, [100, 199]]; const isMatch = (n) => labCodes.some(r => Array.isArray(r) ? n >= r[0] && n <= r[1] : n === r); const codes = ctx.collections.cost_code || []; const laborCodes = codes.filter(c => isMatch(parseInt(c.cost_code, 10))); const cost = laborCodes.reduce((s, c) => s + (c.jtd_cost || 0), 0); const hrs = ctx.doc.total_labor_hours || 0; return hrs > 0 ? rd(cost / hrs, 2) : null; })',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'labor_unit_cost_per_hr';

-- recon_labor_budget
UPDATE derived_fields SET
  expression = 'safe(() => { const labCodes = (ctx.meta.code_ranges || {}).labor || [11, [100, 199]]; const isMatch = (n) => labCodes.some(r => Array.isArray(r) ? n >= r[0] && n <= r[1] : n === r); const codes = ctx.collections.cost_code || []; return rd(codes.filter(c => isMatch(parseInt(c.cost_code, 10))).reduce((s, c) => s + (c.revised_budget || 0), 0), 2); })',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'recon_labor_budget';

-- recon_labor_jtd
UPDATE derived_fields SET
  expression = 'safe(() => { const labCodes = (ctx.meta.code_ranges || {}).labor || [11, [100, 199]]; const isMatch = (n) => labCodes.some(r => Array.isArray(r) ? n >= r[0] && n <= r[1] : n === r); const codes = ctx.collections.cost_code || []; return rd(codes.filter(c => isMatch(parseInt(c.cost_code, 10))).reduce((s, c) => s + (c.jtd_cost || 0), 0), 2); })',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'recon_labor_jtd';

-- recon_material_budget
UPDATE derived_fields SET
  expression = 'safe(() => { const matCodes = (ctx.meta.code_ranges || {}).material || [39, [200, 299]]; const isMatch = (n) => matCodes.some(r => Array.isArray(r) ? n >= r[0] && n <= r[1] : n === r); const codes = ctx.collections.cost_code || []; return rd(codes.filter(c => isMatch(parseInt(c.cost_code, 10))).reduce((s, c) => s + (c.revised_budget || 0), 0), 2); })',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'recon_material_budget';

-- recon_material_jtd
UPDATE derived_fields SET
  expression = 'safe(() => { const matCodes = (ctx.meta.code_ranges || {}).material || [39, [200, 299]]; const isMatch = (n) => matCodes.some(r => Array.isArray(r) ? n >= r[0] && n <= r[1] : n === r); const codes = ctx.collections.cost_code || []; return rd(codes.filter(c => isMatch(parseInt(c.cost_code, 10))).reduce((s, c) => s + (c.jtd_cost || 0), 0), 2); })',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'recon_material_jtd';

-- burden_cost: use ctx.meta.code_ranges.burden
UPDATE derived_fields SET
  expression = 'safe(() => { const burCodes = (ctx.meta.code_ranges || {}).burden || [995, 998]; const isMatch = (n) => burCodes.some(r => Array.isArray(r) ? n >= r[0] && n <= r[1] : n === r); const codes = ctx.collections.cost_code || []; return rd(codes.filter(c => isMatch(parseInt(c.cost_code, 10))).reduce((s, c) => s + (c.jtd_cost || 0), 0), 2); })',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'burden_cost';

-- ================================================================
-- 6. Fix null-unsafe consistency check expressions
-- ================================================================

-- expense_codes_sum: add || [] guard
UPDATE consistency_checks SET
  expression = '(() => { const exp = ctx.doc.job_totals_expenses || ctx.doc.total_jtd_cost || 0; if (exp === 0) return { pass: true, message: "No expenses" }; const sum = (ctx.collections.cost_code || []).filter(r => String(r.cost_code) !== "999").reduce((s, r) => s + (r.jtd_cost || 0), 0); const delta = Math.abs(sum - exp); return { pass: delta <= 0.50, expected: exp, actual: rd(sum, 2), delta, message: delta <= 0.50 ? "Cost code sum matches expenses" : "sum=" + sum.toFixed(2) + " vs expenses=" + exp.toFixed(2) }; })()'
WHERE skill_id = 'job_cost_report' AND check_name = 'expense_codes_sum';

-- budget_codes_sum: add || [] guard
UPDATE consistency_checks SET
  expression = '(() => { const total = ctx.doc.total_revised_budget || 0; if (total === 0) return { pass: true, message: "No budget total" }; const sum = (ctx.collections.cost_code || []).filter(r => String(r.cost_code) !== "999").reduce((s, r) => s + (r.revised_budget || 0), 0); const delta = Math.abs(sum - total); return { pass: delta <= 0.50, expected: total, actual: rd(sum, 2), delta, message: delta <= 0.50 ? "Budget code sum matches total" : "sum=" + sum.toFixed(2) + " vs total=" + total.toFixed(2) }; })()'
WHERE skill_id = 'job_cost_report' AND check_name = 'budget_codes_sum';

-- code999_all_signs_negative: add || [] guard
UPDATE consistency_checks SET
  expression = '(() => { const c999 = (ctx.collections.cost_code || []).find(r => String(r.cost_code) === "999"); if (!c999) return { pass: true, message: "No code 999" }; const fields = ["original_budget", "revised_budget", "jtd_cost"]; const violations = fields.filter(f => (c999[f] || 0) > 0); return { pass: violations.length === 0, expected: "all <= 0", actual: violations.join(","), delta: null, message: violations.length === 0 ? "All code 999 values non-positive" : "Positive values in code 999: " + violations.join(", ") }; })()'
WHERE skill_id = 'job_cost_report' AND check_name = 'code999_all_signs_negative';

-- revenue_equals_code999: add || [] guard
UPDATE consistency_checks SET
  expression = '(() => { const rev = ctx.doc.job_totals_revenue || 0; const c999 = (ctx.collections.cost_code || []).find(r => String(r.cost_code) === "999"); if (!c999) return { pass: true, message: "No code 999 found" }; const absJtd = Math.abs(c999.jtd_cost || 0); const delta = Math.abs(rev - absJtd); return { pass: delta <= 0.01, expected: absJtd, actual: rev, delta, message: delta <= 0.01 ? "Revenue matches code 999" : "Revenue=" + rev.toFixed(2) + " vs |code999|=" + absJtd.toFixed(2) }; })()'
WHERE skill_id = 'job_cost_report' AND check_name = 'revenue_equals_code999';

-- pr_hours_exact_match: add || [] guard on cost_code
UPDATE consistency_checks SET
  expression = '(() => { const workers = ctx.collections.worker || []; if (workers.length === 0) return { pass: true, message: "No workers" }; const wHours = workers.reduce((s, w) => s + (w.regular_hours || 0) + (w.overtime_hours || 0), 0); const laborCodes = (ctx.collections.cost_code || []).filter(r => { const c = parseInt(String(r.cost_code || 0)); return (c >= 100 && c <= 199) || c === 11; }); const ccHours = laborCodes.reduce((s, r) => s + (r.regular_hours || 0) + (r.overtime_hours || 0), 0); if (ccHours === 0) return { pass: true, message: "No cost code hours" }; const delta = Math.abs(wHours - ccHours); return { pass: delta <= 0.5, expected: ccHours, actual: rd(wHours, 1), delta, message: delta <= 0.5 ? "Worker hours match cost code hours" : "worker_hours=" + wHours.toFixed(1) + " vs cc_hours=" + ccHours.toFixed(1) }; })()'
WHERE skill_id = 'job_cost_report' AND check_name = 'pr_hours_exact_match';

-- worker_count_vs_labor_codes: add || [] guard on cost_code
UPDATE consistency_checks SET
  expression = '(() => { const workers = ctx.collections.worker || []; const laborCodesWithHours = (ctx.collections.cost_code || []).filter(r => { const c = parseInt(String(r.cost_code || 0)); const isLabor = (c >= 100 && c <= 199) || c === 11; return isLabor && ((r.regular_hours || 0) + (r.overtime_hours || 0)) > 0; }); if (laborCodesWithHours.length === 0) return { pass: true, message: "No labor codes with hours" }; const pass = workers.length >= laborCodesWithHours.length; return { pass, expected: ">= " + laborCodesWithHours.length, actual: workers.length, delta: null, message: pass ? "Worker count OK" : workers.length + " workers but " + laborCodesWithHours.length + " labor codes with hours" }; })()'
WHERE skill_id = 'job_cost_report' AND check_name = 'worker_count_vs_labor_codes';

-- ================================================================
-- 7. Remove gl_overhead from code_ranges (incorrect for source classification)
-- ================================================================

UPDATE document_skills
SET code_ranges = code_ranges - 'gl_overhead'
WHERE skill_id = 'job_cost_report';

-- ================================================================
-- 8. Deactivate cached parser (will regenerate with new hints)
-- ================================================================

UPDATE parser_cache SET is_active = false WHERE skill_id = 'job_cost_report';

-- ================================================================
-- 9. Remove pr_amount, ap_amount, gl_amount from skill_fields (now derived)
-- ================================================================

DELETE FROM skill_fields
WHERE skill_id = 'job_cost_report'
  AND canonical_name IN ('pr_amount', 'ap_amount', 'gl_amount');
