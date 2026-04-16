-- Switch secondaryTables from per-worker summaries to individual payroll transaction lines.
-- The LLM extracts each PR line (worker, cost code, amount, hours, type) as a separate record.
-- jcr-model.ts aggregates them by worker to compute total hours, wages, and tier.
UPDATE document_skills
SET multi_record_config = jsonb_set(
  COALESCE(multi_record_config, '{}'::jsonb),
  '{secondaryTables}',
  '[{
    "table": "payroll_transactions",
    "fields": [
      "Worker Name",
      "Worker ID",
      "Cost Code",
      "Amount",
      "Hours",
      "Hours Type",
      "Date"
    ]
  }]'::jsonb
)
WHERE skill_id = 'job_cost_report';
