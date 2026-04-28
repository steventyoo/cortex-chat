-- consistency_checks: DB-driven validation rules for post-extraction reconciliation.
-- Each row defines a check with a JS expression evaluated against an EvalContext.
-- The generic consistency-evaluator.ts loads and runs these for any skill.
-- Follows the same pattern as derived_fields.

CREATE TABLE IF NOT EXISTS consistency_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id TEXT NOT NULL REFERENCES document_skills(skill_id),
  check_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  tier INT NOT NULL DEFAULT 1,
  classification TEXT NOT NULL CHECK (classification IN ('extraction_error', 'document_anomaly')),
  scope TEXT NOT NULL DEFAULT 'doc',
  expression TEXT NOT NULL,
  tolerance_abs NUMERIC DEFAULT 0.01,
  affected_fields TEXT[] DEFAULT '{}',
  hint_template TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(skill_id, check_name)
);

CREATE INDEX IF NOT EXISTS idx_consistency_checks_skill ON consistency_checks(skill_id);

ALTER TABLE consistency_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for consistency_checks" ON consistency_checks
  FOR ALL USING (true) WITH CHECK (true);

-- Add reconciliation_score column to pipeline_log
ALTER TABLE pipeline_log ADD COLUMN IF NOT EXISTS reconciliation_score NUMERIC(5,2);

-- ================================================================
-- Seed: JCR consistency checks (27 checks across 4 tiers)
-- ================================================================

-- ── Tier 1: Extracted value self-consistency (extraction_error) ──

INSERT INTO consistency_checks (skill_id, check_name, display_name, description, tier, classification, scope, expression, tolerance_abs, affected_fields, hint_template) VALUES

('job_cost_report', 'source_sum_equals_expenses',
 'Source Sum = Expenses',
 'PR + AP + GL from Job Totals by Source must sum to total expenses',
 1, 'extraction_error', 'doc',
 '(() => { const pr = ctx.doc.pr_amount || 0; const ap = ctx.doc.ap_amount || 0; const gl = ctx.doc.gl_amount || 0; const exp = ctx.doc.job_totals_expenses || ctx.doc.total_jtd_cost || 0; if (exp === 0) return { pass: true, message: "No expenses to check" }; const sum = pr + ap + gl; const delta = Math.abs(sum - exp); return { pass: delta <= 0.05, expected: exp, actual: sum, delta, message: delta <= 0.05 ? "Source amounts sum to expenses" : "PR+AP+GL=" + sum.toFixed(2) + " vs expenses=" + exp.toFixed(2) }; })()',
 0.05, '{pr_amount,ap_amount,gl_amount,job_totals_expenses}',
 'Re-read the Job Totals by Source section. PR+AP+GL should equal total expenses of ${{expected}}.'),

('job_cost_report', 'revenue_equals_code999',
 'Revenue = |Code 999|',
 'Job totals revenue must equal the absolute value of cost code 999 JTD cost',
 1, 'extraction_error', 'doc',
 '(() => { const rev = ctx.doc.job_totals_revenue || 0; const c999 = ctx.collections.cost_code.find(r => String(r.cost_code) === "999"); if (!c999) return { pass: true, message: "No code 999 found" }; const absJtd = Math.abs(c999.jtd_cost || 0); const delta = Math.abs(rev - absJtd); return { pass: delta <= 0.01, expected: absJtd, actual: rev, delta, message: delta <= 0.01 ? "Revenue matches code 999" : "Revenue=" + rev.toFixed(2) + " vs |code999|=" + absJtd.toFixed(2) }; })()',
 0.01, '{job_totals_revenue}',
 'Revenue should equal the absolute value of code 999 JTD cost ({{expected}}).'),

