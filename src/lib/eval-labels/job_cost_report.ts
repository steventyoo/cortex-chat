/**
 * Ground-truth evaluation labels for JCR Job 2012 (Exxel Pacific 8th Ave).
 *
 * Source: "JCR Test Labels — Job 2012.xlsx" (v4, 2026-04-18)
 * Sheets: Report Record, Cost Code Summaries, Worker Wages, Derived Fields
 *
 * Two-layer convention (per JCR Schema v4):
 *   - Worker regular_amount / overtime_amount = BASE wage from PR transaction lines
 *   - cost_by_source_pr_amount = burdened total from "Job Totals by Source" section (includes 995/998)
 *   - straight_time_rate, effective_hourly_rate use base wages
 *   - pr_src_cost_per_hr, fully_loaded_wage use burdened totals
 *
 * Sign conventions (from Reconciliation Actions):
 *   - plus_minus_budget = actual − current_budget (positive = over budget)
 *   - Revenue (code 999) is negative in Sage (credit); derived fields use abs(revenue)
 *   - nominal_rate = regular_amount ÷ regular_hours per worker (base wage)
 */

import { SkillEvalLabels, DerivedLabel, RecordLabel } from './types';

// ── Derived Labels (45 fields, record_key = "project") ────────────

const DERIVED_LABELS: DerivedLabel[] = [
  // Cost-by-Source Rollups
  { field: 'cost_by_source_pr_amount', expected: 439953.72, pipelineField: 'pr_amount', tolerance: 0.001 },
  { field: 'cost_by_source_ap_amount', expected: 408537.07, pipelineField: 'ap_amount', tolerance: 0.01 },
  { field: 'cost_by_source_gl_amount', expected: 9689.91, pipelineField: 'gl_amount', tolerance: 0.01 },
  { field: 'direct_cost', expected: 858180.70, pipelineField: 'direct_cost_total', tolerance: 0.001 },
  { field: 'net_profit', expected: 533274.30, tolerance: 0.001 },
  { field: 'pr_pct_of_revenue', expected: 31.6, tolerance: 0.02 },
  { field: 'ap_pct_of_revenue', expected: 29.4, tolerance: 0.02 },
  { field: 'direct_cost_pct_of_revenue', expected: 61.7, tolerance: 0.02 },

  // Labor Analytics
  { field: 'total_labor_hours', expected: 14652.25, tolerance: 0.001 },
  { field: 'pr_src_cost_per_hr', expected: 30.03, tolerance: 0.01 },
  { field: 'fully_loaded_wage', expected: 40.17, tolerance: 0.02 },
  { field: 'burden_multiplier', expected: 1.34, tolerance: 0.02 },
  { field: 'straight_time_rate', expected: 19.19, tolerance: 0.02 },
  { field: 'total_workers', expected: 42, tolerance: 0 },
  { field: 'burden_total', expected: 148589.84, tolerance: 0.001 },
  { field: 'nominal_wage_percentiles', expected: 0, notYetComputable: true },
  { field: 'lead_to_helper_ratio', expected: 0, notYetComputable: true },

  // Material Analytics
  { field: 'material_spend_total', expected: 390750.86, pipelineField: 'material_cost', tolerance: 0.001 },
  { field: 'material_budget_total', expected: 561666.00, pipelineField: 'material_total_budget', tolerance: 0.001 },
  { field: 'material_codes_tracked', expected: 11, tolerance: 0 },
  { field: 'material_codes_over_budget', expected: 2, tolerance: 0 },
  { field: 'material_codes_under_budget', expected: 9, tolerance: 0 },
  { field: 'material_vendor_count', expected: 17, notYetComputable: true },
  { field: 'top_vendor_spend', expected: 0, notYetComputable: true },

  // Phase Analytics
  { field: 'phases_over_budget', expected: 9, tolerance: 0 },
  { field: 'phases_under_budget', expected: 22, tolerance: 0 },
  // largest_overrun and largest_savings are string descriptions — we eval the numeric component
  { field: 'largest_overrun', expected: 37491.75, tolerance: 0.001 },
  { field: 'largest_savings', expected: -67199.30, tolerance: 0.001 },

  // Budget & Forecast
  { field: 'total_jtd_cost', expected: 858180.70, tolerance: 0.001 },
  { field: 'total_budget', expected: 1058658.15, pipelineField: 'total_revised_budget', tolerance: 0.001 },
  { field: 'overall_pct_budget_consumed', expected: 81.1, tolerance: 0.02 },
  { field: 'total_over_under_budget', expected: 200477.45, pipelineField: 'overunder_budget_line', tolerance: 0.001 },
  { field: 'labor_unit_cost_per_hr', expected: 19.88, tolerance: 0.02 },
  { field: 'revenue_per_labor_hour', expected: 94.97, tolerance: 0.02 },
  { field: 'material_price_variance', expected: 170915.14, tolerance: 0.001 },
  { field: 'variance_trend', expected: 0, notYetComputable: true },
  { field: 'co_absorption_rate', expected: 0, notYetComputable: true },
  { field: 'forecast_to_complete', expected: 0, notYetComputable: true },

  // Original Metrics
  { field: 'effective_hourly_rate', expected: 19.96, tolerance: 0.02 },
  { field: 'job_gross_margin_pct', expected: 38.3, pipelineField: 'gross_margin_pct', tolerance: 0.02 },
  { field: 'days_to_post', expected: 0, notYetComputable: true },
  { field: 'ot_premium_cost', expected: 11242.27, tolerance: 0.10 },
  { field: 'labor_to_material_ratio', expected: 1.13, pipelineField: 'labor_material_ratio', tolerance: 0.02 },

  // Project-level benchmarks (pending project attribute input)
  { field: 'project_duration_months', expected: 0, notYetComputable: true },
  { field: 'scope_benchmarks', expected: 0, notYetComputable: true },

  // Job Totals (derived from contract_value and cost code sums)
  { field: 'job_totals_revenue', expected: 1391455.00, tolerance: 0.001 },
  { field: 'job_totals_expenses', expected: 858180.70, tolerance: 0.001 },
  { field: 'job_totals_net', expected: 533274.30, tolerance: 0.001 },
  { field: 'job_totals_retainage', expected: 69572.75, tolerance: 0.001 },
];

