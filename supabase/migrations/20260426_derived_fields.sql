-- derived_fields: config-driven formula specifications for computed values.
-- Each row defines a single derived field with its evaluation expression.
-- The generic evaluator (derived-evaluator.ts) loads these at runtime.

CREATE TABLE derived_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL,
  display_name TEXT NOT NULL,

  source_skill_ids TEXT[] NOT NULL,
  primary_skill_id TEXT NOT NULL REFERENCES document_skills(skill_id),

  tab TEXT NOT NULL,
  section TEXT NOT NULL,
  data_type TEXT NOT NULL CHECK (data_type IN ('currency','number','string','percent','integer','ratio','date')),
  status TEXT NOT NULL DEFAULT 'Derived' CHECK (status IN ('Derived','Cross-Ref')),

  scope TEXT NOT NULL,

  formula TEXT NOT NULL,
  expression TEXT NOT NULL,

  depends_on TEXT[] DEFAULT '{}',

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(primary_skill_id, canonical_name)
);

CREATE INDEX idx_derived_fields_skill ON derived_fields(primary_skill_id);
CREATE INDEX idx_derived_fields_source ON derived_fields USING GIN(source_skill_ids);

ALTER TABLE derived_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for derived_fields" ON derived_fields
  FOR ALL USING (true) WITH CHECK (true);


-- ================================================================
-- Seed: JCR derived fields (~47 formulas from v4 schema)
-- scope 'doc' = evaluate once per document
-- scope 'cost_code' = evaluate per cost-code record
-- scope 'worker' = evaluate per worker record
-- ================================================================

INSERT INTO derived_fields (canonical_name, display_name, source_skill_ids, primary_skill_id, tab, section, data_type, status, scope, formula, expression, depends_on) VALUES

-- ── Overview tab ─────────────────────────────────────────────

('total_over_under', 'Total Over/Under', ARRAY['job_cost_report'], 'job_cost_report',
 'Overview', 'Project Summary', 'currency', 'Derived', 'doc',
 'SUM of over_under_budget across all work cost codes (excl 999/Overhead)',
 'ctx.collections.cost_code.filter(r => r.cost_code !== "999" && !(r.cost_code || "").startsWith("Overhead")).reduce((s, r) => s + (r.over_under_budget || 0), 0)',
 '{}'),

('net_profit', 'Net Profit', ARRAY['job_cost_report'], 'job_cost_report',
 'Overview', 'Project Summary', 'currency', 'Derived', 'doc',
 'contract_value - total_jtd_cost',
 'ctx.doc.contract_value - ctx.doc.total_jtd_cost',
 '{contract_value,total_jtd_cost}'),

('gross_margin_pct', 'Gross Margin %', ARRAY['job_cost_report'], 'job_cost_report',
 'Overview', 'Project Summary', 'percent', 'Derived', 'doc',
 'net_profit / contract_value x 100',
 'safe(ctx.doc.net_profit, ctx.doc.contract_value) * 100',
 '{net_profit,contract_value}'),

('direct_cost_total', 'Direct Cost Total', ARRAY['job_cost_report'], 'job_cost_report',
 'Overview', 'Project Summary', 'currency', 'Derived', 'doc',
 'Same as total_jtd_cost (sum of all work codes JTD)',
 'ctx.doc.total_jtd_cost',
 '{total_jtd_cost}'),

('labor_cost', 'Labor Cost', ARRAY['job_cost_report'], 'job_cost_report',
 'Overview', 'Project Summary', 'currency', 'Derived', 'doc',
 'SUM of jtd_cost WHERE cost_category = labor',
 'ctx.collections.cost_code.filter(r => (r.cost_category || "").toLowerCase() === "labor").reduce((s, r) => s + (r.jtd_cost || 0), 0)',
 '{}'),

('material_cost', 'Material Cost', ARRAY['job_cost_report'], 'job_cost_report',
 'Overview', 'Project Summary', 'currency', 'Derived', 'doc',
 'SUM of jtd_cost WHERE cost_category = material',
 'ctx.collections.cost_code.filter(r => (r.cost_category || "").toLowerCase() === "material").reduce((s, r) => s + (r.jtd_cost || 0), 0)',
 '{}'),

