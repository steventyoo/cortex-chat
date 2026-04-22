-- Align derived field expressions to JCR Schema v4 source of truth.
-- Key changes:
--   1. Replace cost_category filters with explicit cost code ranges
--   2. Fix burden_total, burden_multiplier, fully_loaded_wage formulas
--   3. Fix net_profit and gross_margin to use job_totals_revenue
--   4. Fix total_labor_hours to use worker-level sums (matches PR line items)
--   5. Fix material_cost/material_budget to use 2xx + 039 range
--   6. Fix labor_to_material_ratio denominator

-- Helper: isMaterial = code 200-299 or 039
-- Helper: isBurden  = code 995 or 998
-- Helper: isLabor   = has regular_hours or overtime_hours (PR-sourced codes)

UPDATE derived_fields SET
  formula = 'SUM(jtd_cost) WHERE cost_code 200-299 or 039',
  expression = 'safe(() => { const codes = ctx.collections.cost_code || []; return rd(codes.filter(c => { const n = parseInt(c.cost_code, 10); return (n >= 200 && n < 300) || n === 39; }).reduce((s, c) => s + (c.jtd_cost || 0), 0), 2); })',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'material_cost';

UPDATE derived_fields SET
  formula = 'SUM(revised_budget) WHERE cost_code 200-299 or 039',
  expression = 'safe(() => { const codes = ctx.collections.cost_code || []; return rd(codes.filter(c => { const n = parseInt(c.cost_code, 10); return (n >= 200 && n < 300) || n === 39; }).reduce((s, c) => s + (c.revised_budget || 0), 0), 2); })',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'material_total_budget';

UPDATE derived_fields SET
  formula = 'SUM(jtd_cost) WHERE cost_code 200-299 or 039',
  expression = 'safe(() => { const codes = ctx.collections.cost_code || []; return rd(codes.filter(c => { const n = parseInt(c.cost_code, 10); return (n >= 200 && n < 300) || n === 39; }).reduce((s, c) => s + (c.jtd_cost || 0), 0), 2); })',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'material_total_actual';

-- total_labor_hours: schema says SUM from PR line_items, worker aggregation is the correct source
UPDATE derived_fields SET
  formula = 'SUM(regular_hours + overtime_hours) from worker records (PR transactions)',
  expression = 'safe(() => { const w = ctx.collections.worker || []; return rd(w.reduce((s, r) => s + (r.regular_hours || 0) + (r.overtime_hours || 0), 0), 2); })',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'total_labor_hours';

-- crew_total_hours: same fix
UPDATE derived_fields SET
  formula = 'SUM(regular_hours + overtime_hours) from worker records',
  expression = 'safe(() => { const w = ctx.collections.worker || []; return rd(w.reduce((s, r) => s + (r.regular_hours || 0) + (r.overtime_hours || 0), 0), 2); })',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'crew_total_hours';

UPDATE derived_fields SET
  formula = 'SUM(regular_hours) from worker records',
  expression = 'safe(() => { const w = ctx.collections.worker || []; return rd(w.reduce((s, r) => s + (r.regular_hours || 0), 0), 2); })',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'crew_total_reg_hours';

UPDATE derived_fields SET
  formula = 'SUM(overtime_hours) from worker records',
  expression = 'safe(() => { const w = ctx.collections.worker || []; return rd(w.reduce((s, r) => s + (r.overtime_hours || 0), 0), 2); })',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'crew_total_ot_hours';

-- burden_total: schema says SUM(actual WHERE cost_code IN 995, 998)
-- Already correct in gap-close migration, but fix burden_cost too
UPDATE derived_fields SET
  formula = 'SUM(jtd_cost) WHERE cost_code IN (995, 998)',
  expression = 'safe(() => { const codes = ctx.collections.cost_code || []; return rd(codes.filter(c => c.cost_code === "995" || c.cost_code === "998").reduce((s, c) => s + (c.jtd_cost || 0), 0), 2); })',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'burden_cost';

-- fully_loaded_wage: schema = (pr_amount + burden_total) / total_labor_hours
UPDATE derived_fields SET
  formula = '(pr_amount + burden_total) / total_labor_hours',
  expression = 'safe(() => { const pr = ctx.doc.pr_amount || 0; const burden = ctx.doc.burden_total || 0; const hrs = ctx.doc.total_labor_hours || 0; return hrs > 0 ? rd((pr + burden) / hrs, 2) : null; })',
  depends_on = '{pr_amount,burden_total,total_labor_hours}',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'fully_loaded_wage';

-- burden_multiplier: schema = fully_loaded_wage / pr_src_cost_per_hr
UPDATE derived_fields SET
  formula = 'fully_loaded_wage / pr_src_cost_per_hr',
  expression = 'safe(() => { const flw = ctx.doc.fully_loaded_wage; const psr = ctx.doc.pr_src_cost_per_hr; return (flw != null && psr != null && psr > 0) ? rd(flw / psr, 2) : null; })',
  depends_on = '{fully_loaded_wage,pr_src_cost_per_hr}',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'burden_multiplier';

-- net_profit: schema = job_totals_revenue - direct_cost
UPDATE derived_fields SET
  formula = 'job_totals_revenue - direct_cost (= job_totals_net)',
  expression = 'safe(() => { const rev = ctx.doc.job_totals_revenue; const cost = ctx.doc.direct_cost_total || ctx.doc.total_jtd_cost; return (rev != null && cost != null) ? rd(Math.abs(rev) - cost, 2) : null; })',
  depends_on = '{job_totals_revenue,direct_cost_total,total_jtd_cost}',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'net_profit';