('job_cost_report', 'contract_value_equals_revenue',
 'Contract Value = Revenue',
 'If both are extracted, contract value and revenue should agree',
 1, 'extraction_error', 'doc',
 '(() => { const cv = ctx.doc.contract_value; const rev = ctx.doc.job_totals_revenue; if (cv == null || rev == null || cv === 0 || rev === 0) return { pass: true, message: "One or both values not extracted" }; const delta = Math.abs(cv - rev); return { pass: delta <= 0.01, expected: cv, actual: rev, delta, message: delta <= 0.01 ? "Contract value matches revenue" : "contract_value=" + cv.toFixed(2) + " vs revenue=" + rev.toFixed(2) }; })()',
 0.01, '{contract_value,job_totals_revenue}',
 NULL),

('job_cost_report', 'net_equals_revenue_minus_expenses',
 'Net = Revenue - Expenses',
 'Job totals net must equal revenue minus expenses',
 1, 'extraction_error', 'doc',
 '(() => { const rev = ctx.doc.job_totals_revenue || 0; const exp = ctx.doc.job_totals_expenses || ctx.doc.total_jtd_cost || 0; const net = ctx.doc.job_totals_net; if (net == null || (rev === 0 && exp === 0)) return { pass: true, message: "Net not extracted or no rev/exp" }; const expected = rev - exp; const delta = Math.abs(net - expected); return { pass: delta <= 0.01, expected, actual: net, delta, message: delta <= 0.01 ? "Net matches revenue - expenses" : "net=" + net.toFixed(2) + " vs (rev-exp)=" + expected.toFixed(2) }; })()',
 0.01, '{job_totals_net,job_totals_revenue,job_totals_expenses}',
 NULL),

('job_cost_report', 'expense_codes_sum',
 'Cost Code Sum = Expenses',
 'Sum of all non-revenue cost code JTD costs must equal total expenses',
 1, 'extraction_error', 'doc',
 '(() => { const exp = ctx.doc.job_totals_expenses || ctx.doc.total_jtd_cost || 0; if (exp === 0) return { pass: true, message: "No expenses" }; const sum = ctx.collections.cost_code.filter(r => String(r.cost_code) !== "999").reduce((s, r) => s + (r.jtd_cost || 0), 0); const delta = Math.abs(sum - exp); return { pass: delta <= 0.50, expected: exp, actual: rd(sum, 2), delta, message: delta <= 0.50 ? "Cost code sum matches expenses" : "sum=" + sum.toFixed(2) + " vs expenses=" + exp.toFixed(2) }; })()',
 0.50, '{job_totals_expenses,total_jtd_cost}',
 NULL),

('job_cost_report', 'budget_codes_sum',
 'Budget Code Sum = Total Budget',
 'Sum of all non-revenue cost code budgets must equal total revised budget',
 1, 'extraction_error', 'doc',
 '(() => { const total = ctx.doc.total_revised_budget || 0; if (total === 0) return { pass: true, message: "No budget total" }; const sum = ctx.collections.cost_code.filter(r => String(r.cost_code) !== "999").reduce((s, r) => s + (r.revised_budget || 0), 0); const delta = Math.abs(sum - total); return { pass: delta <= 0.50, expected: total, actual: rd(sum, 2), delta, message: delta <= 0.50 ? "Budget code sum matches total" : "sum=" + sum.toFixed(2) + " vs total=" + total.toFixed(2) }; })()',
 0.50, '{total_revised_budget}',
 NULL),

('job_cost_report', 'total_overunder_identity',
 'Over/Under = Budget - JTD',
 'Total over/under must equal total revised budget minus total JTD cost',
 1, 'extraction_error', 'doc',
 '(() => { const jtd = ctx.doc.total_jtd_cost || 0; const bud = ctx.doc.total_revised_budget || 0; const ou = ctx.doc.overunder_budget_line; if (ou == null) return { pass: true, message: "Over/under not computed" }; const expected = bud - jtd; const delta = Math.abs(ou - expected); return { pass: delta <= 0.01, expected, actual: ou, delta, message: delta <= 0.01 ? "Over/under identity holds" : "over_under=" + ou.toFixed(2) + " vs (budget-jtd)=" + expected.toFixed(2) }; })()',
 0.01, '{overunder_budget_line,total_jtd_cost,total_revised_budget}',
 NULL),