// ── Extraction Labels: Cost Code Summaries (32 codes) ─────────────
// Fields per code: original_budget, current_budget (revised_budget), actual_amount (jtd_cost),
// plus_minus_budget (over_under_budget), regular_hours, overtime_hours, doubletime_hours

function cc(code: string): string {
  return `cost_code=${code}`;
}

function ccLabels(
  code: string,
  vals: {
    original_budget?: number;
    current_budget?: number;
    plus_minus_budget?: number;
    actual_amount?: number;
    regular_hours?: number;
    overtime_hours?: number;
    doubletime_hours?: number;
  },
): RecordLabel[] {
  const labels: RecordLabel[] = [];
  const t = 0.001; // tight tolerance for currency
  if (vals.original_budget != null) labels.push({ recordKey: cc(code), field: 'original_budget', expected: vals.original_budget, tolerance: t });
  if (vals.current_budget != null) labels.push({ recordKey: cc(code), field: 'revised_budget', expected: vals.current_budget, tolerance: t });
  if (vals.actual_amount != null) labels.push({ recordKey: cc(code), field: 'jtd_cost', expected: vals.actual_amount, tolerance: t });
  if (vals.plus_minus_budget != null) labels.push({ recordKey: cc(code), field: 'over_under_budget', expected: vals.plus_minus_budget, tolerance: t });
  if (vals.regular_hours != null) labels.push({ recordKey: cc(code), field: 'regular_hours', expected: vals.regular_hours, tolerance: 0 });
  if (vals.overtime_hours != null) labels.push({ recordKey: cc(code), field: 'overtime_hours', expected: vals.overtime_hours, tolerance: 0 });
  if (vals.doubletime_hours != null) labels.push({ recordKey: cc(code), field: 'doubletime_hours', expected: vals.doubletime_hours, tolerance: 0 });
  return labels;
}

