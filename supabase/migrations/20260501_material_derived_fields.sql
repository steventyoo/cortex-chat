-- Add derived field definitions for material overrun/savings analysis

INSERT INTO derived_fields (canonical_name, display_name, source_skill_ids, primary_skill_id, tab, section, data_type, status, scope, formula, expression, depends_on) VALUES

('largest_material_overrun', 'Largest Material Overrun', ARRAY['job_cost_report'], 'job_cost_report',
 'Material', 'Summary', 'currency', 'Derived', 'doc',
 'MAX over_under_budget for material codes (most over budget)',
 '(() => { const mats = ctx.collections.cost_code.filter(r => { const c = parseInt(String(r.cost_code || 0)); return (c >= 200 && c <= 299) || c === 39; }); if (mats.length === 0) return null; const overruns = mats.map(r => r.over_under_budget || 0).filter(v => v < 0); return overruns.length > 0 ? Math.min(...overruns) : 0; })()',
 '{}'),

('largest_material_savings', 'Largest Material Savings', ARRAY['job_cost_report'], 'job_cost_report',
 'Material', 'Summary', 'currency', 'Derived', 'doc',
 'MAX positive over_under_budget for material codes (most under budget)',
 '(() => { const mats = ctx.collections.cost_code.filter(r => { const c = parseInt(String(r.cost_code || 0)); return (c >= 200 && c <= 299) || c === 39; }); if (mats.length === 0) return null; const savings = mats.map(r => r.over_under_budget || 0).filter(v => v > 0); return savings.length > 0 ? Math.max(...savings) : 0; })()',
 '{}');