('overhead_cost', 'Overhead Cost', ARRAY['job_cost_report'], 'job_cost_report',
 'Overview', 'Project Summary', 'currency', 'Derived', 'doc',
 'SUM of jtd_cost WHERE cost_category = overhead',
 'ctx.collections.cost_code.filter(r => (r.cost_category || "").toLowerCase() === "overhead").reduce((s, r) => s + (r.jtd_cost || 0), 0)',
 '{}'),

('subcontract_cost', 'Subcontract Cost', ARRAY['job_cost_report'], 'job_cost_report',
 'Overview', 'Project Summary', 'currency', 'Derived', 'doc',
 'SUM of jtd_cost WHERE cost_category = subcontract',
 'ctx.collections.cost_code.filter(r => (r.cost_category || "").toLowerCase() === "subcontract").reduce((s, r) => s + (r.jtd_cost || 0), 0)',
 '{}'),

('other_cost', 'Other Cost', ARRAY['job_cost_report'], 'job_cost_report',
 'Overview', 'Project Summary', 'currency', 'Derived', 'doc',
 'SUM of jtd_cost WHERE cost_category = other (excl 999)',
 'ctx.collections.cost_code.filter(r => (r.cost_category || "").toLowerCase() === "other" && r.cost_code !== "999").reduce((s, r) => s + (r.jtd_cost || 0), 0)',
 '{}'),

('total_labor_hours', 'Total Labor Hours', ARRAY['job_cost_report'], 'job_cost_report',
 'Overview', 'Project Summary', 'number', 'Derived', 'doc',
 'SUM of (regular_hours + overtime_hours) WHERE cost_category = labor',
 'ctx.collections.cost_code.filter(r => (r.cost_category || "").toLowerCase() === "labor").reduce((s, r) => s + (r.regular_hours || 0) + (r.overtime_hours || 0), 0)',
 '{}'),


-- ── Budget vs Actual tab (per cost code) ─────────────────────

('bva_variance_pct', 'Variance %', ARRAY['job_cost_report'], 'job_cost_report',
 'Budget vs Actual', 'Per Code', 'percent', 'Derived', 'cost_code',
 '(revised_budget - jtd_cost) / revised_budget x 100',
 '(ctx.current.revised_budget || 0) > 0 ? ((ctx.current.revised_budget - (ctx.current.jtd_cost || 0)) / ctx.current.revised_budget) * 100 : 0',
 '{}'),

('bva_status', 'Budget Status', ARRAY['job_cost_report'], 'job_cost_report',
 'Budget vs Actual', 'Per Code', 'string', 'Derived', 'cost_code',
 'Under Budget if over_under >= 0 else Over Budget',
 '(ctx.current.over_under_budget || 0) >= 0 ? "Under Budget" : "Over Budget"',
 '{}'),


-- ── Material tab ─────────────────────────────────────────────

('mat_variance', 'Material Variance', ARRAY['job_cost_report'], 'job_cost_report',
 'Material', 'Material Codes', 'currency', 'Derived', 'cost_code',
 'revised_budget - jtd_cost (for material codes only)',
 '(ctx.current.revised_budget || 0) - (ctx.current.jtd_cost || 0)',
 '{}'),

('mat_pct_used', 'Material % Used', ARRAY['job_cost_report'], 'job_cost_report',
 'Material', 'Material Codes', 'percent', 'Derived', 'cost_code',
 'jtd_cost / revised_budget x 100 for material codes',
 '(ctx.current.revised_budget || 0) > 0 ? ((ctx.current.jtd_cost || 0) / ctx.current.revised_budget) * 100 : null',
 '{}'),

('material_total_budget', 'Total Material Budget', ARRAY['job_cost_report'], 'job_cost_report',
 'Material', 'Summary', 'currency', 'Derived', 'doc',
 'SUM of revised_budget WHERE cost_category = material',
 'ctx.collections.cost_code.filter(r => (r.cost_category || "").toLowerCase() === "material").reduce((s, r) => s + (r.revised_budget || 0), 0)',
 '{}'),

