-- Data eval pipeline gap-close: add derived fields needed by the eval labels.
-- These fields were identified by comparing the JCR Test Labels spreadsheet
-- against the existing derived_fields seed. Uses ON CONFLICT to be idempotent.

INSERT INTO derived_fields (canonical_name, display_name, source_skill_ids, primary_skill_id, tab, section, data_type, status, scope, formula, expression, depends_on) VALUES

-- Cost-by-source percentages
('pr_pct_of_revenue', 'PR % of Revenue', ARRAY['job_cost_report'], 'job_cost_report',
 'Cost Breakdown', 'Cost by Source', 'percent', 'Derived', 'doc',
 'PR amount / abs(revenue)',
 'safe(() => rd(ctx.doc.pr_amount / Math.abs(ctx.doc.job_totals_revenue) * 100, 1))',
 '{pr_amount,job_totals_revenue}'),

('ap_pct_of_revenue', 'AP % of Revenue', ARRAY['job_cost_report'], 'job_cost_report',
 'Cost Breakdown', 'Cost by Source', 'percent', 'Derived', 'doc',
 'AP amount / abs(revenue)',
 'safe(() => rd(ctx.doc.ap_amount / Math.abs(ctx.doc.job_totals_revenue) * 100, 1))',
 '{ap_amount,job_totals_revenue}'),

('direct_cost_pct_of_revenue', 'Direct Cost % of Revenue', ARRAY['job_cost_report'], 'job_cost_report',
 'Cost Breakdown', 'Cost by Source', 'percent', 'Derived', 'doc',
 'direct_cost / abs(revenue)',
 'safe(() => rd(ctx.doc.direct_cost_total / Math.abs(ctx.doc.job_totals_revenue) * 100, 1))',
 '{direct_cost_total,job_totals_revenue}'),

-- Labor analytics
('total_workers', 'Total Workers', ARRAY['job_cost_report'], 'job_cost_report',
 'Crew Analytics', 'Workforce', 'integer', 'Derived', 'doc',
 'COUNT DISTINCT workers from payroll',
 'safe(() => (ctx.collections.worker || []).length)',
 '{}'),

('burden_total', 'Burden Total', ARRAY['job_cost_report'], 'job_cost_report',
 'Crew Analytics', 'Labor Analytics', 'currency', 'Derived', 'doc',
 'SUM(actual WHERE cost_code IN 995, 998)',
 'safe(() => { const codes = ctx.collections.cost_code || []; const burden = codes.filter(c => c.cost_code === "995" || c.cost_code === "998"); return rd(burden.reduce((s,c) => s + (c.jtd_cost || 0), 0), 2); })',
 '{}'),

('straight_time_rate', 'Straight Time Rate', ARRAY['job_cost_report'], 'job_cost_report',
 'Crew Analytics', 'Labor Analytics', 'currency', 'Derived', 'doc',
 'SUM(regular_amount) / SUM(regular_hours) from workers',
 'safe(() => { const w = ctx.collections.worker || []; const regAmt = w.reduce((s,r) => s + (r.regular_amount || 0), 0); const regHrs = w.reduce((s,r) => s + (r.regular_hours || 0), 0); return regHrs > 0 ? rd(regAmt / regHrs, 2) : null; })',
 '{}'),

('pr_src_cost_per_hr', 'PR Cost Per Hour', ARRAY['job_cost_report'], 'job_cost_report',
 'Crew Analytics', 'Labor Analytics', 'currency', 'Derived', 'doc',
 'PR amount / total_labor_hours',
 'safe(() => ctx.doc.total_labor_hours > 0 ? rd(ctx.doc.pr_amount / ctx.doc.total_labor_hours, 2) : null)',
 '{pr_amount,total_labor_hours}'),

-- Material analytics
('material_codes_tracked', 'Material Codes Tracked', ARRAY['job_cost_report'], 'job_cost_report',
 'Material', 'Material Analytics', 'integer', 'Derived', 'doc',
 'COUNT material cost codes (2xx or 039)',
 'safe(() => { const codes = ctx.collections.cost_code || []; return codes.filter(c => { const n = parseInt(c.cost_code, 10); return (n >= 200 && n < 300) || n === 39; }).length; })',
 '{}'),