('job_cost_report', 'overunder_identity',
 'Per-Code Over/Under = Budget - JTD',
 'Each cost code over_under_budget must equal revised_budget - jtd_cost',
 1, 'extraction_error', 'cost_code',
 '(() => { const bud = ctx.current.revised_budget || ctx.current.original_budget || 0; const jtd = ctx.current.jtd_cost || 0; const ou = ctx.current.over_under_budget; if (ou == null) return { pass: true, message: "No over/under value" }; const expected = bud - jtd; const delta = Math.abs(ou - expected); return { pass: delta <= 0.01, expected, actual: ou, delta, message: delta <= 0.01 ? "OK" : "code " + ctx.current.cost_code + ": ou=" + ou.toFixed(2) + " vs (bud-jtd)=" + expected.toFixed(2) }; })()',
 0.01, '{over_under_budget}',
 NULL),

('job_cost_report', 'code999_all_signs_negative',
 'Code 999 Revenue Values Negative',
 'Revenue code 999 should have negative values for revised_budget and jtd_cost (original_budget is normalized to positive)',
 1, 'extraction_error', 'doc',
 '(() => { const c999 = ctx.collections.cost_code.find(r => String(r.cost_code) === "999"); if (!c999) return { pass: true, message: "No code 999" }; const fields = ["revised_budget", "jtd_cost"]; const violations = fields.filter(f => (c999[f] || 0) > 0); return { pass: violations.length === 0, expected: "all <= 0", actual: violations.join(","), delta: null, message: violations.length === 0 ? "All code 999 values non-positive" : "Positive values in code 999: " + violations.join(", ") }; })()',
 0, '{revised_budget,jtd_cost}',
 'Code 999 (revenue) should have negative revised_budget and jtd_cost in Sage JCRs. original_budget is normalized to positive.'),

('job_cost_report', 'no_negative_hours',
 'No Negative Hours (Cost Code)',
 'Cost code hours can never be negative',
 1, 'extraction_error', 'cost_code',
 '(() => { const reg = ctx.current.regular_hours || 0; const ot = ctx.current.overtime_hours || 0; const pass = reg >= 0 && ot >= 0; return { pass, expected: ">= 0", actual: "reg=" + reg + " ot=" + ot, delta: null, message: pass ? "OK" : "Negative hours on code " + ctx.current.cost_code }; })()',
 0, '{regular_hours,overtime_hours}',
 NULL),

('job_cost_report', 'no_negative_hours_worker',
 'No Negative Hours (Worker)',
 'Worker hours can never be negative',
 1, 'extraction_error', 'worker',
 '(() => { const reg = ctx.current.regular_hours || 0; const ot = ctx.current.overtime_hours || 0; const pass = reg >= 0 && ot >= 0; return { pass, expected: ">= 0", actual: "reg=" + reg + " ot=" + ot, delta: null, message: pass ? "OK" : "Negative hours on worker " + ctx.current.name }; })()',
 0, '{regular_hours,overtime_hours}',
 NULL),

('job_cost_report', 'pr_txn_amounts_positive',
 'PR Transaction Amounts Positive',
 'Base wages from payroll transactions should be non-negative',
 1, 'extraction_error', 'payroll_transactions',
 '(() => { const amt = ctx.current.actual_amount || 0; const pass = amt >= 0; return { pass, expected: ">= 0", actual: amt, delta: null, message: pass ? "OK" : "Negative PR txn amount: $" + amt.toFixed(2) + " for " + (ctx.current.name || "unknown") }; })()',
 0, '{actual_amount}',
 NULL),

-- ── Tier 2: Extracted vs Computed cross-checks (extraction_error) ──

('job_cost_report', 'pr_extracted_vs_computed',
 'PR: Extracted vs Computed',
 'Extracted PR amount from Job Totals by Source vs computed PR from transactions + burden',
 2, 'extraction_error', 'doc',
 '(() => { const extracted = ctx.doc.extracted_pr_amount; const computed = ctx.doc.pr_amount || 0; if (extracted == null) return { pass: true, message: "No extracted PR amount" }; const delta = Math.abs(extracted - computed); return { pass: delta <= 0.50, expected: extracted, actual: computed, delta, message: delta <= 0.50 ? "PR amounts agree" : "extracted_pr=$" + extracted.toFixed(2) + " vs computed_pr=$" + computed.toFixed(2) }; })()',
 0.50, '{pr_amount,extracted_pr_amount}',
 'Re-read the PR amount from Job Totals by Source section. Expected ~${{expected}}.'),

