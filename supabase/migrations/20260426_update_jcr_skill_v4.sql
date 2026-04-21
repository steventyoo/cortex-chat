-- Update job_cost_report skill: v4 canonical field names, v4 Notes as descriptions.
-- field_definitions now ONLY contains extracted fields (derived fields live in derived_fields table).
-- multi_record_config updated to v4 canonical column names.

UPDATE document_skills
SET
  field_definitions = '[
    {"name":"job_number","type":"string","tier":0,"required":true,"description":"Job number from the accounting/ERP system. Primary key for cross-document linking.","importance":"E"},
    {"name":"job_name","type":"string","tier":0,"required":true,"description":"Project name or description as shown in the accounting system.","importance":"E"},
    {"name":"company","type":"string","tier":0,"required":false,"description":"Company or entity the report belongs to.","importance":"E"},
    {"name":"client","type":"string","tier":0,"required":false,"description":"Client or general contractor name.","importance":"E"},
    {"name":"report_date","type":"date","tier":0,"required":false,"description":"Date the report was generated.","importance":"E"},
    {"name":"report_period","type":"string","tier":0,"required":true,"description":"The time period this report covers (e.g., month, quarter).","importance":"P"},
    {"name":"project_type","type":"string","tier":1,"required":false,"description":"Classification of project type for cross-project comparison.","importance":"P"},
    {"name":"trade","type":"string","tier":1,"required":false,"description":"Primary trade or scope of work for the project.","importance":"P"},
    {"name":"contract_value","type":"number","tier":0,"required":true,"description":"Total contract value (revenue). From sales cost code (999) or total_revenues field. Use ABS if negative.","importance":"P"},
    {"name":"total_revised_budget","type":"number","tier":0,"required":true,"description":"Total revised budget amount including all approved change orders.","importance":"P"},
    {"name":"total_jtd_cost","type":"number","tier":0,"required":true,"description":"Total costs incurred on the job from inception to the report date.","importance":"P"},
    {"name":"total_change_orders","type":"number","tier":0,"required":false,"description":"Total dollar amount of all approved change orders.","importance":"P"},
    {"name":"total_over_under_budget","type":"number","tier":0,"required":false,"description":"Total dollar variance — positive means under budget, negative means over.","importance":"P"},
    {"name":"overall_pct_budget_consumed","type":"number","tier":0,"required":false,"description":"Percentage of revised budget that has been spent (JTD / Revised Budget).","importance":"P"},
    {"name":"pr_amount","type":"number","tier":0,"required":false,"description":"Payroll source total. Sum of all PR (payroll) transactions.","importance":"P"},
    {"name":"ap_amount","type":"number","tier":0,"required":false,"description":"Accounts Payable source total. Sum of all AP transactions.","importance":"P"},
    {"name":"gl_amount","type":"number","tier":0,"required":false,"description":"General Ledger source total. Sum of all GL journal entries.","importance":"P"}
  ]'::jsonb,

  multi_record_config = '{
    "table": "cost_codes",
    "fields": [
      "cost_code",
      "description",
      "cost_category",
      "original_budget",
      "revised_budget",
      "change_orders",
      "jtd_cost",
      "over_under_budget",
      "pct_budget_consumed",
      "regular_hours",
      "overtime_hours",
      "doubletime_hours"
    ],
    "secondaryTables": [{
      "table": "payroll_transactions",
      "fields": [
        "cost_code",
        "description",
        "source",
        "document_date",
        "posted_date",
        "number",
        "name",
        "regular_hours",
        "overtime_hours",
        "regular_amount",
        "overtime_amount",
        "actual_amount",
        "check_number"
      ]
    }]
  }'::jsonb

WHERE skill_id = 'job_cost_report';