('material_codes_over_budget', 'Material Codes Over Budget', ARRAY['job_cost_report'], 'job_cost_report',
 'Material', 'Material Analytics', 'integer', 'Derived', 'doc',
 'COUNT material codes WHERE over_under_budget > 0',
 'safe(() => { const codes = ctx.collections.cost_code || []; return codes.filter(c => { const n = parseInt(c.cost_code, 10); return ((n >= 200 && n < 300) || n === 39) && (c.over_under_budget || 0) > 0; }).length; })',
 '{}'),

('material_codes_under_budget', 'Material Codes Under Budget', ARRAY['job_cost_report'], 'job_cost_report',
 'Material', 'Material Analytics', 'integer', 'Derived', 'doc',
 'COUNT material codes WHERE over_under_budget <= 0',
 'safe(() => { const codes = ctx.collections.cost_code || []; return codes.filter(c => { const n = parseInt(c.cost_code, 10); return ((n >= 200 && n < 300) || n === 39) && (c.over_under_budget || 0) <= 0; }).length; })',
 '{}'),

('material_price_variance', 'Material Price Variance', ARRAY['job_cost_report'], 'job_cost_report',
 'Material', 'Material Analytics', 'currency', 'Derived', 'doc',
 'material_budget - material_spend (positive = under budget)',
 'safe(() => rd((ctx.doc.material_total_budget || 0) - (ctx.doc.material_cost || 0), 2))',
 '{material_total_budget,material_cost}'),

-- Phase analytics
('phases_over_budget', 'Phases Over Budget', ARRAY['job_cost_report'], 'job_cost_report',
 'Budget vs Actual', 'Phase Analytics', 'integer', 'Derived', 'doc',
 'COUNT phases WHERE over_under_budget > 0 AND code != 999',
 'safe(() => { const codes = ctx.collections.cost_code || []; return codes.filter(c => c.cost_code !== "999" && (c.over_under_budget || 0) > 0).length; })',
 '{}'),

('phases_under_budget', 'Phases Under Budget', ARRAY['job_cost_report'], 'job_cost_report',
 'Budget vs Actual', 'Phase Analytics', 'integer', 'Derived', 'doc',
 'COUNT phases WHERE over_under_budget <= 0 AND code != 999',
 'safe(() => { const codes = ctx.collections.cost_code || []; return codes.filter(c => c.cost_code !== "999" && (c.over_under_budget || 0) <= 0).length; })',
 '{}'),

('largest_overrun', 'Largest Overrun', ARRAY['job_cost_report'], 'job_cost_report',
 'Budget vs Actual', 'Phase Analytics', 'currency', 'Derived', 'doc',
 'MAX(over_under_budget) across phases (excl 999)',
 'safe(() => { const codes = ctx.collections.cost_code || []; const expense = codes.filter(c => c.cost_code !== "999"); if (expense.length === 0) return null; return rd(Math.max(...expense.map(c => c.over_under_budget || 0)), 2); })',
 '{}'),

('largest_savings', 'Largest Savings', ARRAY['job_cost_report'], 'job_cost_report',
 'Budget vs Actual', 'Phase Analytics', 'currency', 'Derived', 'doc',
 'MIN(over_under_budget) across phases (excl 999)',
 'safe(() => { const codes = ctx.collections.cost_code || []; const expense = codes.filter(c => c.cost_code !== "999"); if (expense.length === 0) return null; return rd(Math.min(...expense.map(c => c.over_under_budget || 0)), 2); })',
 '{}'),

-- Budget & forecast
('total_jtd_cost', 'Total JTD Cost', ARRAY['job_cost_report'], 'job_cost_report',
 'Overview', 'Budget & Forecast', 'currency', 'Derived', 'doc',
 'SUM(jtd_cost) for all expense codes (excl 999)',
 'safe(() => { const codes = ctx.collections.cost_code || []; return rd(codes.filter(c => c.cost_code !== "999").reduce((s,c) => s + (c.jtd_cost || 0), 0), 2); })',
 '{}'),