('job_cost_report', 'gl_extracted_vs_computed',
 'GL: Extracted vs Computed',
 'Extracted GL amount from Job Totals by Source vs computed GL from overhead codes',
 2, 'extraction_error', 'doc',
 '(() => { const extracted = ctx.doc.extracted_gl_amount; const computed = ctx.doc.gl_amount || 0; if (extracted == null) return { pass: true, message: "No extracted GL amount" }; const delta = Math.abs(extracted - computed); return { pass: delta <= 0.50, expected: extracted, actual: computed, delta, message: delta <= 0.50 ? "GL amounts agree" : "extracted_gl=$" + extracted.toFixed(2) + " vs computed_gl=$" + computed.toFixed(2) }; })()',
 0.50, '{gl_amount,extracted_gl_amount}',
 NULL),

('job_cost_report', 'ap_extracted_vs_computed',
 'AP: Extracted vs Computed',
 'Extracted AP amount from Job Totals by Source vs computed AP (residual)',
 2, 'extraction_error', 'doc',
 '(() => { const extracted = ctx.doc.extracted_ap_amount; const computed = ctx.doc.ap_amount || 0; if (extracted == null) return { pass: true, message: "No extracted AP amount" }; const delta = Math.abs(extracted - computed); return { pass: delta <= 0.50, expected: extracted, actual: computed, delta, message: delta <= 0.50 ? "AP amounts agree" : "extracted_ap=$" + extracted.toFixed(2) + " vs computed_ap=$" + computed.toFixed(2) }; })()',
 0.50, '{ap_amount,extracted_ap_amount}',
 NULL),

('job_cost_report', 'pr_hours_exact_match',
 'PR Hours = Cost Code Hours',
 'Sum of worker regular+OT hours must match sum of labor cost code hours',
 2, 'extraction_error', 'doc',
 '(() => { const workers = ctx.collections.worker || []; if (workers.length === 0) return { pass: true, message: "No workers" }; const wHours = workers.reduce((s, w) => s + (w.regular_hours || 0) + (w.overtime_hours || 0), 0); const laborCodes = ctx.collections.cost_code.filter(r => { const c = parseInt(String(r.cost_code || 0)); return (c >= 100 && c <= 199) || c === 11; }); const ccHours = laborCodes.reduce((s, r) => s + (r.regular_hours || 0) + (r.overtime_hours || 0), 0); if (ccHours === 0) return { pass: true, message: "No cost code hours" }; const delta = Math.abs(wHours - ccHours); return { pass: delta <= 0.5, expected: ccHours, actual: rd(wHours, 1), delta, message: delta <= 0.5 ? "Worker hours match cost code hours" : "worker_hours=" + wHours.toFixed(1) + " vs cc_hours=" + ccHours.toFixed(1) }; })()',
 0.5, '{regular_hours,overtime_hours}',
 NULL),

('job_cost_report', 'worker_dedup',
 'No Duplicate PR Transactions',
 'No (worker_name, date, amount) duplicates in payroll transactions',
 2, 'extraction_error', 'doc',
 '(() => { const txns = ctx.collections.payroll_transactions || []; if (txns.length === 0) return { pass: true, message: "No transactions" }; const seen = new Set(); let dupes = 0; for (const t of txns) { const key = (t.name || "") + "|" + (t.document_date || "") + "|" + (t.actual_amount || 0); if (seen.has(key)) dupes++; seen.add(key); } return { pass: dupes === 0, expected: 0, actual: dupes, delta: dupes, message: dupes === 0 ? "No duplicates" : dupes + " duplicate PR transactions detected" }; })()',
 0, '{}',
 NULL),

