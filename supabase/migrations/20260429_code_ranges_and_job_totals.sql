-- Add code_ranges JSONB column to document_skills for schema-driven cost code classification.
-- Populate for the JCR skill with standard Sage mappings.
-- Add job_totals_* derived fields and fix labor_unit_cost_per_hr expression.

-- 1. Add code_ranges column
ALTER TABLE document_skills
  ADD COLUMN IF NOT EXISTS code_ranges JSONB DEFAULT NULL;

-- 2. Populate JCR skill with Sage cost code ranges
-- Format: single codes (e.g. 39) or inclusive ranges ([200, 299])
UPDATE document_skills
SET code_ranges = '{
  "revenue": [999],
  "labor": [11, [100, 199]],
  "material": [39, [200, 299]],
  "burden": [995, 998],
  "gl_overhead": [11, 100],
  "subcontract": [[600, 699]]
}'::jsonb
WHERE skill_id = 'job_cost_report';

-- 3. Add job_totals_* as derived fields
DELETE FROM derived_fields WHERE canonical_name IN ('job_totals_revenue', 'job_totals_expenses', 'job_totals_net', 'job_totals_retainage');

INSERT INTO derived_fields (canonical_name, display_name, source_skill_ids, primary_skill_id, tab, section, data_type, status, scope, formula, expression, depends_on, is_active)
VALUES
  ('job_totals_revenue', 'Job Totals Revenue', ARRAY['job_cost_report'], 'job_cost_report', 'overview', 'financial_overview', 'currency', 'Derived', 'project',
   'abs(contract_value) — revenue is negative in Sage (credit)',
   'safe(() => Math.abs(ctx.doc.contract_value || 0))',
   ARRAY['contract_value']::text[], true),

  ('job_totals_expenses', 'Job Totals Expenses', ARRAY['job_cost_report'], 'job_cost_report', 'overview', 'financial_overview', 'currency', 'Derived', 'project',
   'Same as total_jtd_cost (sum of all expense codes)',
   'safe(() => ctx.doc.total_jtd_cost || null)',
   ARRAY['total_jtd_cost']::text[], true),

  ('job_totals_net', 'Job Totals Net', ARRAY['job_cost_report'], 'job_cost_report', 'overview', 'financial_overview', 'currency', 'Derived', 'project',
   'revenue - expenses',
   'safe(() => { const rev = ctx.doc.job_totals_revenue; const exp = ctx.doc.job_totals_expenses; return (rev != null && exp != null) ? rd(rev - exp, 2) : null; })',
   ARRAY['job_totals_revenue', 'job_totals_expenses']::text[], true),

  ('job_totals_retainage', 'Job Totals Retainage', ARRAY['job_cost_report'], 'job_cost_report', 'overview', 'financial_overview', 'currency', 'Derived', 'project',
   'Retainage amount (not always present in report)',
   'safe(() => ctx.doc.retainage || 0)',
   ARRAY[]::text[], true);

-- 4. Fix labor_unit_cost_per_hr — filter to labor code ranges (011 + 1xx) instead of all codes with hours
UPDATE derived_fields
SET formula = 'SUM(jtd_cost for labor codes 011 + 1xx) / total_labor_hours',
    expression = 'safe(() => { const codes = ctx.collections.cost_code || []; const laborCodes = codes.filter(c => { const n = parseInt(c.cost_code, 10); return (n >= 100 && n < 200) || n === 11; }); const cost = laborCodes.reduce((s, c) => s + (c.jtd_cost || 0), 0); const hrs = ctx.doc.total_labor_hours || 0; return hrs > 0 ? rd(cost / hrs, 2) : null; })',
    depends_on = ARRAY['total_labor_hours']::text[]
WHERE canonical_name = 'labor_unit_cost_per_hr';
