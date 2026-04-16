-- Add secondary worker extraction table to job_cost_report skill
-- This tells the vision extractor to also parse per-worker PR transaction lines
-- from the JCR PDF (worker name, ID, hours, wages, rate, cost codes worked).

UPDATE document_skills
SET multi_record_config = jsonb_set(
  COALESCE(multi_record_config, '{}'::jsonb),
  '{secondaryTables}',
  '[{
    "table": "worker_transactions",
    "fields": [
      "Worker Name",
      "Worker ID",
      "Regular Hours",
      "OT Hours",
      "Total Hours",
      "Wages",
      "Hourly Rate",
      "Cost Codes Worked"
    ]
  }]'::jsonb
)
WHERE skill_id = 'job_cost_report';