('job_cost_report', 'worker_amount_components',
 'Worker Amount Components Sum',
 'Per worker: regular_amount + overtime_amount should approximate actual_amount',
 2, 'extraction_error', 'worker',
 '(() => { const reg = ctx.current.regular_amount || 0; const ot = ctx.current.overtime_amount || 0; const dt = ctx.current.doubletime_amount || 0; const total = ctx.current.actual_amount || 0; if (total === 0) return { pass: true, message: "No total amount" }; const sum = reg + ot + dt; const delta = Math.abs(sum - total); return { pass: delta <= 0.01, expected: total, actual: rd(sum, 2), delta, message: delta <= 0.01 ? "Components sum to total" : ctx.current.name + ": components=" + sum.toFixed(2) + " vs total=" + total.toFixed(2) }; })()',
 0.01, '{regular_amount,overtime_amount,actual_amount}',
 NULL),

-- ── Tier 3a: Structural constraints (extraction_error) ──

('job_cost_report', 'burden_codes_no_hours',
 'Burden Codes Have No Hours',
 'Overhead codes 995 and 998 should have zero hours',
 3, 'extraction_error', 'cost_code',
 '(() => { const code = parseInt(String(ctx.current.cost_code || 0)); if (code !== 995 && code !== 998) return { pass: true, message: "Not a burden code" }; const reg = ctx.current.regular_hours || 0; const ot = ctx.current.overtime_hours || 0; const pass = reg === 0 && ot === 0; return { pass, expected: "0 hours", actual: "reg=" + reg + " ot=" + ot, delta: null, message: pass ? "OK" : "Burden code " + code + " has hours" }; })()',
 0, '{regular_hours,overtime_hours}',
 NULL),

('job_cost_report', 'revenue_code_no_hours',
 'Revenue Code Has No Hours',
 'Code 999 should have zero hours',
 3, 'extraction_error', 'cost_code',
 '(() => { if (String(ctx.current.cost_code) !== "999") return { pass: true, message: "Not code 999" }; const reg = ctx.current.regular_hours || 0; const ot = ctx.current.overtime_hours || 0; const pass = reg === 0 && ot === 0; return { pass, expected: "0 hours", actual: "reg=" + reg + " ot=" + ot, delta: null, message: pass ? "OK" : "Revenue code 999 has hours" }; })()',
 0, '{regular_hours,overtime_hours}',
 NULL),

('job_cost_report', 'material_codes_no_hours',
 'Material Codes Have No Hours',
 'Material codes (200-299, 039) should have zero hours',
 3, 'extraction_error', 'cost_code',
 '(() => { const code = parseInt(String(ctx.current.cost_code || 0)); const isMaterial = (code >= 200 && code <= 299) || code === 39; if (!isMaterial) return { pass: true, message: "Not a material code" }; const reg = ctx.current.regular_hours || 0; const ot = ctx.current.overtime_hours || 0; const pass = reg === 0 && ot === 0; return { pass, expected: "0 hours", actual: "reg=" + reg + " ot=" + ot, delta: null, message: pass ? "OK" : "Material code " + code + " has hours" }; })()',
 0, '{regular_hours,overtime_hours}',
 NULL),

('job_cost_report', 'labor_codes_have_hours',
 'Labor Codes Have Hours',
 'Labor codes (011, 100-199) should typically have hours',
 3, 'extraction_error', 'cost_code',
 '(() => { const code = parseInt(String(ctx.current.cost_code || 0)); const isLabor = (code >= 100 && code <= 199) || code === 11; if (!isLabor) return { pass: true, message: "Not a labor code" }; const reg = ctx.current.regular_hours || 0; const ot = ctx.current.overtime_hours || 0; const pass = reg > 0 || ot > 0; return { pass, expected: "> 0 hours", actual: "reg=" + reg + " ot=" + ot, delta: null, message: pass ? "OK" : "Labor code " + code + " has zero hours" }; })()',
 0, '{regular_hours,overtime_hours}',
 NULL),