('material_total_actual', 'Total Material Actual', ARRAY['job_cost_report'], 'job_cost_report',
 'Material', 'Summary', 'currency', 'Derived', 'doc',
 'SUM of jtd_cost WHERE cost_category = material',
 'ctx.collections.cost_code.filter(r => (r.cost_category || "").toLowerCase() === "material").reduce((s, r) => s + (r.jtd_cost || 0), 0)',
 '{}'),

('material_total_variance', 'Total Material Variance', ARRAY['job_cost_report'], 'job_cost_report',
 'Material', 'Summary', 'currency', 'Derived', 'doc',
 'material_total_budget - material_total_actual',
 'ctx.doc.material_total_budget - ctx.doc.material_total_actual',
 '{material_total_budget,material_total_actual}'),


-- ── Cost Breakdown tab ───────────────────────────────────────

('source_pr_pct', 'Payroll %', ARRAY['job_cost_report'], 'job_cost_report',
 'Cost Breakdown', 'Source Split', 'percent', 'Derived', 'doc',
 'pr_amount / (pr + ap + gl) x 100',
 '(ctx.doc.pr_amount || 0) + (ctx.doc.ap_amount || 0) + (ctx.doc.gl_amount || 0) > 0 ? ((ctx.doc.pr_amount || 0) / ((ctx.doc.pr_amount || 0) + (ctx.doc.ap_amount || 0) + (ctx.doc.gl_amount || 0))) * 100 : null',
 '{}'),

('source_ap_pct', 'AP %', ARRAY['job_cost_report'], 'job_cost_report',
 'Cost Breakdown', 'Source Split', 'percent', 'Derived', 'doc',
 'ap_amount / (pr + ap + gl) x 100',
 '(ctx.doc.pr_amount || 0) + (ctx.doc.ap_amount || 0) + (ctx.doc.gl_amount || 0) > 0 ? ((ctx.doc.ap_amount || 0) / ((ctx.doc.pr_amount || 0) + (ctx.doc.ap_amount || 0) + (ctx.doc.gl_amount || 0))) * 100 : null',
 '{}'),

('source_gl_pct', 'GL %', ARRAY['job_cost_report'], 'job_cost_report',
 'Cost Breakdown', 'Source Split', 'percent', 'Derived', 'doc',
 'gl_amount / (pr + ap + gl) x 100',
 '(ctx.doc.pr_amount || 0) + (ctx.doc.ap_amount || 0) + (ctx.doc.gl_amount || 0) > 0 ? ((ctx.doc.gl_amount || 0) / ((ctx.doc.pr_amount || 0) + (ctx.doc.ap_amount || 0) + (ctx.doc.gl_amount || 0))) * 100 : null',
 '{}'),

('labor_pct_of_revenue', 'Labor % of Revenue', ARRAY['job_cost_report'], 'job_cost_report',
 'Cost Breakdown', 'Ratios', 'percent', 'Derived', 'doc',
 'labor_cost / contract_value x 100',
 'safe(ctx.doc.labor_cost, ctx.doc.contract_value) * 100',
 '{labor_cost,contract_value}'),

('material_pct_of_revenue', 'Material % of Revenue', ARRAY['job_cost_report'], 'job_cost_report',
 'Cost Breakdown', 'Ratios', 'percent', 'Derived', 'doc',
 'material_cost / contract_value x 100',
 'safe(ctx.doc.material_cost, ctx.doc.contract_value) * 100',
 '{material_cost,contract_value}'),

('labor_material_ratio', 'Labor:Material Ratio', ARRAY['job_cost_report'], 'job_cost_report',
 'Cost Breakdown', 'Ratios', 'ratio', 'Derived', 'doc',
 'labor_cost / material_cost',
 'safe(ctx.doc.labor_cost, ctx.doc.material_cost)',
 '{labor_cost,material_cost}'),