const COST_CODE_LABELS: RecordLabel[] = [
  ...ccLabels('011', { original_budget: 12500, current_budget: 12500, plus_minus_budget: -8747.50, actual_amount: 3752.50, regular_hours: 155, overtime_hours: 28 }),
  ...ccLabels('039', { original_budget: 17900, current_budget: 17900, plus_minus_budget: -12833.20, actual_amount: 5066.80 }),
  ...ccLabels('100', { original_budget: 8100, current_budget: 8100, plus_minus_budget: -2077.00, actual_amount: 6023.00, regular_hours: 165, overtime_hours: 0 }),
  ...ccLabels('101', { original_budget: 12150, current_budget: 12150, plus_minus_budget: -5988.50, actual_amount: 6161.50, regular_hours: 172.50, overtime_hours: 0 }),
  ...ccLabels('110', { original_budget: 5800, current_budget: 5800, plus_minus_budget: -2615.75, actual_amount: 3184.25, regular_hours: 145.50, overtime_hours: 0 }),
  ...ccLabels('111', { original_budget: 14600, current_budget: 14600, plus_minus_budget: 4753.50, actual_amount: 19353.50, regular_hours: 808, overtime_hours: 64 }),
  ...ccLabels('112', { original_budget: 11700, current_budget: 11700, plus_minus_budget: -6276.00, actual_amount: 5424.00, regular_hours: 236, overtime_hours: 2 }),
  ...ccLabels('113', { original_budget: 2700, current_budget: 2700, plus_minus_budget: -1716.00, actual_amount: 984.00, regular_hours: 50, overtime_hours: 0 }),
  ...ccLabels('120', { original_budget: 139800, current_budget: 139800, plus_minus_budget: 37491.75, actual_amount: 177291.75, regular_hours: 8058, overtime_hours: 1261.50 }),
  ...ccLabels('130', { original_budget: 31000, current_budget: 31000, plus_minus_budget: 3658.38, actual_amount: 34658.38, regular_hours: 1840.75, overtime_hours: 0 }),
  ...ccLabels('140', { original_budget: 3300, current_budget: 3300, plus_minus_budget: -1132.00, actual_amount: 2168.00, regular_hours: 104, overtime_hours: 0 }),
  ...ccLabels('141', { original_budget: 41000, current_budget: 41000, plus_minus_budget: -25244.00, actual_amount: 15756.00, regular_hours: 800, overtime_hours: 0 }),
  ...ccLabels('142', { original_budget: 3525, current_budget: 3525, plus_minus_budget: 6259.00, actual_amount: 9784.00, regular_hours: 379, overtime_hours: 0 }),
  ...ccLabels('145', { original_budget: 19800, current_budget: 19800, plus_minus_budget: -13019.00, actual_amount: 6781.00, regular_hours: 279, overtime_hours: 59 }),
  ...ccLabels('210', { original_budget: 4300, current_budget: 4300, plus_minus_budget: -2664.49, actual_amount: 1635.51 }),
  ...ccLabels('211', { original_budget: 11970, current_budget: 11970, plus_minus_budget: -5370.97, actual_amount: 6599.03 }),
  ...ccLabels('212', { original_budget: 13130, current_budget: 13130, plus_minus_budget: -4550.81, actual_amount: 8579.19 }),
  ...ccLabels('213', { original_budget: 2700, current_budget: 2700, plus_minus_budget: -910.88, actual_amount: 1789.12 }),
  ...ccLabels('220', { original_budget: 161200, current_budget: 161200, plus_minus_budget: -67199.30, actual_amount: 94000.70, regular_hours: 0, overtime_hours: 1 }),
  ...ccLabels('230', { original_budget: 261600, current_budget: 269866, plus_minus_budget: -59720.78, actual_amount: 210145.22 }),
  ...ccLabels('240', { original_budget: 3000, current_budget: 3000, plus_minus_budget: -2003.68, actual_amount: 996.32 }),
  ...ccLabels('241', { original_budget: 65600, current_budget: 65600, plus_minus_budget: -28635.33, actual_amount: 36964.67 }),
  ...ccLabels('242', { original_budget: 12000, current_budget: 12000, plus_minus_budget: 10695.31, actual_amount: 22695.31 }),
  ...ccLabels('245', { original_budget: 0, current_budget: 0, plus_minus_budget: 2278.99, actual_amount: 2278.99 }),
  ...ccLabels('600', { original_budget: 1000, current_budget: 1000, plus_minus_budget: -814.00, actual_amount: 186.00 }),
  ...ccLabels('601', { original_budget: 22000, current_budget: 22000, plus_minus_budget: -6317.97, actual_amount: 15682.03 }),
  ...ccLabels('603', { original_budget: 10900, current_budget: 10900, plus_minus_budget: -1158.12, actual_amount: 9741.88 }),
  ...ccLabels('604', { original_budget: 0, current_budget: 0, plus_minus_budget: 1837.50, actual_amount: 1837.50 }),
  ...ccLabels('607', { original_budget: 25600, current_budget: 10000, plus_minus_budget: -9929.29, actual_amount: 70.71 }),
  ...ccLabels('995', { original_budget: 125049.58, current_budget: 125049.58, plus_minus_budget: 1250.88, actual_amount: 126300.46 }),
  ...ccLabels('998', { original_budget: 22067.57, current_budget: 22067.57, plus_minus_budget: 221.81, actual_amount: 22289.38 }),
  ...ccLabels('999', { original_budget: 1394655, current_budget: -1391455, actual_amount: -1391455 }),
];

