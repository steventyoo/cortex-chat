-- Parser cache: stores validated Python parsers keyed by (skill_id, format_fingerprint).
-- Parsers are promoted only when all accounting identity checks pass.
-- Reused on subsequent documents of the same format, avoiding repeated Opus calls.

CREATE TABLE IF NOT EXISTS parser_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id TEXT NOT NULL REFERENCES document_skills(skill_id),
  format_fingerprint TEXT NOT NULL,
  parser_code TEXT NOT NULL,
  parser_hash TEXT NOT NULL,
  identity_score NUMERIC(5,2) NOT NULL DEFAULT 100,
  quality_score NUMERIC(5,2),
  checks_passed INT NOT NULL,
  checks_total INT NOT NULL,
  promoted_from UUID,
  validated_count INT DEFAULT 1,
  failure_count INT DEFAULT 0,
  last_validated_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(skill_id, format_fingerprint, parser_hash)
);

CREATE INDEX IF NOT EXISTS idx_parser_cache_lookup
  ON parser_cache(skill_id, format_fingerprint)
  WHERE is_active = true;

ALTER TABLE parser_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for parser_cache" ON parser_cache
  FOR ALL USING (true) WITH CHECK (true);

-- Three-tier check scoring: add check_role to consistency_checks.
-- identity  = accounting equations (parser promotion gate, must be 100%)
-- structural = extraction quality (retry triggers, quality score)
-- anomaly   = document characteristics (operator alerts, never scored)
ALTER TABLE consistency_checks
  ADD COLUMN IF NOT EXISTS check_role TEXT NOT NULL DEFAULT 'structural'
    CHECK (check_role IN ('identity', 'structural', 'anomaly'));

-- Tag existing JCR checks with their roles.

-- Identity checks (accounting equations):
UPDATE consistency_checks SET check_role = 'identity'
WHERE skill_id = 'job_cost_report' AND check_name IN (
  'source_sum_equals_expenses',
  'revenue_equals_code999',
  'contract_value_equals_revenue',
  'net_equals_revenue_minus_expenses',
  'expense_codes_sum',
  'budget_codes_sum',
  'total_overunder_identity',
  'overunder_identity',
  'code999_all_signs_negative',
  'pr_source_reconciliation',
  'pr_per_code_amount_reconciliation'
);

-- Structural checks (extraction quality):
UPDATE consistency_checks SET check_role = 'structural'
WHERE skill_id = 'job_cost_report' AND check_name IN (
  'no_negative_hours',
  'no_negative_hours_worker',
  'burden_codes_no_hours',
  'revenue_code_no_hours',
  'material_codes_no_hours',
  'labor_codes_have_hours',
  'expense_budgets_non_negative',
  'worker_count_vs_labor_codes',
  'pr_hours_exact_match',
  'pr_extracted_vs_computed',
  'gl_extracted_vs_computed',
  'ap_extracted_vs_computed',
  'worker_amount_components'
);

-- Anomaly checks (operator alerts):
UPDATE consistency_checks SET check_role = 'anomaly'
WHERE skill_id = 'job_cost_report' AND check_name IN (
  'nominal_rate_bounds',
  'worker_hours_bounds',
  'ot_ratio_bounds',
  'pr_txn_amounts_positive'
);