('total_revised_budget', 'Total Budget', ARRAY['job_cost_report'], 'job_cost_report',
 'Overview', 'Budget & Forecast', 'currency', 'Derived', 'doc',
 'SUM(revised_budget) for all expense codes (excl 999)',
 'safe(() => { const codes = ctx.collections.cost_code || []; return rd(codes.filter(c => c.cost_code !== "999").reduce((s,c) => s + (c.revised_budget || 0), 0), 2); })',
 '{}'),

('overall_pct_budget_consumed', 'Overall % Budget Consumed', ARRAY['job_cost_report'], 'job_cost_report',
 'Overview', 'Budget & Forecast', 'percent', 'Derived', 'doc',
 'total_jtd / total_budget * 100',
 'safe(() => ctx.doc.total_revised_budget > 0 ? rd(ctx.doc.total_jtd_cost / ctx.doc.total_revised_budget * 100, 1) : null)',
 '{total_jtd_cost,total_revised_budget}'),

('overunder_budget_line', 'Total Over/Under Budget', ARRAY['job_cost_report'], 'job_cost_report',
 'Overview', 'Budget & Forecast', 'currency', 'Derived', 'doc',
 'total_budget - total_jtd (positive = under budget)',
 'safe(() => rd((ctx.doc.total_revised_budget || 0) - (ctx.doc.total_jtd_cost || 0), 2))',
 '{total_revised_budget,total_jtd_cost}'),

('labor_unit_cost_per_hr', 'Labor Unit Cost Per Hour', ARRAY['job_cost_report'], 'job_cost_report',
 'Crew Analytics', 'Labor Analytics', 'currency', 'Derived', 'doc',
 'labor_cost / total_labor_hours',
 'safe(() => ctx.doc.total_labor_hours > 0 ? rd(ctx.doc.labor_cost / ctx.doc.total_labor_hours, 2) : null)',
 '{labor_cost,total_labor_hours}'),

('revenue_per_labor_hour', 'Revenue Per Labor Hour', ARRAY['job_cost_report'], 'job_cost_report',
 'Crew Analytics', 'Labor Analytics', 'currency', 'Derived', 'doc',
 'abs(revenue) / total_labor_hours',
 'safe(() => ctx.doc.total_labor_hours > 0 ? rd(Math.abs(ctx.doc.job_totals_revenue || 0) / ctx.doc.total_labor_hours, 2) : null)',
 '{job_totals_revenue,total_labor_hours}'),

('effective_hourly_rate', 'Effective Hourly Rate', ARRAY['job_cost_report'], 'job_cost_report',
 'Crew Analytics', 'Labor Analytics', 'currency', 'Derived', 'doc',
 'avg per-worker actual / hours',
 'safe(() => { const w = ctx.collections.worker || []; const totalAmt = w.reduce((s,r) => s + (r.actual_amount || 0), 0); const totalHrs = w.reduce((s,r) => s + (r.regular_hours || 0) + (r.overtime_hours || 0), 0); return totalHrs > 0 ? rd(totalAmt / totalHrs, 2) : null; })',
 '{}'),

('ot_premium_cost', 'OT Premium Cost', ARRAY['job_cost_report'], 'job_cost_report',
 'Crew Analytics', 'Labor Analytics', 'currency', 'Derived', 'doc',
 'OT amount - (effective_rate * OT hours)',
 'safe(() => { const w = ctx.collections.worker || []; const otAmt = w.reduce((s,r) => s + (r.overtime_amount || 0), 0); const otHrs = w.reduce((s,r) => s + (r.overtime_hours || 0), 0); return rd(otAmt - (ctx.doc.effective_hourly_rate || 0) * otHrs, 2); })',
 '{effective_hourly_rate}')

ON CONFLICT (primary_skill_id, canonical_name) DO UPDATE SET
  expression = EXCLUDED.expression,
  formula = EXCLUDED.formula,
  depends_on = EXCLUDED.depends_on,
  display_name = EXCLUDED.display_name,
  tab = EXCLUDED.tab,
  section = EXCLUDED.section,
  data_type = EXCLUDED.data_type,
  scope = EXCLUDED.scope,
  is_active = true,
  updated_at = now();