// ── Extraction Labels: Worker Wages (42 workers) ──────────────────

function wk(name: string): string {
  return `worker=${name}`;
}

function wkLabels(
  name: string,
  vals: { regular_hours: number; overtime_hours: number; regular_amount: number; overtime_amount: number; nominal_rate?: number },
): RecordLabel[] {
  const labels: RecordLabel[] = [
    { recordKey: wk(name), field: 'regular_hours', expected: vals.regular_hours, tolerance: 0 },
    { recordKey: wk(name), field: 'overtime_hours', expected: vals.overtime_hours, tolerance: 0 },
    { recordKey: wk(name), field: 'regular_amount', expected: vals.regular_amount, tolerance: 0.001 },
    { recordKey: wk(name), field: 'overtime_amount', expected: vals.overtime_amount, tolerance: 0.001 },
  ];
  if (vals.nominal_rate != null) {
    labels.push({ recordKey: wk(name), field: 'worker_nominal_rate', expected: vals.nominal_rate, tolerance: 0.01 });
  }
  return labels;
}

const WORKER_LABELS: RecordLabel[] = [
  // PDF-verified base wages (not burdened). nominal_rate = base_reg_amount / reg_hours.

  // APPRENTICE/HELPER tier
  ...wkLabels('Rendon Villasenor, Ismael', { regular_hours: 36, overtime_hours: 0, regular_amount: 432.00, overtime_amount: 0, nominal_rate: 12.00 }),
  ...wkLabels('Hubbard, Dustin R', { regular_hours: 5, overtime_hours: 0, regular_amount: 60.00, overtime_amount: 0, nominal_rate: 12.00 }),
  ...wkLabels('Lopez Martinez, Abimael', { regular_hours: 201, overtime_hours: 10, regular_amount: 2412.00, overtime_amount: 180, nominal_rate: 12.00 }),
  ...wkLabels('Agustin Rodriguez, Ezequiel', { regular_hours: 83, overtime_hours: 10, regular_amount: 996.00, overtime_amount: 180, nominal_rate: 12.00 }),
  ...wkLabels('Soto Serna, Cesar E', { regular_hours: 249, overtime_hours: 0, regular_amount: 3237.00, overtime_amount: 0, nominal_rate: 13.00 }),
  ...wkLabels('Castaneda Juarez, Gustavo', { regular_hours: 7, overtime_hours: 0, regular_amount: 91.00, overtime_amount: 0, nominal_rate: 13.00 }),
  ...wkLabels('Wilson, Garret A', { regular_hours: 32, overtime_hours: 0, regular_amount: 416.00, overtime_amount: 0, nominal_rate: 13.00 }),
  ...wkLabels('Sanchez Garcia, Adelaido', { regular_hours: 155, overtime_hours: 0, regular_amount: 2015.00, overtime_amount: 0, nominal_rate: 13.00 }),
  ...wkLabels('Ramos Garcia, Jose M', { regular_hours: 363, overtime_hours: 2, regular_amount: 4719.00, overtime_amount: 39, nominal_rate: 13.00 }),
  ...wkLabels('Vega Arriaga, Jorge', { regular_hours: 316, overtime_hours: 57, regular_amount: 3803.00, overtime_amount: 1026, nominal_rate: 12.04 }),
  ...wkLabels('Rivera, Eli P', { regular_hours: 746, overtime_hours: 110, regular_amount: 9192.00, overtime_amount: 1992, nominal_rate: 12.32 }),
  ...wkLabels('Chavarria Lopez, Omar A', { regular_hours: 738, overtime_hours: 113, regular_amount: 9104.00, overtime_amount: 2046, nominal_rate: 12.34 }),
  ...wkLabels('Holmes, Anthony R', { regular_hours: 162, overtime_hours: 12, regular_amount: 2106.00, overtime_amount: 234, nominal_rate: 13.00 }),
  ...wkLabels('Gonzalez Hernandez, Josue', { regular_hours: 1001, overtime_hours: 134, regular_amount: 12924.00, overtime_amount: 2418, nominal_rate: 12.91 }),
  ...wkLabels('Velasquez Cruz, Denis M', { regular_hours: 94, overtime_hours: 12, regular_amount: 1222.00, overtime_amount: 234, nominal_rate: 13.00 }),
  ...wkLabels('Castaneda Juarez, Edgar D', { regular_hours: 197.25, overtime_hours: 0, regular_amount: 2742.88, overtime_amount: 0, nominal_rate: 13.91 }),
  ...wkLabels('Garcia, Jordan X', { regular_hours: 32, overtime_hours: 0, regular_amount: 448.00, overtime_amount: 0, nominal_rate: 14.00 }),
  ...wkLabels('Spears, Gregory M', { regular_hours: 262, overtime_hours: 46, regular_amount: 3406.00, overtime_amount: 897, nominal_rate: 13.00 }),
  ...wkLabels('Arreola, Israel A', { regular_hours: 42, overtime_hours: 0, regular_amount: 609.00, overtime_amount: 0, nominal_rate: 14.50 }),
  ...wkLabels('Monico Brambila, Jesus S', { regular_hours: 660, overtime_hours: 150, regular_amount: 8620.00, overtime_amount: 2928, nominal_rate: 13.06 }),
  ...wkLabels('Paco Leyva, Orlando', { regular_hours: 450.50, overtime_hours: 38, regular_amount: 6319.25, overtime_amount: 826.50, nominal_rate: 14.03 }),

  // JOURNEYMAN tier
  ...wkLabels('Vaughan, Tyler J', { regular_hours: 168.50, overtime_hours: 0, regular_amount: 2696.00, overtime_amount: 0, nominal_rate: 16.00 }),
  ...wkLabels('Soto Cruz, Jovani', { regular_hours: 280, overtime_hours: 0, regular_amount: 4480.00, overtime_amount: 0, nominal_rate: 16.00 }),
  ...wkLabels('Castro Hernandez, Jose A', { regular_hours: 763, overtime_hours: 99, regular_amount: 11903.00, overtime_amount: 2257.50, nominal_rate: 15.60 }),
  ...wkLabels('Rivera, Jorge A', { regular_hours: 501, overtime_hours: 60, regular_amount: 9018.00, overtime_amount: 1620, nominal_rate: 18.00 }),
  ...wkLabels('Lima Romero, Melvin A', { regular_hours: 946, overtime_hours: 105, regular_amount: 18406.00, overtime_amount: 2992.50, nominal_rate: 19.46 }),
  ...wkLabels('Meza Fuentes, Erick A', { regular_hours: 575.50, overtime_hours: 4, regular_amount: 11510.00, overtime_amount: 114, nominal_rate: 20.00 }),
  ...wkLabels('McCabe, Thomas C', { regular_hours: 8, overtime_hours: 4.50, regular_amount: 144.00, overtime_amount: 121.50, nominal_rate: 18.00 }),

  // LEAD/SUPERVISOR tier
  ...wkLabels('Cortes Mendiola, Victor H', { regular_hours: 193, overtime_hours: 48, regular_amount: 4619.00, overtime_amount: 1726.50, nominal_rate: 23.94 }),
  ...wkLabels('Sepulveda Gonzalez, Alfredo', { regular_hours: 176, overtime_hours: 66, regular_amount: 4224.00, overtime_amount: 2352.00, nominal_rate: 24.00 }),
  ...wkLabels('Veley, Nathaniel S', { regular_hours: 381, overtime_hours: 13, regular_amount: 10432.00, overtime_amount: 544.50, nominal_rate: 27.38 }),
  ...wkLabels('Waites, Thaddeus Z', { regular_hours: 319, overtime_hours: 0, regular_amount: 8932.00, overtime_amount: 0, nominal_rate: 28.00 }),
  ...wkLabels('Castaneda Martinez, Gustavo', { regular_hours: 248, overtime_hours: 35, regular_amount: 6696.00, overtime_amount: 1417.50, nominal_rate: 27.00 }),
  ...wkLabels('Sanders, Allen O', { regular_hours: 337.50, overtime_hours: 3.50, regular_amount: 9751.50, overtime_amount: 147, nominal_rate: 28.89 }),
  ...wkLabels('Palma Vides, Hugo', { regular_hours: 790, overtime_hours: 138, regular_amount: 21434.00, overtime_amount: 5601, nominal_rate: 27.13 }),
  ...wkLabels('Castro Hernandez, Carlos E', { regular_hours: 171, overtime_hours: 37.50, regular_amount: 4705.00, overtime_amount: 1529.25, nominal_rate: 27.51 }),
  ...wkLabels('Quintanilla, Esteban R', { regular_hours: 1111, overtime_hours: 88, regular_amount: 34877.00, overtime_amount: 4104, nominal_rate: 31.39 }),
  ...wkLabels('Hubbard, Robert W', { regular_hours: 3.50, overtime_hours: 0, regular_amount: 115.50, overtime_amount: 0, nominal_rate: 33.00 }),
  ...wkLabels('Gerard, Jeffrey S', { regular_hours: 406, overtime_hours: 0, regular_amount: 14595.00, overtime_amount: 0, nominal_rate: 35.95 }),
  ...wkLabels('Barnhart, Joseph N', { regular_hours: 11, overtime_hours: 14, regular_amount: 323.00, overtime_amount: 609, nominal_rate: 29.36 }),

  // OT-ONLY workers (no regular hours — nominal_rate not applicable)
  ...wkLabels('Salazar, Hajdar L', { regular_hours: 0, overtime_hours: 14, regular_amount: 0, overtime_amount: 252 }),
  ...wkLabels('Reed, Reuben H', { regular_hours: 0, overtime_hours: 8, regular_amount: 0, overtime_amount: 324 }),
];

// ── Combine all extraction labels ─────────────────────────────────

const EXTRACTION_LABELS: RecordLabel[] = [
  ...COST_CODE_LABELS,
  ...WORKER_LABELS,
];

// ── Export ─────────────────────────────────────────────────────────

const labels: SkillEvalLabels = {
  skillId: 'job_cost_report',
  projectId: '2012-EXXEL-8THAVE',
  derivedLabels: DERIVED_LABELS,
  extractionLabels: EXTRACTION_LABELS,
  langfuse: {
    derivedDataset: 'cortex-derived-accuracy-job_cost_report',
    extractionDataset: 'cortex-extraction-accuracy-job_cost_report',
  },
};

export default labels;