('job_cost_report', 'expense_budgets_non_negative',
 'Expense Budgets Non-Negative',
 'Expense cost codes should have non-negative budgets',
 3, 'extraction_error', 'cost_code',
 '(() => { if (String(ctx.current.cost_code) === "999") return { pass: true, message: "Revenue code" }; const ob = ctx.current.original_budget || 0; const rb = ctx.current.revised_budget || 0; const pass = ob >= 0 && rb >= 0; return { pass, expected: ">= 0", actual: "orig=" + ob + " rev=" + rb, delta: null, message: pass ? "OK" : "Negative budget on code " + ctx.current.cost_code }; })()',
 0, '{original_budget,revised_budget}',
 NULL),

('job_cost_report', 'worker_count_vs_labor_codes',
 'Worker Count >= Labor Code Count',
 'Should have at least as many workers as labor codes with hours',
 3, 'extraction_error', 'doc',
 '(() => { const workers = ctx.collections.worker || []; const laborCodesWithHours = ctx.collections.cost_code.filter(r => { const c = parseInt(String(r.cost_code || 0)); const isLabor = (c >= 100 && c <= 199) || c === 11; return isLabor && ((r.regular_hours || 0) + (r.overtime_hours || 0)) > 0; }); if (laborCodesWithHours.length === 0) return { pass: true, message: "No labor codes with hours" }; const pass = workers.length >= laborCodesWithHours.length; return { pass, expected: ">= " + laborCodesWithHours.length, actual: workers.length, delta: null, message: pass ? "Worker count OK" : workers.length + " workers but " + laborCodesWithHours.length + " labor codes with hours" }; })()',
 0, '{}',
 NULL),

-- ── Tier 3b: Reasonableness bounds (document_anomaly) ──

('job_cost_report', 'nominal_rate_bounds',
 'Nominal Rate in Range',
 'Worker nominal rate should be between $5 and $200/hr',
 3, 'document_anomaly', 'worker',
 '(() => { const rate = ctx.current.worker_nominal_rate || 0; if (rate === 0) return { pass: true, message: "No rate computed" }; const pass = rate >= 5 && rate <= 200; return { pass, expected: "$5-$200", actual: "$" + rate.toFixed(2), delta: null, message: pass ? "Rate in range" : ctx.current.name + " has nominal rate $" + rate.toFixed(2) + "/hr (outside $5-$200 range)" }; })()',
 0, '{worker_nominal_rate}',
 NULL),

('job_cost_report', 'worker_hours_bounds',
 'Worker Hours in Range',
 'Worker total hours should be between 8 and 6000',
 3, 'document_anomaly', 'worker',
 '(() => { const total = (ctx.current.regular_hours || 0) + (ctx.current.overtime_hours || 0); if (total === 0) return { pass: true, message: "No hours" }; const pass = total >= 8 && total <= 6000; return { pass, expected: "8-6000 hrs", actual: total.toFixed(1), delta: null, message: pass ? "Hours in range" : ctx.current.name + " has " + total.toFixed(1) + " total hours (outside 8-6000 range)" }; })()',
 0, '{regular_hours,overtime_hours}',
 NULL),

('job_cost_report', 'ot_ratio_bounds',
 'OT Ratio Reasonable',
 'Overtime hours should not wildly exceed regular hours',
 3, 'document_anomaly', 'worker',
 '(() => { const reg = ctx.current.regular_hours || 0; const ot = ctx.current.overtime_hours || 0; if (reg === 0 && ot === 0) return { pass: true, message: "No hours" }; if (reg === 0 && ot > 0) return { pass: false, expected: "OT <= reg*0.5", actual: "reg=0, ot=" + ot, delta: null, message: ctx.current.name + " has OT but no regular hours" }; const pass = ot <= reg * 0.5; return { pass, expected: "OT <= " + (reg * 0.5).toFixed(1), actual: "ot=" + ot.toFixed(1), delta: null, message: pass ? "OT ratio OK" : ctx.current.name + " has high OT ratio: " + ot.toFixed(1) + "h OT vs " + reg.toFixed(1) + "h regular" }; })()',
 0, '{regular_hours,overtime_hours}',
 NULL);