-- gross_margin_pct: schema = job_totals_net / job_totals_revenue * 100
UPDATE derived_fields SET
  formula = 'net_profit / abs(job_totals_revenue) * 100',
  expression = 'safe(() => { const rev = ctx.doc.job_totals_revenue; const profit = ctx.doc.net_profit; return (rev != null && profit != null && Math.abs(rev) > 0) ? rd(profit / Math.abs(rev) * 100, 1) : null; })',
  depends_on = '{net_profit,job_totals_revenue}',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'gross_margin_pct';

-- labor_cost: schema uses PR-source cost codes (codes with hours), not cost_category
-- Use pr_amount directly since that IS the total PR-source cost
UPDATE derived_fields SET
  formula = 'Same as cost_by_source_pr_amount (total PR-source cost)',
  expression = 'safe(() => rd(ctx.doc.pr_amount || 0, 2))',
  depends_on = '{pr_amount}',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'labor_cost';

-- crew_total_labor_cost: same — use pr_amount
UPDATE derived_fields SET
  formula = 'Same as pr_amount (total PR-source cost)',
  expression = 'safe(() => rd(ctx.doc.pr_amount || 0, 2))',
  depends_on = '{pr_amount}',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'crew_total_labor_cost';

-- labor_unit_cost_per_hr: schema says total labor cost / total_labor_hours
-- "labor codes" means codes with hours — sum their jtd_cost
UPDATE derived_fields SET
  formula = 'SUM(jtd_cost WHERE code has hours) / total_labor_hours',
  expression = 'safe(() => { const codes = ctx.collections.cost_code || []; const laborCodes = codes.filter(c => (c.regular_hours || 0) > 0 || (c.overtime_hours || 0) > 0); const cost = laborCodes.reduce((s, c) => s + (c.jtd_cost || 0), 0); const hrs = ctx.doc.total_labor_hours || 0; return hrs > 0 ? rd(cost / hrs, 2) : null; })',
  depends_on = '{total_labor_hours}',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'labor_unit_cost_per_hr';

-- labor_material_ratio: schema = pr_amount / material_spend_total
UPDATE derived_fields SET
  formula = 'pr_amount / material_cost',
  expression = 'safe(() => { const pr = ctx.doc.pr_amount || 0; const mat = ctx.doc.material_cost || 0; return mat > 0 ? rd(pr / mat, 2) : null; })',
  depends_on = '{pr_amount,material_cost}',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'labor_material_ratio';

-- recon fields: fix labor/material to use code ranges instead of cost_category
UPDATE derived_fields SET
  expression = 'safe(() => { const codes = ctx.collections.cost_code || []; return rd(codes.filter(c => (c.regular_hours || 0) > 0 || (c.overtime_hours || 0) > 0).reduce((s, c) => s + (c.revised_budget || 0), 0), 2); })',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'recon_labor_budget';

UPDATE derived_fields SET
  expression = 'safe(() => { const codes = ctx.collections.cost_code || []; return rd(codes.filter(c => (c.regular_hours || 0) > 0 || (c.overtime_hours || 0) > 0).reduce((s, c) => s + (c.jtd_cost || 0), 0), 2); })',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'recon_labor_jtd';

UPDATE derived_fields SET
  expression = 'safe(() => { const codes = ctx.collections.cost_code || []; return rd(codes.filter(c => { const n = parseInt(c.cost_code, 10); return (n >= 200 && n < 300) || n === 39; }).reduce((s, c) => s + (c.revised_budget || 0), 0), 2); })',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'recon_material_budget';

UPDATE derived_fields SET
  expression = 'safe(() => { const codes = ctx.collections.cost_code || []; return rd(codes.filter(c => { const n = parseInt(c.cost_code, 10); return (n >= 200 && n < 300) || n === 39; }).reduce((s, c) => s + (c.jtd_cost || 0), 0), 2); })',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'recon_material_jtd';

-- recon_cross_tab_check: fix to use job_totals_revenue instead of contract_value
UPDATE derived_fields SET
  expression = 'safe(() => { const rev = Math.abs(ctx.doc.job_totals_revenue || 0); const profit = ctx.doc.net_profit || 0; const jtd = ctx.doc.recon_sum_jtd || 0; return Math.abs(jtd - (rev - profit)) < 1 ? "PASS" : "FAIL"; })',
  depends_on = '{recon_sum_jtd,job_totals_revenue,net_profit}',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'recon_cross_tab_check';

-- bva_status: sign convention now actual - budget, so negative = under budget
UPDATE derived_fields SET
  expression = '(ctx.current.over_under_budget || 0) <= 0 ? "Under Budget" : "Over Budget"',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'bva_status';

-- blended_gross_wage: should use pr_amount / total_labor_hours (= pr_src_cost_per_hr)
UPDATE derived_fields SET
  formula = 'pr_amount / total_labor_hours (same as pr_src_cost_per_hr)',
  expression = 'safe(() => { const hrs = ctx.doc.total_labor_hours || 0; return hrs > 0 ? rd((ctx.doc.pr_amount || 0) / hrs, 2) : null; })',
  depends_on = '{pr_amount,total_labor_hours}',
  updated_at = now()
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'blended_gross_wage';