-- ── Crew Labor tab (per labor cost code) ─────────────────────

('crew_ot_pct', 'OT %', ARRAY['job_cost_report'], 'job_cost_report',
 'Crew Labor', 'Labor Codes', 'percent', 'Derived', 'cost_code',
 'overtime_hours / (regular_hours + overtime_hours) x 100',
 '((ctx.current.regular_hours || 0) + (ctx.current.overtime_hours || 0)) > 0 ? ((ctx.current.overtime_hours || 0) / ((ctx.current.regular_hours || 0) + (ctx.current.overtime_hours || 0))) * 100 : 0',
 '{}'),

('crew_blended_rate', 'Blended Rate', ARRAY['job_cost_report'], 'job_cost_report',
 'Crew Labor', 'Labor Codes', 'currency', 'Derived', 'cost_code',
 'jtd_cost / (regular_hours + overtime_hours)',
 '((ctx.current.regular_hours || 0) + (ctx.current.overtime_hours || 0)) > 0 ? (ctx.current.jtd_cost || 0) / ((ctx.current.regular_hours || 0) + (ctx.current.overtime_hours || 0)) : null',
 '{}'),


-- ── Crew Analytics tab (doc-level summaries) ─────────────────

('crew_total_hours', 'Total Labor Hours', ARRAY['job_cost_report'], 'job_cost_report',
 'Crew Analytics', 'Summary', 'number', 'Derived', 'doc',
 'SUM of (regular_hours + overtime_hours) WHERE cost_category = labor',
 'ctx.collections.cost_code.filter(r => (r.cost_category || "").toLowerCase() === "labor").reduce((s, r) => s + (r.regular_hours || 0) + (r.overtime_hours || 0), 0)',
 '{}'),

('crew_total_reg_hours', 'Total Regular Hours', ARRAY['job_cost_report'], 'job_cost_report',
 'Crew Analytics', 'Summary', 'number', 'Derived', 'doc',
 'SUM of regular_hours WHERE cost_category = labor',
 'ctx.collections.cost_code.filter(r => (r.cost_category || "").toLowerCase() === "labor").reduce((s, r) => s + (r.regular_hours || 0), 0)',
 '{}'),

('crew_total_ot_hours', 'Total OT Hours', ARRAY['job_cost_report'], 'job_cost_report',
 'Crew Analytics', 'Summary', 'number', 'Derived', 'doc',
 'SUM of overtime_hours WHERE cost_category = labor',
 'ctx.collections.cost_code.filter(r => (r.cost_category || "").toLowerCase() === "labor").reduce((s, r) => s + (r.overtime_hours || 0), 0)',
 '{}'),

('crew_ot_ratio', 'OT Ratio', ARRAY['job_cost_report'], 'job_cost_report',
 'Crew Analytics', 'Summary', 'percent', 'Derived', 'doc',
 'crew_total_ot_hours / crew_total_hours x 100. Above 15% = scheduling pressure.',
 'ctx.doc.crew_total_hours > 0 ? (ctx.doc.crew_total_ot_hours / ctx.doc.crew_total_hours) * 100 : 0',
 '{crew_total_hours,crew_total_ot_hours}'),

('crew_total_labor_cost', 'Total Labor Cost', ARRAY['job_cost_report'], 'job_cost_report',
 'Crew Analytics', 'Summary', 'currency', 'Derived', 'doc',
 'SUM of jtd_cost WHERE cost_category = labor',
 'ctx.collections.cost_code.filter(r => (r.cost_category || "").toLowerCase() === "labor").reduce((s, r) => s + (r.jtd_cost || 0), 0)',
 '{}'),

('crew_total_labor_budget', 'Total Labor Budget', ARRAY['job_cost_report'], 'job_cost_report',
 'Crew Analytics', 'Summary', 'currency', 'Derived', 'doc',
 'SUM of revised_budget WHERE cost_category = labor',
 'ctx.collections.cost_code.filter(r => (r.cost_category || "").toLowerCase() === "labor").reduce((s, r) => s + (r.revised_budget || 0), 0)',
 '{}'),

