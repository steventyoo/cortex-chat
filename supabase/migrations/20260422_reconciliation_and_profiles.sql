-- Migration: reconciliation engine tables
-- Adds reconciliation_rules (configurable comparison rules)
-- and reconciliation_results (per-run comparison outcomes)

BEGIN;

-- ============================================================
-- PART 1: reconciliation_rules
-- ============================================================

CREATE TABLE IF NOT EXISTS reconciliation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_type_key TEXT NOT NULL REFERENCES document_link_types(link_type_key),
  rule_name TEXT NOT NULL,
  description TEXT NOT NULL,

  source_field TEXT NOT NULL,
  target_field TEXT NOT NULL,
  match_key TEXT NOT NULL,
  aggregation TEXT NOT NULL DEFAULT 'sum'
    CHECK (aggregation IN ('sum', 'count', 'latest', 'direct')),

  tolerance_pct NUMERIC DEFAULT 5,
  tolerance_abs NUMERIC DEFAULT 0,
  severity TEXT NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('info', 'warning', 'error')),

  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_recon_rules_link_type ON reconciliation_rules(link_type_key);
CREATE INDEX idx_recon_rules_active ON reconciliation_rules(is_active) WHERE is_active = true;

ALTER TABLE reconciliation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for reconciliation_rules" ON reconciliation_rules
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- PART 2: reconciliation_results
-- ============================================================

CREATE TABLE IF NOT EXISTS reconciliation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  rule_id UUID NOT NULL REFERENCES reconciliation_rules(id),

  match_key_value TEXT,
  source_record_id UUID REFERENCES extracted_records(id) ON DELETE SET NULL,
  target_record_id UUID REFERENCES extracted_records(id) ON DELETE SET NULL,

  source_value NUMERIC,
  target_value NUMERIC,
  difference NUMERIC,
  difference_pct NUMERIC,

  status TEXT NOT NULL CHECK (status IN ('pass', 'warning', 'fail', 'no_match')),
  message TEXT,

  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  run_id UUID
);

CREATE INDEX idx_recon_results_org ON reconciliation_results(org_id);
CREATE INDEX idx_recon_results_project ON reconciliation_results(org_id, project_id);
CREATE INDEX idx_recon_results_rule ON reconciliation_results(rule_id);
CREATE INDEX idx_recon_results_status ON reconciliation_results(status);
CREATE INDEX idx_recon_results_run ON reconciliation_results(run_id);
CREATE INDEX idx_recon_results_source ON reconciliation_results(source_record_id);
CREATE INDEX idx_recon_results_target ON reconciliation_results(target_record_id);

ALTER TABLE reconciliation_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for reconciliation_results" ON reconciliation_results
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- PART 3: project_profiles (materialized snapshots)
-- ============================================================

CREATE TABLE IF NOT EXISTS project_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,

  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  version INT NOT NULL DEFAULT 1,

  document_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_documents INT DEFAULT 0,

  contract_value NUMERIC,
  revised_budget NUMERIC,
  job_to_date_cost NUMERIC,
  percent_complete NUMERIC,
  projected_final_cost NUMERIC,
  projected_margin NUMERIC,
  projected_margin_pct NUMERIC,

  total_budget_hours NUMERIC,
  total_actual_hours NUMERIC,
  labor_productivity_ratio NUMERIC,
  blended_labor_rate NUMERIC,
  estimated_labor_rate NUMERIC,
  hours_per_unit JSONB,

  total_cos INT DEFAULT 0,
  total_co_value NUMERIC DEFAULT 0,
  approved_co_value NUMERIC DEFAULT 0,
  pending_co_value NUMERIC DEFAULT 0,
  co_absorption_rate NUMERIC,

  risk_score NUMERIC,
  risk_level TEXT,
  productivity_drift NUMERIC,
  burn_gap NUMERIC,
  rate_drift NUMERIC,

  reconciliation_pass_rate NUMERIC,
  reconciliation_warnings INT DEFAULT 0,
  reconciliation_failures INT DEFAULT 0,

  coverage_score NUMERIC,
  covered_cost_codes INT DEFAULT 0,
  missing_cost_codes INT DEFAULT 0,

  top_subs JSONB,
  sub_co_rate NUMERIC,

  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(org_id, project_id, snapshot_date)
);

CREATE INDEX idx_profiles_org ON project_profiles(org_id);
CREATE INDEX idx_profiles_project ON project_profiles(org_id, project_id);
CREATE INDEX idx_profiles_date ON project_profiles(snapshot_date DESC);

ALTER TABLE project_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for project_profiles" ON project_profiles
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- PART 4: Seed core reconciliation rules
-- ============================================================

INSERT INTO reconciliation_rules
  (link_type_key, rule_name, description, source_field, target_field, match_key, aggregation, tolerance_pct, tolerance_abs, severity)
VALUES
  (
    'production_vs_jcr',
    'Labor hours match',
    'Compare production actual labor hours against JCR job-to-date labor hours by cost code',
    'Actual Labor Hours',
    'Job to Date',
    'cost_code',
    'sum',
    5, 0, 'warning'
  ),
  (
    'payapp_vs_jcr',
    'Billing vs actual cost',
    'Compare pay application current payment due against JCR job-to-date cost by billing period',
    'Current Payment Due',
    'Job to Date',
    'billing_period',
    'sum',
    3, 0, 'warning'
  ),
  (
    'estimate_vs_jcr',
    'Budget vs revised budget',
    'Compare original estimate amount against JCR revised budget by cost code — should be exact match after COs absorbed',
    'Estimated Amount',
    'Revised Budget',
    'cost_code',
    'direct',
    0, 0, 'error'
  ),
  (
    'co_absorption_jcr',
    'CO absorbed in JCR',
    'Verify that approved change order dollars appear in JCR revised budget delta by cost code',
    'Owner Approved Amount',
    'Revised Budget',
    'cost_code',
    'sum',
    2, 100, 'warning'
  ),
  (
    'daily_report_vs_jcr',
    'Crew count vs labor hours',
    'Cross-check daily report worker counts against JCR actual labor hours by date',
    'Total Workers',
    'Actual Labor Hours',
    'date',
    'sum',
    10, 0, 'info'
  );

COMMIT;
