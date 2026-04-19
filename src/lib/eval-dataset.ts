/**
 * Langfuse eval dataset definition for Cortex chat.
 *
 * Each item pairs a question with expected outputs so the eval runner
 * can score chat traces for correctness, tool routing, and answer matching.
 *
 * Expected values sourced from: Copy of OWP_2012_JCR_Summary_Notion_v2.xlsx
 * (Steven's workbook — canonical source of truth for JCR #2012).
 *
 * Categories mirror the discrepancy slides:
 *   Total Fixtures | Total Vendors | Total Payroll Data | Budget vs Actual | Costs by Job Code
 */

export interface EvalKeyValues {
  [key: string]: string | number | boolean | null;
}

export interface EvalItem {
  id: string;
  category: string;
  question: string;
  projectId: string;
  expectedAnswer: string;
  keyValues: EvalKeyValues;
  expectedTool: string;
}

export const DATASET_NAME = 'cortex-2012-evals';
export const DEFAULT_PROJECT_ID = '2012-EXXEL-8THAVE';

export const EVAL_ITEMS: EvalItem[] = [
  // ── Total Fixtures ───────────────────────────────────────────
  {
    id: 'fixtures-total',
    category: 'Total Fixtures',
    question: 'What is the total fixture count?',
    projectId: DEFAULT_PROJECT_ID,
    expectedAnswer: '1004 fixtures',
    keyValues: { fixture_count: 1004 },
    expectedTool: 'project_overview',
  },
  {
    id: 'fixtures-per-unit',
    category: 'Total Fixtures',
    question: 'How many fixtures per unit?',
    projectId: DEFAULT_PROJECT_ID,
    expectedAnswer: '5 fixtures per unit',
    keyValues: { fixtures_per_unit: 5.01 },
    expectedTool: 'project_overview',
  },

  // ── Total Vendors ────────────────────────────────────────────
  {
    id: 'vendors-total',
    category: 'Total Vendors',
    question: 'How many vendors or subcontractors are on this project?',
    projectId: DEFAULT_PROJECT_ID,
    expectedAnswer: '17 vendors',
    keyValues: { material_vendor_count: 17 },
    expectedTool: 'project_overview',
  },
  {
    id: 'vendors-top',
    category: 'Total Vendors',
    question: 'Who are the top subcontractors by spend amount?',
    projectId: DEFAULT_PROJECT_ID,
    expectedAnswer: 'Keller Supply is the top vendor at $150,008 (37% of material spend), followed by Ferguson and Mech Sales. Top 3 = 80% concentration.',
    keyValues: { top_vendor_spend: 150008, top_3_vendor_concentration: 0.80 },
    expectedTool: 'project_overview',
  },

  // ── Total Payroll Data and Details ───────────────────────────
  {
    id: 'payroll-crew-composition',
    category: 'Payroll',
    question: "What's the crew composition by tier?",
    projectId: DEFAULT_PROJECT_ID,
    expectedAnswer: '1 Superintendent ($33-38/hr), 4 Lead Journeymen ($28-31/hr), 8 Journeymen ($20-27/hr), 7 Apprentices ($12-16/hr), 8 Helpers ($12-14/hr). 28 total crew.',
    keyValues: { total_workers: 28 },
    expectedTool: 'jcr_analysis',
  },
  {
    id: 'payroll-total-workers',
    category: 'Payroll',
    question: 'How many workers were on this project?',
    projectId: DEFAULT_PROJECT_ID,
    expectedAnswer: '42 unique workers touched the job (28 core crew, remainder are spot/phase helpers)',
    keyValues: { total_workers: 42 },
    expectedTool: 'jcr_analysis',
  },
  {
    id: 'payroll-blended-wage',
    category: 'Payroll',
    question: 'What is the blended gross wage rate?',
    projectId: DEFAULT_PROJECT_ID,
    expectedAnswer: '$19.94/hr gross, $30.12/hr fully loaded (1.51x burden multiplier)',
    keyValues: { blended_gross_wage: 19.94, fully_loaded_wage: 30.12 },
    expectedTool: 'jcr_analysis',
  },
  {
    id: 'payroll-ot-ratio',
    category: 'Payroll',
    question: 'What is the overtime ratio for this project?',
    projectId: DEFAULT_PROJECT_ID,
    expectedAnswer: '9.77% OT ratio (1,431.5 OT hours out of 14,652.2 total)',
    keyValues: { ot_ratio: 0.0977 },
    expectedTool: 'jcr_analysis',
  },
  {
    id: 'payroll-total-hours',
    category: 'Payroll',
    question: 'What are the total labor hours from payroll?',
    projectId: DEFAULT_PROJECT_ID,
    expectedAnswer: '14,607 total labor hours (approximately 90 hours per unit)',
    keyValues: { total_labor_hours: 14607 },
    expectedTool: 'jcr_analysis',
  },

  // ── Budget vs Actual ─────────────────────────────────────────
  {
    id: 'budget-variance',
    category: 'Budget vs Actual',
    question: "What's the budget variance — revised budget vs job to date cost?",
    projectId: DEFAULT_PROJECT_ID,
    expectedAnswer: 'Total budget $1,065,993, total actual $858,182, variance -$207,811 (19.5% under budget)',
    keyValues: { total_budget: 1065993, total_actual: 858182, variance: -207811 },
    expectedTool: 'project_overview',
  },
  {
    id: 'budget-margin',
    category: 'Budget vs Actual',
    question: 'What is the projected margin and margin percentage?',
    projectId: DEFAULT_PROJECT_ID,
    expectedAnswer: 'Net profit $533,274 on $1,391,455 revenue = 38.3% gross margin',
    keyValues: { net_profit: 533274, gross_margin: 0.383 },
    expectedTool: 'project_overview',
  },
  {
    id: 'budget-contract-value',
    category: 'Budget vs Actual',
    question: 'What is the contract value for this project?',
    projectId: DEFAULT_PROJECT_ID,
    expectedAnswer: '$1,394,655 contract value with 163 residential units',
    keyValues: { contract_value: 1394655 },
    expectedTool: 'project_overview',
  },

  // ── Costs by Job Code ────────────────────────────────────────
  {
    id: 'costs-breakdown',
    category: 'Costs by Job Code',
    question: 'Show me the cost breakdown by source (payroll, AP, GL).',
    projectId: DEFAULT_PROJECT_ID,
    expectedAnswer: 'Payroll (PR) $439,954 (51.3%), Accounts Payable (AP) $408,537 (47.6%), General Ledger (GL) $9,690 (1.1%). Total direct cost $858,181.',
    keyValues: { payroll_cost: 439954, ap_cost: 408537, gl_cost: 9690, total_direct_cost: 858181 },
    expectedTool: 'jcr_analysis',
  },
  {
    id: 'costs-labor-pct',
    category: 'Costs by Job Code',
    question: 'What percentage of total cost is labor?',
    projectId: DEFAULT_PROJECT_ID,
    expectedAnswer: 'Labor is 51.3% of total direct cost ($439,954 payroll out of $858,181)',
    keyValues: { labor_pct: 0.513 },
    expectedTool: 'jcr_analysis',
  },
  {
    id: 'costs-material-pct',
    category: 'Costs by Job Code',
    question: 'What percentage of total cost is material?',
    projectId: DEFAULT_PROJECT_ID,
    expectedAnswer: 'Material is 45.5% of direct cost ($390,751 out of $858,181). Material as % of revenue is 29.4%.',
    keyValues: { material_pct_of_direct: 0.455, material_spend: 390751 },
    expectedTool: 'jcr_analysis',
  },
  {
    id: 'costs-largest-overrun',
    category: 'Costs by Job Code',
    question: 'Which cost code had the largest budget overrun?',
    projectId: DEFAULT_PROJECT_ID,
    expectedAnswer: 'Mech Room (142) at +178% over budget — $9,784 actual vs $3,525 budget. Roughin Labor (120) had the largest dollar overrun at +$37,492.',
    keyValues: { mech_room_actual: 9784, mech_room_budget: 3525 },
    expectedTool: 'jcr_analysis',
  },

  // ── Productivity & Per-Unit Benchmarks ───────────────────────
  {
    id: 'benchmark-cost-per-unit',
    category: 'Benchmark KPIs',
    question: 'What is the cost per unit and revenue per unit?',
    projectId: DEFAULT_PROJECT_ID,
    expectedAnswer: 'Cost per unit $5,265, revenue per unit $8,537, profit per unit $3,272',
    keyValues: { cost_per_unit: 5265, revenue_per_unit: 8537, profit_per_unit: 3272 },
    expectedTool: 'project_overview',
  },
  {
    id: 'benchmark-hours-per-unit',
    category: 'Benchmark KPIs',
    question: 'How many labor hours per unit?',
    projectId: DEFAULT_PROJECT_ID,
    expectedAnswer: 'Approximately 90 hours per unit (14,607 total hours / 163 units)',
    keyValues: { hours_per_unit: 89.6 },
    expectedTool: 'jcr_analysis',
  },
  {
    id: 'benchmark-labor-material-ratio',
    category: 'Benchmark KPIs',
    question: 'What is the labor to material ratio?',
    projectId: DEFAULT_PROJECT_ID,
    expectedAnswer: 'Labor : Material ratio of 1.05 : 1. Plumbing on mid-rise typically tracks roughly 1:1.',
    keyValues: { labor_to_material_ratio: 1.05 },
    expectedTool: 'jcr_analysis',
  },
  {
    id: 'benchmark-revenue-per-labor-hour',
    category: 'Benchmark KPIs',
    question: 'What is the revenue per labor hour and profit per labor hour?',
    projectId: DEFAULT_PROJECT_ID,
    expectedAnswer: 'Revenue per labor hour $95.26, profit per labor hour $36.51',
    keyValues: { revenue_per_labor_hour: 95.26, profit_per_labor_hour: 36.51 },
    expectedTool: 'jcr_analysis',
  },

  // ── Material ─────────────────────────────────────────────────
  {
    id: 'material-total-spend',
    category: 'Material',
    question: 'What is the total material spend and how does it compare to budget?',
    projectId: DEFAULT_PROJECT_ID,
    expectedAnswer: 'Total material spend $390,751 vs $553,400 budget — $162,649 under budget (29% favorable)',
    keyValues: { material_spend: 390751, material_budget: 553400, material_variance: -162649 },
    expectedTool: 'jcr_analysis',
  },
  {
    id: 'material-largest-line',
    category: 'Material',
    question: 'What is the largest material cost line?',
    projectId: DEFAULT_PROJECT_ID,
    expectedAnswer: 'Finish Material (230) at $210,145 — 54% of all material spend. Roughin Material (220) at $94,001 is second (24%).',
    keyValues: { finish_material: 210145, roughin_material: 94001 },
    expectedTool: 'jcr_analysis',
  },
];