('blended_gross_wage', 'Blended Gross Wage', ARRAY['job_cost_report'], 'job_cost_report',
 'Crew Analytics', 'Wage Stats', 'currency', 'Derived', 'doc',
 'crew_total_labor_cost / crew_total_hours',
 'ctx.doc.crew_total_hours > 0 ? ctx.doc.crew_total_labor_cost / ctx.doc.crew_total_hours : null',
 '{crew_total_labor_cost,crew_total_hours}'),

('burden_cost', 'Burden Cost', ARRAY['job_cost_report'], 'job_cost_report',
 'Crew Analytics', 'Burden', 'currency', 'Derived', 'doc',
 'SUM of jtd_cost WHERE cost_category = overhead',
 'ctx.collections.cost_code.filter(r => (r.cost_category || "").toLowerCase() === "overhead").reduce((s, r) => s + (r.jtd_cost || 0), 0)',
 '{}'),

('burden_multiplier', 'Burden Multiplier', ARRAY['job_cost_report'], 'job_cost_report',
 'Crew Analytics', 'Burden', 'ratio', 'Derived', 'doc',
 '(crew_total_labor_cost + burden_cost) / crew_total_labor_cost',
 'ctx.doc.crew_total_labor_cost > 0 ? (ctx.doc.crew_total_labor_cost + ctx.doc.burden_cost) / ctx.doc.crew_total_labor_cost : null',
 '{crew_total_labor_cost,burden_cost}'),

('fully_loaded_wage', 'Fully Loaded Wage', ARRAY['job_cost_report'], 'job_cost_report',
 'Crew Analytics', 'Burden', 'currency', 'Derived', 'doc',
 'blended_gross_wage x burden_multiplier',
 'ctx.doc.blended_gross_wage != null && ctx.doc.burden_multiplier != null ? ctx.doc.blended_gross_wage * ctx.doc.burden_multiplier : null',
 '{blended_gross_wage,burden_multiplier}'),


-- ── Worker-level derived fields ──────────────────────────────

('worker_total_hrs', 'Total Hours', ARRAY['job_cost_report'], 'job_cost_report',
 'Crew Analytics', 'Worker Detail', 'number', 'Derived', 'worker',
 'regular_hours + overtime_hours',
 '(ctx.current.regular_hours || 0) + (ctx.current.overtime_hours || 0)',
 '{}'),

('worker_ot_pct', 'OT %', ARRAY['job_cost_report'], 'job_cost_report',
 'Crew Analytics', 'Worker Detail', 'percent', 'Derived', 'worker',
 'overtime_hours / total_hours x 100. Above 15% = scheduling pressure.',
 '((ctx.current.regular_hours || 0) + (ctx.current.overtime_hours || 0)) > 0 ? ((ctx.current.overtime_hours || 0) / ((ctx.current.regular_hours || 0) + (ctx.current.overtime_hours || 0))) * 100 : 0',
 '{}'),

('worker_rate', '$/HR', ARRAY['job_cost_report'], 'job_cost_report',
 'Crew Analytics', 'Worker Detail', 'currency', 'Derived', 'worker',
 'wages / total_hours',
 '((ctx.current.regular_hours || 0) + (ctx.current.overtime_hours || 0)) > 0 ? (ctx.current.wages || 0) / ((ctx.current.regular_hours || 0) + (ctx.current.overtime_hours || 0)) : null',
 '{}'),


-- ── Reconciliation tab ───────────────────────────────────────

('recon_sum_budget', 'Sum of Revised Budgets', ARRAY['job_cost_report'], 'job_cost_report',
 'Reconciliation', 'Grand Totals', 'currency', 'Derived', 'doc',
 'SUM of revised_budget across work codes (excl 999/Overhead)',
 'ctx.collections.cost_code.filter(r => r.cost_code !== "999" && !(r.cost_code || "").startsWith("Overhead")).reduce((s, r) => s + (r.revised_budget || 0), 0)',
 '{}'),

('recon_sum_jtd', 'Sum of JTD Costs', ARRAY['job_cost_report'], 'job_cost_report',
 'Reconciliation', 'Grand Totals', 'currency', 'Derived', 'doc',
 'SUM of jtd_cost across work codes (excl 999/Overhead)',
 'ctx.collections.cost_code.filter(r => r.cost_code !== "999" && !(r.cost_code || "").startsWith("Overhead")).reduce((s, r) => s + (r.jtd_cost || 0), 0)',
 '{}'),

('recon_check_budget_jtd', 'Budget - JTD = Over/Under?', ARRAY['job_cost_report'], 'job_cost_report',
 'Reconciliation', 'Grand Totals', 'string', 'Cross-Ref', 'doc',
 'ABS(sum_budget - sum_jtd - sum_over_under) < 1 => PASS else FAIL',
 'Math.abs(ctx.doc.recon_sum_budget - ctx.doc.recon_sum_jtd - ctx.doc.total_over_under) < 1 ? "PASS" : "FAIL"',
 '{recon_sum_budget,recon_sum_jtd,total_over_under}'),

('recon_labor_budget', 'Labor Budget Subtotal', ARRAY['job_cost_report'], 'job_cost_report',
 'Reconciliation', 'Labor Codes', 'currency', 'Derived', 'doc',
 'SUM of revised_budget WHERE cost_category = labor',
 'ctx.collections.cost_code.filter(r => (r.cost_category || "").toLowerCase() === "labor").reduce((s, r) => s + (r.revised_budget || 0), 0)',
 '{}'),

('recon_labor_jtd', 'Labor JTD Subtotal', ARRAY['job_cost_report'], 'job_cost_report',
 'Reconciliation', 'Labor Codes', 'currency', 'Derived', 'doc',
 'SUM of jtd_cost WHERE cost_category = labor',
 'ctx.collections.cost_code.filter(r => (r.cost_category || "").toLowerCase() === "labor").reduce((s, r) => s + (r.jtd_cost || 0), 0)',
 '{}'),

('recon_material_budget', 'Material Budget Subtotal', ARRAY['job_cost_report'], 'job_cost_report',
 'Reconciliation', 'Material Codes', 'currency', 'Derived', 'doc',
 'SUM of revised_budget WHERE cost_category = material',
 'ctx.collections.cost_code.filter(r => (r.cost_category || "").toLowerCase() === "material").reduce((s, r) => s + (r.revised_budget || 0), 0)',
 '{}'),

('recon_material_jtd', 'Material JTD Subtotal', ARRAY['job_cost_report'], 'job_cost_report',
 'Reconciliation', 'Material Codes', 'currency', 'Derived', 'doc',
 'SUM of jtd_cost WHERE cost_category = material',
 'ctx.collections.cost_code.filter(r => (r.cost_category || "").toLowerCase() === "material").reduce((s, r) => s + (r.jtd_cost || 0), 0)',
 '{}'),

('recon_source_check', 'Source Total = Direct Cost?', ARRAY['job_cost_report'], 'job_cost_report',
 'Reconciliation', 'Source Tie-out', 'string', 'Cross-Ref', 'doc',
 'ABS((pr + ap + gl) - sum_jtd) < 100 => PASS else FAIL',
 'Math.abs(((ctx.doc.pr_amount || 0) + (ctx.doc.ap_amount || 0) + (ctx.doc.gl_amount || 0)) - ctx.doc.recon_sum_jtd) < 100 ? "PASS" : "FAIL"',
 '{recon_sum_jtd}'),

('recon_cross_tab_check', 'Revenue - Profit = Direct Cost?', ARRAY['job_cost_report'], 'job_cost_report',
 'Reconciliation', 'Cross-Tab', 'string', 'Cross-Ref', 'doc',
 'ABS(sum_jtd - (contract_value - net_profit)) < 1 => PASS else FAIL',
 'Math.abs(ctx.doc.recon_sum_jtd - (ctx.doc.contract_value - ctx.doc.net_profit)) < 1 ? "PASS" : "FAIL"',
 '{recon_sum_jtd,contract_value,net_profit}');
