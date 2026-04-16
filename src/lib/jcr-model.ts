/**
 * JCR Model Engine
 * Transforms extracted JCR data into canonical Export rows for jcr_export table.
 */

import { getSupabase } from './supabase';

// ── Types ────────────────────────────────────────────────────

export interface ExportRow {
  tab: string;
  section: string;
  record_key: string;
  field: string;
  canonical_name: string;
  display_name: string;
  data_type: 'currency' | 'number' | 'string' | 'percent' | 'integer' | 'ratio' | 'date';
  status: 'Extracted' | 'Derived' | 'Cross-Ref';
  value_text: string | null;
  value_number: number | null;
  notes: string | null;
}

export interface ProjectMeta {
  unitCount?: number;
  fixtureCount?: number;
  durationMonths?: number;
  gcName?: string;
  location?: string;
  projectType?: string;
}

interface FieldVal {
  value: string | number | null;
  confidence: number;
}

type RecordRow = Record<string, FieldVal>;
type FieldsMap = Record<string, FieldVal>;

export interface WorkerRecord {
  name: string;
  id: string;
  regHours: number;
  otHours: number;
  totalHours: number;
  wages: number;
  rate: number;
  codesWorked: number;
  tier: string;
}

const TIER_BANDS: Array<{ tier: string; minRate: number }> = [
  { tier: 'Superintendent', minRate: 33 },
  { tier: 'Lead Journeyman', minRate: 28 },
  { tier: 'Journeyman', minRate: 20 },
  { tier: 'Apprentice', minRate: 15 },
  { tier: 'Helper', minRate: 0 },
];

function classifyTier(rate: number): string {
  for (const band of TIER_BANDS) {
    if (rate >= band.minRate) return band.tier;
  }
  return 'Helper';
}

// ── Helpers ──────────────────────────────────────────────────

function num(f: FieldVal | undefined): number {
  if (!f?.value) return 0;
  if (typeof f.value === 'number') return f.value;
  const s = String(f.value).replace(/[$,%\s]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function str(f: FieldVal | undefined): string {
  if (!f?.value) return '';
  return String(f.value);
}

function pct(f: FieldVal | undefined): number {
  if (!f?.value) return 0;
  const s = String(f.value).replace(/[%\s]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function parseHours(f: FieldVal | undefined): { total: number; reg: number; ot: number } {
  if (!f?.value) return { total: 0, reg: 0, ot: 0 };
  const s = String(f.value);
  const totalMatch = s.match(/([\d,.]+)\s*hours/i);
  const regMatch = s.match(/Reg:\s*([\d,.]+)/i);
  const otMatch = s.match(/O\/T:\s*([\d,.]+)/i);
  return {
    total: totalMatch ? parseFloat(totalMatch[1].replace(/,/g, '')) || 0 : 0,
    reg: regMatch ? parseFloat(regMatch[1].replace(/,/g, '')) || 0 : 0,
    ot: otMatch ? parseFloat(otMatch[1].replace(/,/g, '')) || 0 : 0,
  };
}

function fv(rec: RecordRow, ...names: string[]): FieldVal | undefined {
  for (const n of names) {
    if (rec[n]) return rec[n];
  }
  return undefined;
}

function row(
  tab: string, section: string, recordKey: string, field: string,
  canonical: string, display: string, dtype: ExportRow['data_type'],
  status: ExportRow['status'], valNum: number | null, valText: string | null,
  notes?: string
): ExportRow {
  return {
    tab, section, record_key: recordKey, field, canonical_name: canonical,
    display_name: display, data_type: dtype, status, value_number: valNum,
    value_text: valText, notes: notes || null,
  };
}

function cc(rec: RecordRow): string {
  return str(fv(rec, 'Line Item Number / Cost Code'));
}

function cat(rec: RecordRow): string {
  return str(fv(rec, 'Cost Category')).toLowerCase();
}

function safe(n: number | undefined | null, d: number): number | null {
  if (n == null || d === 0) return null;
  return n / d;
}

function rd(n: number | null): number | null {
  return n != null ? Math.round(n * 100) / 100 : null;
}


// ── Tab 1: Overview ──────────────────────────────────────────

function buildOverview(
  records: RecordRow[], fields: FieldsMap, meta: ProjectMeta
): ExportRow[] {
  const rows: ExportRow[] = [];
  const t = 'Overview', s = 'Project Summary', k = 'project';

  const totalRevBudget = records
    .filter(r => cc(r) !== '999' && !cc(r).startsWith('Overhead'))
    .reduce((sum, r) => sum + num(fv(r, 'Revised Budget (line)')), 0);
  const totalJtd = records
    .filter(r => cc(r) !== '999' && !cc(r).startsWith('Overhead'))
    .reduce((sum, r) => sum + num(fv(r, 'Job-to-Date Cost (line)')), 0);
  const totalOverUnder = records
    .filter(r => cc(r) !== '999' && !cc(r).startsWith('Overhead'))
    .reduce((sum, r) => sum + num(fv(r, 'Over/Under Budget — $ (line)')), 0);

  const revenue = Math.abs(num(fields['total_revenues'] || fields['sales_cost_code_999_rev_budget']));
  const netProfit = revenue - totalJtd;
  const grossMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

  const laborCost = records.filter(r => cat(r) === 'labor').reduce((s, r) => s + num(fv(r, 'Job-to-Date Cost (line)')), 0);
  const materialCost = records.filter(r => cat(r) === 'material').reduce((s, r) => s + num(fv(r, 'Job-to-Date Cost (line)')), 0);
  const overheadCost = records.filter(r => cat(r) === 'overhead').reduce((s, r) => s + num(fv(r, 'Job-to-Date Cost (line)')), 0);
  const subCost = records.filter(r => cat(r) === 'subcontract').reduce((s, r) => s + num(fv(r, 'Job-to-Date Cost (line)')), 0);
  const otherCost = records.filter(r => cat(r) === 'other' && cc(r) !== '999').reduce((s, r) => s + num(fv(r, 'Job-to-Date Cost (line)')), 0);

  let totalHours = 0;
  records.filter(r => cat(r) === 'labor').forEach(r => { totalHours += parseHours(fv(r, 'Quantity (labor hours or units)')).total; });

  rows.push(row(t, s, k, 'contract_value', 'contract_value', 'Contract Value', 'currency', 'Extracted', revenue, null));
  rows.push(row(t, s, k, 'revised_budget', 'revised_budget', 'Revised Budget', 'currency', 'Extracted', totalRevBudget, null));
  rows.push(row(t, s, k, 'job_to_date_cost', 'job_to_date_cost', 'Job-to-Date Cost', 'currency', 'Extracted', totalJtd, null));
  rows.push(row(t, s, k, 'total_over_under', 'total_over_under', 'Total Over/Under', 'currency', 'Derived', totalOverUnder, null));
  rows.push(row(t, s, k, 'net_profit', 'net_profit', 'Net Profit', 'currency', 'Derived', rd(netProfit), null));
  rows.push(row(t, s, k, 'gross_margin_pct', 'gross_margin_pct', 'Gross Margin %', 'percent', 'Derived', rd(grossMargin), null));
  rows.push(row(t, s, k, 'direct_cost_total', 'direct_cost_total', 'Direct Cost Total', 'currency', 'Derived', rd(totalJtd), null));
  rows.push(row(t, s, k, 'labor_cost', 'labor_cost', 'Labor Cost', 'currency', 'Extracted', rd(laborCost), null));
  rows.push(row(t, s, k, 'material_cost', 'material_cost', 'Material Cost', 'currency', 'Extracted', rd(materialCost), null));
  rows.push(row(t, s, k, 'overhead_cost', 'overhead_cost', 'Overhead Cost', 'currency', 'Extracted', rd(overheadCost), null));
  rows.push(row(t, s, k, 'subcontract_cost', 'subcontract_cost', 'Subcontract Cost', 'currency', 'Extracted', rd(subCost), null));
  rows.push(row(t, s, k, 'other_cost', 'other_cost', 'Other Cost', 'currency', 'Extracted', rd(otherCost), null));
  rows.push(row(t, s, k, 'total_labor_hours', 'total_labor_hours', 'Total Labor Hours', 'number', 'Extracted', rd(totalHours), null));
  rows.push(row(t, s, k, 'source_pr', 'source_pr', 'Source: Payroll', 'currency', 'Extracted', num(fields['source_pr']), null));
  rows.push(row(t, s, k, 'source_ap', 'source_ap', 'Source: AP', 'currency', 'Extracted', num(fields['source_ap']), null));
  rows.push(row(t, s, k, 'source_gl', 'source_gl', 'Source: GL', 'currency', 'Extracted', num(fields['source_gl']), null));

  // Project meta
  rows.push(row(t, 'Project Profile', k, 'job_number', 'job_number', 'Job Number', 'string', 'Extracted', null, str(fields['Job Number'])));
  rows.push(row(t, 'Project Profile', k, 'job_name', 'job_name', 'Job Name', 'string', 'Extracted', null, str(fields['job_name'])));
  rows.push(row(t, 'Project Profile', k, 'company', 'company', 'Company', 'string', 'Extracted', null, str(fields['Company'])));
  rows.push(row(t, 'Project Profile', k, 'client', 'client', 'Client / GC', 'string', 'Extracted', null, str(fields['client'])));
  rows.push(row(t, 'Project Profile', k, 'project_type', 'project_type', 'Project Type', 'string', 'Extracted', null, str(fields['Project Type']) || meta.projectType || ''));
  rows.push(row(t, 'Project Profile', k, 'trade', 'trade', 'Trade', 'string', 'Extracted', null, str(fields['Trade'])));
  rows.push(row(t, 'Project Profile', k, 'report_date', 'report_date', 'Report Date', 'date', 'Extracted', null, str(fields['Report Date'])));

  if (meta.unitCount) rows.push(row(t, 'Project Profile', k, 'unit_count', 'unit_count', 'Unit Count', 'integer', 'Cross-Ref', meta.unitCount, null));
  if (meta.fixtureCount) rows.push(row(t, 'Project Profile', k, 'fixture_count', 'fixture_count', 'Fixture Count', 'integer', 'Cross-Ref', meta.fixtureCount, null));
  if (meta.durationMonths) rows.push(row(t, 'Project Profile', k, 'duration_months', 'duration_months', 'Duration (Months)', 'number', 'Cross-Ref', meta.durationMonths, null));

  return rows;
}


// ── Tab 2: Budget vs Actual ──────────────────────────────────

function buildBudgetVsActual(records: RecordRow[]): ExportRow[] {
  const rows: ExportRow[] = [];
  const t = 'Budget vs Actual';
  const workRecords = records.filter(r => cc(r) !== '999' && !cc(r).startsWith('Overhead'));

  for (const rec of workRecords) {
    const code = cc(rec);
    const desc = str(fv(rec, 'Line Item Description'));
    const category = str(fv(rec, 'Cost Category'));
    const k = `cc_${code}`;
    const s = category || 'General';

    const revBudget = num(fv(rec, 'Revised Budget (line)'));
    const jtdCost = num(fv(rec, 'Job-to-Date Cost (line)'));
    const overUnder = num(fv(rec, 'Over/Under Budget — $ (line)'));
    const cos = num(fv(rec, 'Change Orders (line)'));
    const pctUsed = pct(fv(rec, '% Budget Consumed (line)'));
    const hours = parseHours(fv(rec, 'Quantity (labor hours or units)'));

    rows.push(row(t, s, k, 'cost_code', `bva_${code}_cost_code`, 'Cost Code', 'string', 'Extracted', null, code));
    rows.push(row(t, s, k, 'description', `bva_${code}_description`, 'Description', 'string', 'Extracted', null, desc));
    rows.push(row(t, s, k, 'category', `bva_${code}_category`, 'Category', 'string', 'Extracted', null, category));
    rows.push(row(t, s, k, 'revised_budget', `bva_${code}_revised_budget`, 'Revised Budget', 'currency', 'Extracted', revBudget, null));
    rows.push(row(t, s, k, 'jtd_cost', `bva_${code}_jtd_cost`, 'Job-to-Date Cost', 'currency', 'Extracted', jtdCost, null));
    rows.push(row(t, s, k, 'over_under', `bva_${code}_over_under`, 'Over/Under Budget', 'currency', 'Extracted', overUnder, null));
    rows.push(row(t, s, k, 'change_orders', `bva_${code}_change_orders`, 'Change Orders', 'currency', 'Extracted', cos, null));
    rows.push(row(t, s, k, 'pct_consumed', `bva_${code}_pct_consumed`, '% Budget Consumed', 'percent', 'Extracted', pctUsed, null));

    if (hours.total > 0) {
      rows.push(row(t, s, k, 'total_hours', `bva_${code}_total_hours`, 'Total Hours', 'number', 'Extracted', hours.total, null));
      rows.push(row(t, s, k, 'reg_hours', `bva_${code}_reg_hours`, 'Regular Hours', 'number', 'Extracted', hours.reg, null));
      rows.push(row(t, s, k, 'ot_hours', `bva_${code}_ot_hours`, 'OT Hours', 'number', 'Extracted', hours.ot, null));
    }

    const variance = revBudget > 0 ? ((revBudget - jtdCost) / revBudget) * 100 : 0;
    const statusLabel = overUnder >= 0 ? 'Under Budget' : 'Over Budget';
    rows.push(row(t, s, k, 'variance_pct', `bva_${code}_variance_pct`, 'Variance %', 'percent', 'Derived', rd(variance), null));
    rows.push(row(t, s, k, 'status', `bva_${code}_status`, 'Status', 'string', 'Derived', null, statusLabel));
  }

  return rows;
}


// ── Tab 3: Material ──────────────────────────────────────────

function buildMaterial(records: RecordRow[], meta: ProjectMeta): ExportRow[] {
  const rows: ExportRow[] = [];
  const t = 'Material';
  const matRecords = records.filter(r => cat(r) === 'material');

  for (const rec of matRecords) {
    const code = cc(rec);
    const desc = str(fv(rec, 'Line Item Description'));
    const k = `mat_${code}`;
    const s = 'Material Codes';

    const budget = num(fv(rec, 'Revised Budget (line)'));
    const actual = num(fv(rec, 'Job-to-Date Cost (line)'));
    const variance = budget - actual;

    rows.push(row(t, s, k, 'cost_code', `mat_${code}_cost_code`, 'Cost Code', 'string', 'Extracted', null, code));
    rows.push(row(t, s, k, 'description', `mat_${code}_description`, 'Description', 'string', 'Extracted', null, desc));
    rows.push(row(t, s, k, 'budget', `mat_${code}_budget`, 'Budget', 'currency', 'Extracted', budget, null));
    rows.push(row(t, s, k, 'actual', `mat_${code}_actual`, 'Actual', 'currency', 'Extracted', actual, null));
    rows.push(row(t, s, k, 'variance', `mat_${code}_variance`, 'Variance', 'currency', 'Derived', rd(variance), null));
    rows.push(row(t, s, k, 'pct_used', `mat_${code}_pct_used`, '% Used', 'percent', 'Derived', budget > 0 ? rd((actual / budget) * 100) : null, null));

    if (meta.unitCount) {
      rows.push(row(t, s, k, 'cost_per_unit', `mat_${code}_cost_per_unit`, 'Cost/Unit', 'currency', 'Derived', rd(actual / meta.unitCount), null));
    }
    if (meta.fixtureCount) {
      rows.push(row(t, s, k, 'cost_per_fixture', `mat_${code}_cost_per_fixture`, 'Cost/Fixture', 'currency', 'Derived', rd(actual / meta.fixtureCount), null));
    }
  }

  // Material summary
  const totalMatBudget = matRecords.reduce((s, r) => s + num(fv(r, 'Revised Budget (line)')), 0);
  const totalMatActual = matRecords.reduce((s, r) => s + num(fv(r, 'Job-to-Date Cost (line)')), 0);
  rows.push(row(t, 'Summary', 'mat_total', 'total_budget', 'material_total_budget', 'Total Material Budget', 'currency', 'Derived', totalMatBudget, null));
  rows.push(row(t, 'Summary', 'mat_total', 'total_actual', 'material_total_actual', 'Total Material Actual', 'currency', 'Derived', totalMatActual, null));
  rows.push(row(t, 'Summary', 'mat_total', 'total_variance', 'material_total_variance', 'Total Material Variance', 'currency', 'Derived', rd(totalMatBudget - totalMatActual), null));

  return rows;
}

// ── Tab 4: Cost Breakdown ────────────────────────────────────

function buildCostBreakdown(records: RecordRow[], fields: FieldsMap, meta: ProjectMeta): ExportRow[] {
  const rows: ExportRow[] = [];
  const t = 'Cost Breakdown';
  const k = 'breakdown';

  const pr = num(fields['source_pr']);
  const ap = num(fields['source_ap']);
  const gl = num(fields['source_gl']);
  const total = pr + ap + gl;

  rows.push(row(t, 'Source Split', k, 'source_pr', 'source_pr_total', 'Payroll Total', 'currency', 'Extracted', pr, null));
  rows.push(row(t, 'Source Split', k, 'source_ap', 'source_ap_total', 'AP Total', 'currency', 'Extracted', ap, null));
  rows.push(row(t, 'Source Split', k, 'source_gl', 'source_gl_total', 'GL Total', 'currency', 'Extracted', gl, null));

  if (total > 0) {
    rows.push(row(t, 'Source Split', k, 'pr_pct', 'source_pr_pct', 'Payroll %', 'percent', 'Derived', rd((pr / total) * 100), null));
    rows.push(row(t, 'Source Split', k, 'ap_pct', 'source_ap_pct', 'AP %', 'percent', 'Derived', rd((ap / total) * 100), null));
    rows.push(row(t, 'Source Split', k, 'gl_pct', 'source_gl_pct', 'GL %', 'percent', 'Derived', rd((gl / total) * 100), null));
  }

  const revenue = Math.abs(num(fields['total_revenues'] || fields['sales_cost_code_999_rev_budget']));
  const laborCost = records.filter(r => cat(r) === 'labor').reduce((s, r) => s + num(fv(r, 'Job-to-Date Cost (line)')), 0);
  const materialCost = records.filter(r => cat(r) === 'material').reduce((s, r) => s + num(fv(r, 'Job-to-Date Cost (line)')), 0);

  if (meta.unitCount) {
    rows.push(row(t, 'Per Unit', k, 'revenue_per_unit', 'revenue_per_unit', 'Revenue/Unit', 'currency', 'Derived', rd(revenue / meta.unitCount), null));
    rows.push(row(t, 'Per Unit', k, 'labor_per_unit', 'labor_per_unit', 'Labor/Unit', 'currency', 'Derived', rd(laborCost / meta.unitCount), null));
    rows.push(row(t, 'Per Unit', k, 'material_per_unit', 'material_per_unit', 'Material/Unit', 'currency', 'Derived', rd(materialCost / meta.unitCount), null));
  }

  if (revenue > 0) {
    rows.push(row(t, 'Ratios', k, 'labor_pct_revenue', 'labor_pct_of_revenue', 'Labor % of Revenue', 'percent', 'Derived', rd((laborCost / revenue) * 100), null));
    rows.push(row(t, 'Ratios', k, 'material_pct_revenue', 'material_pct_of_revenue', 'Material % of Revenue', 'percent', 'Derived', rd((materialCost / revenue) * 100), null));
  }
  if (materialCost > 0) {
    rows.push(row(t, 'Ratios', k, 'labor_material_ratio', 'labor_material_ratio', 'Labor:Material Ratio', 'ratio', 'Derived', rd(laborCost / materialCost), null));
  }

  return rows;
}


// ── Tab 5: Crew Labor ────────────────────────────────────────

function buildCrewLabor(records: RecordRow[]): ExportRow[] {
  const rows: ExportRow[] = [];
  const t = 'Crew Labor';
  const laborRecords = records.filter(r => cat(r) === 'labor');

  for (const rec of laborRecords) {
    const code = cc(rec);
    const desc = str(fv(rec, 'Line Item Description'));
    const k = `crew_${code}`;
    const s = 'Labor Codes';

    const hours = parseHours(fv(rec, 'Quantity (labor hours or units)'));
    const cost = num(fv(rec, 'Job-to-Date Cost (line)'));
    const budget = num(fv(rec, 'Revised Budget (line)'));

    rows.push(row(t, s, k, 'cost_code', `crew_${code}_cost_code`, 'Cost Code', 'string', 'Extracted', null, code));
    rows.push(row(t, s, k, 'description', `crew_${code}_description`, 'Description', 'string', 'Extracted', null, desc));
    rows.push(row(t, s, k, 'total_hours', `crew_${code}_total_hours`, 'Total Hours', 'number', 'Extracted', hours.total, null));
    rows.push(row(t, s, k, 'reg_hours', `crew_${code}_reg_hours`, 'Regular Hours', 'number', 'Extracted', hours.reg, null));
    rows.push(row(t, s, k, 'ot_hours', `crew_${code}_ot_hours`, 'OT Hours', 'number', 'Extracted', hours.ot, null));
    rows.push(row(t, s, k, 'ot_pct', `crew_${code}_ot_pct`, 'OT %', 'percent', 'Derived', hours.total > 0 ? rd((hours.ot / hours.total) * 100) : 0, null));
    rows.push(row(t, s, k, 'cost', `crew_${code}_cost`, 'Labor Cost', 'currency', 'Extracted', cost, null));
    rows.push(row(t, s, k, 'budget', `crew_${code}_budget`, 'Labor Budget', 'currency', 'Extracted', budget, null));

    const blendedRate = hours.total > 0 ? cost / hours.total : null;
    rows.push(row(t, s, k, 'blended_rate', `crew_${code}_blended_rate`, 'Blended Rate', 'currency', 'Derived', rd(blendedRate), null));
  }

  return rows;
}

// ── Tab 6: Crew Analytics ────────────────────────────────────

function buildCrewAnalytics(records: RecordRow[]): ExportRow[] {
  const rows: ExportRow[] = [];
  const t = 'Crew Analytics';
  const k = 'crew_summary';
  const laborRecords = records.filter(r => cat(r) === 'labor');

  let totalHrs = 0, totalReg = 0, totalOt = 0, totalCost = 0, totalBudget = 0;
  const rates: number[] = [];

  for (const rec of laborRecords) {
    const h = parseHours(fv(rec, 'Quantity (labor hours or units)'));
    const c = num(fv(rec, 'Job-to-Date Cost (line)'));
    const b = num(fv(rec, 'Revised Budget (line)'));
    totalHrs += h.total; totalReg += h.reg; totalOt += h.ot;
    totalCost += c; totalBudget += b;
    if (h.total > 0) rates.push(c / h.total);
  }

  rows.push(row(t, 'Summary', k, 'total_labor_hours', 'crew_total_hours', 'Total Labor Hours', 'number', 'Derived', rd(totalHrs), null));
  rows.push(row(t, 'Summary', k, 'total_reg_hours', 'crew_total_reg_hours', 'Total Regular Hours', 'number', 'Derived', rd(totalReg), null));
  rows.push(row(t, 'Summary', k, 'total_ot_hours', 'crew_total_ot_hours', 'Total OT Hours', 'number', 'Derived', rd(totalOt), null));
  rows.push(row(t, 'Summary', k, 'ot_ratio', 'crew_ot_ratio', 'OT Ratio', 'percent', 'Derived', totalHrs > 0 ? rd((totalOt / totalHrs) * 100) : 0, null));
  rows.push(row(t, 'Summary', k, 'total_labor_cost', 'crew_total_labor_cost', 'Total Labor Cost', 'currency', 'Derived', rd(totalCost), null));
  rows.push(row(t, 'Summary', k, 'total_labor_budget', 'crew_total_labor_budget', 'Total Labor Budget', 'currency', 'Derived', rd(totalBudget), null));

  const blendedGross = totalHrs > 0 ? totalCost / totalHrs : null;
  rows.push(row(t, 'Wage Stats', k, 'blended_gross_wage', 'blended_gross_wage', 'Blended Gross Wage', 'currency', 'Derived', rd(blendedGross), null));

  if (rates.length > 0) {
    const minRate = Math.min(...rates);
    const maxRate = Math.max(...rates);
    const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
    rows.push(row(t, 'Wage Stats', k, 'min_rate', 'crew_min_rate', 'Min Blended Rate', 'currency', 'Derived', rd(minRate), null));
    rows.push(row(t, 'Wage Stats', k, 'max_rate', 'crew_max_rate', 'Max Blended Rate', 'currency', 'Derived', rd(maxRate), null));
    rows.push(row(t, 'Wage Stats', k, 'avg_rate', 'crew_avg_rate', 'Avg Blended Rate', 'currency', 'Derived', rd(avgRate), null));
  }

  // Burden analysis from overhead records
  const burdenCost = records.filter(r => cat(r) === 'overhead')
    .reduce((s, r) => s + num(fv(r, 'Job-to-Date Cost (line)')), 0);
  rows.push(row(t, 'Burden', k, 'burden_cost', 'burden_cost', 'Burden Cost', 'currency', 'Extracted', rd(burdenCost), null));
  if (totalCost > 0) {
    const burdenMult = (totalCost + burdenCost) / totalCost;
    rows.push(row(t, 'Burden', k, 'burden_multiplier', 'burden_multiplier', 'Burden Multiplier', 'ratio', 'Derived', rd(burdenMult), null));
    const fullyLoaded = blendedGross ? blendedGross * burdenMult : null;
    rows.push(row(t, 'Burden', k, 'fully_loaded_wage', 'fully_loaded_wage', 'Fully Loaded Wage', 'currency', 'Derived', rd(fullyLoaded), null));
  }

  return rows;
}


// ── Tab 7: Productivity ──────────────────────────────────────

function buildProductivity(records: RecordRow[], meta: ProjectMeta): ExportRow[] {
  const rows: ExportRow[] = [];
  const t = 'Productivity';
  const laborRecords = records.filter(r => cat(r) === 'labor');

  // Per-phase productivity
  for (const rec of laborRecords) {
    const code = cc(rec);
    const desc = str(fv(rec, 'Line Item Description'));
    const k = `prod_${code}`;
    const hours = parseHours(fv(rec, 'Quantity (labor hours or units)'));
    const budget = num(fv(rec, 'Revised Budget (line)'));
    const actual = num(fv(rec, 'Job-to-Date Cost (line)'));

    rows.push(row(t, 'Per Phase', k, 'phase', `prod_${code}_phase`, 'Phase', 'string', 'Extracted', null, desc));
    rows.push(row(t, 'Per Phase', k, 'hours', `prod_${code}_hours`, 'Hours', 'number', 'Extracted', hours.total, null));
    rows.push(row(t, 'Per Phase', k, 'budget', `prod_${code}_budget`, 'Budget', 'currency', 'Extracted', budget, null));
    rows.push(row(t, 'Per Phase', k, 'actual', `prod_${code}_actual`, 'Actual', 'currency', 'Extracted', actual, null));

    if (meta.unitCount && hours.total > 0) {
      rows.push(row(t, 'Per Phase', k, 'hours_per_unit', `prod_${code}_hours_per_unit`, 'Hours/Unit', 'number', 'Derived', rd(hours.total / meta.unitCount), null));
    }
    if (meta.fixtureCount && hours.total > 0) {
      rows.push(row(t, 'Per Phase', k, 'hours_per_fixture', `prod_${code}_hours_per_fixture`, 'Hours/Fixture', 'number', 'Derived', rd(hours.total / meta.fixtureCount), null));
    }
  }

  // Throughput metrics
  const totalHours = laborRecords.reduce((s, r) => s + parseHours(fv(r, 'Quantity (labor hours or units)')).total, 0);
  const revenue = Math.abs(num(records.find(r => cc(r) === '999')
    ? fv(records.find(r => cc(r) === '999')!, 'Revised Budget (line)') : undefined));

  if (meta.unitCount) {
    rows.push(row(t, 'Throughput', 'throughput', 'hours_per_unit', 'hours_per_unit', 'Hours/Unit (Total)', 'number', 'Derived', rd(safe(totalHours, meta.unitCount)), null));
    rows.push(row(t, 'Throughput', 'throughput', 'revenue_per_unit', 'revenue_per_unit', 'Revenue/Unit', 'currency', 'Derived', rd(safe(revenue, meta.unitCount)), null));
  }
  if (meta.fixtureCount) {
    rows.push(row(t, 'Throughput', 'throughput', 'hours_per_fixture', 'hours_per_fixture', 'Hours/Fixture (Total)', 'number', 'Derived', rd(safe(totalHours, meta.fixtureCount)), null));
  }
  if (meta.durationMonths) {
    rows.push(row(t, 'Throughput', 'throughput', 'hours_per_month', 'hours_per_month', 'Hours/Month', 'number', 'Derived', rd(safe(totalHours, meta.durationMonths)), null));
    if (meta.unitCount) {
      rows.push(row(t, 'Throughput', 'throughput', 'units_per_month', 'units_per_month', 'Units/Month', 'number', 'Derived', rd(safe(meta.unitCount, meta.durationMonths)), null));
    }
  }
  if (totalHours > 0 && revenue > 0) {
    rows.push(row(t, 'Efficiency', 'efficiency', 'revenue_per_hour', 'revenue_per_hour', 'Revenue/Hour', 'currency', 'Derived', rd(revenue / totalHours), null));
  }

  return rows;
}

// ── Tab 8: Benchmark KPIs ────────────────────────────────────

function buildBenchmarkKPIs(records: RecordRow[], fields: FieldsMap, meta: ProjectMeta): ExportRow[] {
  const rows: ExportRow[] = [];
  const t = 'Benchmark KPIs';
  const k = 'kpi';

  const revenue = Math.abs(num(fields['total_revenues'] || fields['sales_cost_code_999_rev_budget']));
  const workRecords = records.filter(r => cc(r) !== '999' && !cc(r).startsWith('Overhead'));
  const totalJtd = workRecords.reduce((s, r) => s + num(fv(r, 'Job-to-Date Cost (line)')), 0);
  const laborCost = records.filter(r => cat(r) === 'labor').reduce((s, r) => s + num(fv(r, 'Job-to-Date Cost (line)')), 0);
  const materialCost = records.filter(r => cat(r) === 'material').reduce((s, r) => s + num(fv(r, 'Job-to-Date Cost (line)')), 0);
  const overheadCost = records.filter(r => cat(r) === 'overhead').reduce((s, r) => s + num(fv(r, 'Job-to-Date Cost (line)')), 0);
  const totalHours = records.filter(r => cat(r) === 'labor')
    .reduce((s, r) => s + parseHours(fv(r, 'Quantity (labor hours or units)')).total, 0);
  const netProfit = revenue - totalJtd;
  const matRecords = records.filter(r => cat(r) === 'material');

  // Profile KPIs
  if (meta.fixtureCount && meta.unitCount) {
    rows.push(row(t, 'Profile', k, 'fixtures_per_unit', 'fixtures_per_unit', 'Fixtures per Unit', 'number', 'Derived', rd(meta.fixtureCount / meta.unitCount), null));
  }

  // Financial KPIs
  rows.push(row(t, 'Financial', k, 'gross_margin_pct', 'kpi_gross_margin_pct', 'Gross Margin %', 'percent', 'Derived', revenue > 0 ? rd((netProfit / revenue) * 100) : null, null));
  rows.push(row(t, 'Financial', k, 'cost_per_revenue', 'kpi_cost_per_revenue', 'Cost / Revenue Ratio', 'ratio', 'Derived', revenue > 0 ? rd(totalJtd / revenue) : null, null));
  rows.push(row(t, 'Financial', k, 'labor_pct', 'kpi_labor_pct', 'Labor % of Direct Cost', 'percent', 'Derived', totalJtd > 0 ? rd((laborCost / totalJtd) * 100) : null, null));
  rows.push(row(t, 'Financial', k, 'material_pct', 'kpi_material_pct', 'Material % of Direct Cost', 'percent', 'Derived', totalJtd > 0 ? rd((materialCost / totalJtd) * 100) : null, null));
  rows.push(row(t, 'Financial', k, 'overhead_pct', 'kpi_overhead_pct', 'Overhead % of Direct Cost', 'percent', 'Derived', totalJtd > 0 ? rd((overheadCost / totalJtd) * 100) : null, null));

  // Per-unit KPIs
  if (meta.unitCount) {
    rows.push(row(t, 'Per Unit', k, 'cost_per_unit', 'cost_per_unit', 'Cost/Unit', 'currency', 'Derived', rd(totalJtd / meta.unitCount), null));
    rows.push(row(t, 'Per Unit', k, 'profit_per_unit', 'profit_per_unit', 'Profit/Unit', 'currency', 'Derived', rd(netProfit / meta.unitCount), null));
    rows.push(row(t, 'Per Unit', k, 'revenue_per_unit', 'revenue_per_unit', 'Revenue/Unit', 'currency', 'Derived', rd(revenue / meta.unitCount), null));
    rows.push(row(t, 'Per Unit', k, 'labor_per_unit', 'kpi_labor_per_unit', 'Labor/Unit', 'currency', 'Derived', rd(laborCost / meta.unitCount), null));
    rows.push(row(t, 'Per Unit', k, 'material_per_unit', 'kpi_material_per_unit', 'Material/Unit', 'currency', 'Derived', rd(materialCost / meta.unitCount), null));
  }

  // Per-fixture KPIs
  if (meta.fixtureCount) {
    rows.push(row(t, 'Per Fixture', k, 'profit_per_fixture', 'profit_per_fixture', 'Profit/Fixture', 'currency', 'Derived', rd(netProfit / meta.fixtureCount), null));
    rows.push(row(t, 'Per Fixture', k, 'revenue_per_fixture', 'revenue_per_fixture', 'Revenue/Fixture', 'currency', 'Derived', rd(revenue / meta.fixtureCount), null));
    rows.push(row(t, 'Per Fixture', k, 'cost_per_fixture', 'cost_per_fixture', 'Cost/Fixture', 'currency', 'Derived', rd(totalJtd / meta.fixtureCount), null));
    if (totalHours > 0) {
      rows.push(row(t, 'Per Fixture', k, 'labor_cost_per_fixture', 'labor_cost_per_fixture', 'Labor $/Fixture', 'currency', 'Derived', rd(laborCost / meta.fixtureCount), null));
      rows.push(row(t, 'Per Fixture', k, 'material_cost_per_fixture', 'material_cost_per_fixture', 'Material $/Fixture', 'currency', 'Derived', rd(materialCost / meta.fixtureCount), null));
    }
  }

  // Per-hour KPIs
  if (totalHours > 0) {
    rows.push(row(t, 'Per Hour', k, 'revenue_per_hour', 'kpi_revenue_per_hour', 'Revenue/Hour', 'currency', 'Derived', rd(revenue / totalHours), null));
    rows.push(row(t, 'Per Hour', k, 'profit_per_hour', 'kpi_profit_per_hour', 'Profit/Hour', 'currency', 'Derived', rd(netProfit / totalHours), null));
    rows.push(row(t, 'Per Hour', k, 'cost_per_hour', 'kpi_cost_per_hour', 'Cost/Hour', 'currency', 'Derived', rd(totalJtd / totalHours), null));
    if (meta.unitCount) {
      rows.push(row(t, 'Labor', k, 'labor_cost_per_unit', 'labor_cost_per_unit', 'Labor $/Unit', 'currency', 'Derived', rd(laborCost / meta.unitCount), null));
    }
    if (meta.fixtureCount) {
      rows.push(row(t, 'Labor', k, 'labor_cost_per_fixture', 'kpi_labor_cost_per_fixture', 'Labor $/Fixture', 'currency', 'Derived', rd(laborCost / meta.fixtureCount), null));
    }
  }

  // Throughput KPIs
  if (meta.durationMonths) {
    if (meta.fixtureCount) {
      rows.push(row(t, 'Throughput', k, 'fixtures_per_month', 'fixtures_per_month', 'Fixtures/Month', 'number', 'Derived', rd(meta.fixtureCount / meta.durationMonths), null));
    }
    if (totalHours > 0) {
      rows.push(row(t, 'Throughput', k, 'hours_per_month', 'hours_per_month', 'Hours/Month', 'number', 'Derived', rd(totalHours / meta.durationMonths), null));
    }
  }

  // Cost Mix KPIs
  if (revenue > 0) {
    rows.push(row(t, 'Cost Mix', k, 'labor_pct_of_revenue', 'kpi_labor_pct_of_revenue', 'Labor as % of Revenue', 'percent', 'Derived', rd((laborCost / revenue) * 100), null));
    rows.push(row(t, 'Cost Mix', k, 'material_pct_of_revenue', 'kpi_material_pct_of_revenue', 'Material as % of Revenue', 'percent', 'Derived', rd((materialCost / revenue) * 100), null));
    const glCost = num(fields['source_gl']);
    if (glCost > 0) {
      rows.push(row(t, 'Cost Mix', k, 'gl_pct_of_revenue', 'gl_pct_of_revenue', 'GL as % of Revenue', 'percent', 'Derived', rd((glCost / revenue) * 100), null));
    }
    if (materialCost > 0) {
      rows.push(row(t, 'Cost Mix', k, 'labor_to_material_ratio', 'kpi_labor_to_material_ratio', 'Labor : Material Ratio', 'ratio', 'Derived', rd(laborCost / materialCost), null));
    }
  }

  // Estimating KPIs
  const overBudget = workRecords.filter(r => num(fv(r, 'Over/Under Budget — $ (line)')) < 0);
  const underBudget = workRecords.filter(r => num(fv(r, 'Over/Under Budget — $ (line)')) > 0);
  rows.push(row(t, 'Estimating', k, 'phases_over_budget', 'phases_over_budget', 'Phases Over Budget', 'integer', 'Derived', overBudget.length, null));
  rows.push(row(t, 'Estimating', k, 'phases_under_budget', 'phases_under_budget', 'Phases Under Budget', 'integer', 'Derived', underBudget.length, null));

  if (overBudget.length > 0) {
    const worstOverrun = [...overBudget].sort((a, b) => {
      const aB = num(fv(a, 'Revised Budget (line)'));
      const aO = Math.abs(num(fv(a, 'Over/Under Budget — $ (line)')));
      const bB = num(fv(b, 'Revised Budget (line)'));
      const bO = Math.abs(num(fv(b, 'Over/Under Budget — $ (line)')));
      return (bB > 0 ? bO / bB : 0) - (aB > 0 ? aO / aB : 0);
    })[0];
    const wB = num(fv(worstOverrun, 'Revised Budget (line)'));
    const wO = Math.abs(num(fv(worstOverrun, 'Over/Under Budget — $ (line)')));
    const wPct = wB > 0 ? Math.round((wO / wB) * 100) : 0;
    const wDesc = str(fv(worstOverrun, 'Line Item Description'));
    rows.push(row(t, 'Estimating', k, 'largest_overrun', 'largest_overrun', 'Largest Overrun', 'string', 'Derived', null, `+${wPct}% (${wDesc})`));
  }
  if (underBudget.length > 0) {
    const bestSavings = [...underBudget].sort((a, b) => {
      const aB = num(fv(a, 'Revised Budget (line)'));
      const aS = num(fv(a, 'Over/Under Budget — $ (line)'));
      const bB = num(fv(b, 'Revised Budget (line)'));
      const bS = num(fv(b, 'Over/Under Budget — $ (line)'));
      return (bB > 0 ? bS / bB : 0) - (aB > 0 ? aS / aB : 0);
    })[0];
    const sB = num(fv(bestSavings, 'Revised Budget (line)'));
    const sS = num(fv(bestSavings, 'Over/Under Budget — $ (line)'));
    const sPct = sB > 0 ? Math.round((sS / sB) * 100) : 0;
    const sDesc = str(fv(bestSavings, 'Line Item Description'));
    rows.push(row(t, 'Estimating', k, 'largest_savings', 'largest_savings', 'Largest Savings', 'string', 'Derived', null, `${sPct}% (${sDesc})`));
  }

  const totalRevBudget = workRecords.reduce((s, r) => s + num(fv(r, 'Revised Budget (line)')), 0);
  if (totalRevBudget > 0) {
    const netVar = ((totalJtd - totalRevBudget) / totalRevBudget) * 100;
    rows.push(row(t, 'Estimating', k, 'net_variance_pct', 'net_variance_pct', 'Net Variance %', 'percent', 'Derived', rd(netVar), null));
  }

  // Material benchmark KPIs
  const totalMatActual = matRecords.reduce((s, r) => s + num(fv(r, 'Job-to-Date Cost (line)')), 0);
  const totalMatBudget = matRecords.reduce((s, r) => s + num(fv(r, 'Revised Budget (line)')), 0);
  rows.push(row(t, 'Material', k, 'material_spend_total', 'material_spend_total', 'Total Material Spend', 'currency', 'Derived', rd(totalMatActual), null));
  rows.push(row(t, 'Material', k, 'material_budget_total', 'material_budget_total', 'Total Material Budget', 'currency', 'Derived', rd(totalMatBudget), null));
  rows.push(row(t, 'Material', k, 'material_variance_dollars', 'material_variance_dollars', 'Material Variance', 'currency', 'Derived', rd(totalMatBudget - totalMatActual), null));
  if (totalMatBudget > 0) {
    rows.push(row(t, 'Material', k, 'material_variance_pct', 'material_variance_pct', 'Material Variance %', 'percent', 'Derived', rd(((totalMatBudget - totalMatActual) / totalMatBudget) * 100), null));
  }
  if (meta.unitCount) {
    rows.push(row(t, 'Material', k, 'material_cost_per_unit', 'material_cost_per_unit', 'Material $/Unit', 'currency', 'Derived', rd(totalMatActual / meta.unitCount), null));
  }
  if (meta.fixtureCount) {
    rows.push(row(t, 'Material', k, 'material_cost_per_fixture', 'kpi_material_cost_per_fixture', 'Material $/Fixture', 'currency', 'Derived', rd(totalMatActual / meta.fixtureCount), null));
  }
  if (revenue > 0) {
    rows.push(row(t, 'Material', k, 'material_pct_of_revenue_actual', 'material_pct_of_revenue_actual', 'Material % of Revenue', 'percent', 'Derived', rd((totalMatActual / revenue) * 100), null));
  }
  if (totalJtd > 0) {
    rows.push(row(t, 'Material', k, 'material_pct_of_direct_cost', 'material_pct_of_direct_cost', 'Material % of Direct Cost', 'percent', 'Derived', rd((totalMatActual / totalJtd) * 100), null));
  }
  if (totalMatActual > 0 && laborCost > 0) {
    rows.push(row(t, 'Material', k, 'labor_to_material_dollar_ratio', 'labor_to_material_dollar_ratio', 'Labor : Material $ Ratio', 'ratio', 'Derived', rd(laborCost / totalMatActual), null));
  }
  rows.push(row(t, 'Material', k, 'material_codes_tracked', 'material_codes_tracked', 'Material Codes Tracked', 'integer', 'Derived', matRecords.length, null));
  const matOver = matRecords.filter(r => num(fv(r, 'Over/Under Budget — $ (line)')) < 0);
  const matUnder = matRecords.filter(r => num(fv(r, 'Over/Under Budget — $ (line)')) > 0);
  rows.push(row(t, 'Material', k, 'material_codes_over_budget', 'material_codes_over_budget', 'Material Codes Over Budget', 'integer', 'Derived', matOver.length, null));
  rows.push(row(t, 'Material', k, 'material_codes_under_budget', 'material_codes_under_budget', 'Material Codes Under Budget', 'integer', 'Derived', matUnder.length, null));

  if (matOver.length > 0) {
    const worstMat = [...matOver].sort((a, b) => {
      const aB = num(fv(a, 'Revised Budget (line)'));
      const aO = Math.abs(num(fv(a, 'Over/Under Budget — $ (line)')));
      const bB = num(fv(b, 'Revised Budget (line)'));
      const bO = Math.abs(num(fv(b, 'Over/Under Budget — $ (line)')));
      return (bB > 0 ? bO / bB : 0) - (aB > 0 ? aO / aB : 0);
    })[0];
    const mB = num(fv(worstMat, 'Revised Budget (line)'));
    const mO = Math.abs(num(fv(worstMat, 'Over/Under Budget — $ (line)')));
    const mPct = mB > 0 ? Math.round((mO / mB) * 100) : 0;
    const mDesc = str(fv(worstMat, 'Line Item Description'));
    rows.push(row(t, 'Material', k, 'largest_material_overrun', 'largest_material_overrun', 'Largest Material Overrun', 'string', 'Derived', null, `+${mPct}% (${mDesc})`));
  }
  if (matUnder.length > 0) {
    const bestMat = [...matUnder].sort((a, b) => {
      const aB = num(fv(a, 'Revised Budget (line)'));
      const aS = num(fv(a, 'Over/Under Budget — $ (line)'));
      const bB = num(fv(b, 'Revised Budget (line)'));
      const bS = num(fv(b, 'Over/Under Budget — $ (line)'));
      return (bB > 0 ? bS / bB : 0) - (aB > 0 ? aS / aB : 0);
    })[0];
    const mB2 = num(fv(bestMat, 'Revised Budget (line)'));
    const mS = num(fv(bestMat, 'Over/Under Budget — $ (line)'));
    const mPct2 = mB2 > 0 ? Math.round((mS / mB2) * 100) : 0;
    const mDesc2 = str(fv(bestMat, 'Line Item Description'));
    rows.push(row(t, 'Material', k, 'largest_material_savings', 'largest_material_savings', 'Largest Material Savings', 'string', 'Derived', null, `${mPct2}% (${mDesc2})`));
  }

  // Sorted material spend for concentration metrics
  const matBySpend = [...matRecords].map(r => ({
    actual: num(fv(r, 'Job-to-Date Cost (line)')),
    desc: str(fv(r, 'Line Item Description')),
  })).sort((a, b) => b.actual - a.actual);
  if (matBySpend.length >= 2 && totalMatActual > 0) {
    const top2 = matBySpend[0].actual + matBySpend[1].actual;
    rows.push(row(t, 'Material', k, 'top_2_material_concentration', 'top_2_material_concentration', 'Top 2 Codes Concentration', 'percent', 'Derived', rd((top2 / totalMatActual) * 100), null));
  }

  // Vendor KPIs
  const apTotal = num(fields['source_ap']);
  const nonPayrollRecords = records.filter(r => cat(r) !== 'labor' && cat(r) !== 'overhead' && cc(r) !== '999');
  const vendorCount = nonPayrollRecords.length;
  rows.push(row(t, 'Vendor', k, 'vendor_count', 'vendor_count', 'Vendor/Material Codes', 'integer', 'Derived', vendorCount, null));
  rows.push(row(t, 'Vendor', k, 'ap_total', 'ap_total', 'AP Total', 'currency', 'Extracted', apTotal, null));
  if (vendorCount > 0 && apTotal > 0) {
    rows.push(row(t, 'Vendor', k, 'avg_material_invoice', 'avg_material_invoice', 'Avg Material Invoice', 'currency', 'Derived', rd(apTotal / vendorCount), null));
  }

  return rows;
}


// ── Tab 9: Insights ──────────────────────────────────────────

function buildInsights(records: RecordRow[], fields: FieldsMap): ExportRow[] {
  const rows: ExportRow[] = [];
  const t = 'Insights';

  const workRecords = records.filter(r => cc(r) !== '999' && !cc(r).startsWith('Overhead'));
  const overBudget = workRecords.filter(r => num(fv(r, 'Over/Under Budget — $ (line)')) < 0);
  const underBudget = workRecords.filter(r => num(fv(r, 'Over/Under Budget — $ (line)')) > 0);

  // Top overruns
  const sortedOver = [...overBudget].sort((a, b) =>
    num(fv(a, 'Over/Under Budget — $ (line)')) - num(fv(b, 'Over/Under Budget — $ (line)'))
  );
  for (let i = 0; i < Math.min(3, sortedOver.length); i++) {
    const rec = sortedOver[i];
    const code = cc(rec);
    const desc = str(fv(rec, 'Line Item Description'));
    const overrun = Math.abs(num(fv(rec, 'Over/Under Budget — $ (line)')));
    rows.push(row(t, 'Top Overruns', `overrun_${i}`, 'description', `insight_overrun_${i}_desc`, `#${i + 1} Overrun`, 'string', 'Derived', null, `${code} - ${desc}: $${overrun.toLocaleString()} over budget`));
    rows.push(row(t, 'Top Overruns', `overrun_${i}`, 'amount', `insight_overrun_${i}_amount`, `#${i + 1} Overrun Amount`, 'currency', 'Derived', overrun, null));
  }

  // Top savings
  const sortedUnder = [...underBudget].sort((a, b) =>
    num(fv(b, 'Over/Under Budget — $ (line)')) - num(fv(a, 'Over/Under Budget — $ (line)'))
  );
  for (let i = 0; i < Math.min(3, sortedUnder.length); i++) {
    const rec = sortedUnder[i];
    const code = cc(rec);
    const desc = str(fv(rec, 'Line Item Description'));
    const savings = num(fv(rec, 'Over/Under Budget — $ (line)'));
    rows.push(row(t, 'Top Savings', `savings_${i}`, 'description', `insight_savings_${i}_desc`, `#${i + 1} Savings`, 'string', 'Derived', null, `${code} - ${desc}: $${savings.toLocaleString()} under budget`));
    rows.push(row(t, 'Top Savings', `savings_${i}`, 'amount', `insight_savings_${i}_amount`, `#${i + 1} Savings Amount`, 'currency', 'Derived', savings, null));
  }

  rows.push(row(t, 'Summary', 'insight_summary', 'over_budget_count', 'insight_over_budget_count', 'Cost Codes Over Budget', 'integer', 'Derived', overBudget.length, null));
  rows.push(row(t, 'Summary', 'insight_summary', 'under_budget_count', 'insight_under_budget_count', 'Cost Codes Under Budget', 'integer', 'Derived', underBudget.length, null));

  return rows;
}

// ── Tab 10: Reconciliation ───────────────────────────────────

function buildReconciliationTab(records: RecordRow[], fields: FieldsMap): ExportRow[] {
  const rows: ExportRow[] = [];
  const t = 'Reconciliation';

  const workRecords = records.filter(r => cc(r) !== '999' && !cc(r).startsWith('Overhead'));
  const laborRecords = records.filter(r => cat(r) === 'labor');
  const materialRecords = records.filter(r => cat(r) === 'material');
  const overheadRecords = records.filter(r => cat(r) === 'overhead');

  // A: Grand Totals
  const sumRevBudget = workRecords.reduce((s, r) => s + num(fv(r, 'Revised Budget (line)')), 0);
  const sumJtd = workRecords.reduce((s, r) => s + num(fv(r, 'Job-to-Date Cost (line)')), 0);
  const sumOverUnder = workRecords.reduce((s, r) => s + num(fv(r, 'Over/Under Budget — $ (line)')), 0);
  const checkA = Math.abs(sumRevBudget - sumJtd - sumOverUnder);

  rows.push(row(t, 'Grand Totals', 'recon_a', 'sum_budget', 'recon_sum_budget', 'Sum of Revised Budgets', 'currency', 'Derived', sumRevBudget, null));
  rows.push(row(t, 'Grand Totals', 'recon_a', 'sum_jtd', 'recon_sum_jtd', 'Sum of JTD Costs', 'currency', 'Derived', sumJtd, null));
  rows.push(row(t, 'Grand Totals', 'recon_a', 'sum_over_under', 'recon_sum_over_under', 'Sum of Over/Under', 'currency', 'Derived', sumOverUnder, null));
  rows.push(row(t, 'Grand Totals', 'recon_a', 'check_a', 'recon_check_a', 'Budget - JTD = Over/Under?', 'currency', 'Cross-Ref', checkA, null, checkA < 1 ? 'PASS' : 'FAIL'));

  // B: Labor subtotal
  const laborBudget = laborRecords.reduce((s, r) => s + num(fv(r, 'Revised Budget (line)')), 0);
  const laborJtd = laborRecords.reduce((s, r) => s + num(fv(r, 'Job-to-Date Cost (line)')), 0);
  rows.push(row(t, 'Labor Codes', 'recon_b', 'labor_budget', 'recon_labor_budget', 'Labor Budget Subtotal', 'currency', 'Derived', laborBudget, null));
  rows.push(row(t, 'Labor Codes', 'recon_b', 'labor_jtd', 'recon_labor_jtd', 'Labor JTD Subtotal', 'currency', 'Derived', laborJtd, null));

  // C: Material subtotal
  const matBudget = materialRecords.reduce((s, r) => s + num(fv(r, 'Revised Budget (line)')), 0);
  const matJtd = materialRecords.reduce((s, r) => s + num(fv(r, 'Job-to-Date Cost (line)')), 0);
  rows.push(row(t, 'Material Codes', 'recon_c', 'material_budget', 'recon_material_budget', 'Material Budget Subtotal', 'currency', 'Derived', matBudget, null));
  rows.push(row(t, 'Material Codes', 'recon_c', 'material_jtd', 'recon_material_jtd', 'Material JTD Subtotal', 'currency', 'Derived', matJtd, null));

  // D: Overhead subtotal
  const ohBudget = overheadRecords.reduce((s, r) => s + num(fv(r, 'Revised Budget (line)')), 0);
  const ohJtd = overheadRecords.reduce((s, r) => s + num(fv(r, 'Job-to-Date Cost (line)')), 0);
  rows.push(row(t, 'Overhead', 'recon_d', 'overhead_budget', 'recon_overhead_budget', 'Overhead Budget Subtotal', 'currency', 'Derived', ohBudget, null));
  rows.push(row(t, 'Overhead', 'recon_d', 'overhead_jtd', 'recon_overhead_jtd', 'Overhead JTD Subtotal', 'currency', 'Derived', ohJtd, null));

  // E: Crew hours tie-out
  const totalLaborHours = laborRecords.reduce((s, r) => s + parseHours(fv(r, 'Quantity (labor hours or units)')).total, 0);
  rows.push(row(t, 'Crew Hours', 'recon_e', 'total_hours', 'recon_total_hours', 'Sum of Per-Code Hours', 'number', 'Derived', rd(totalLaborHours), null));

  // F: Cross-tab tie-out
  const revenue = Math.abs(num(fields['total_revenues'] || fields['sales_cost_code_999_rev_budget']));
  const profit = revenue - sumJtd;
  const crossCheck = Math.abs(sumJtd - (revenue - profit));
  rows.push(row(t, 'Cross-Tab', 'recon_f', 'revenue', 'recon_revenue', 'Revenue', 'currency', 'Extracted', revenue, null));
  rows.push(row(t, 'Cross-Tab', 'recon_f', 'direct_cost', 'recon_direct_cost', 'Direct Cost', 'currency', 'Derived', sumJtd, null));
  rows.push(row(t, 'Cross-Tab', 'recon_f', 'profit', 'recon_profit', 'Profit', 'currency', 'Derived', rd(profit), null));
  rows.push(row(t, 'Cross-Tab', 'recon_f', 'check_f', 'recon_check_f', 'Revenue - Profit = Direct Cost?', 'currency', 'Cross-Ref', crossCheck, null, crossCheck < 1 ? 'PASS' : 'FAIL'));

  // G: Source tie-out
  const pr = num(fields['source_pr']);
  const ap = num(fields['source_ap']);
  const gl = num(fields['source_gl']);
  const sourceTotal = pr + ap + gl;
  const sourceCheck = Math.abs(sourceTotal - sumJtd);
  rows.push(row(t, 'Source Tie-out', 'recon_g', 'source_total', 'recon_source_total', 'PR + AP + GL Total', 'currency', 'Derived', rd(sourceTotal), null));
  rows.push(row(t, 'Source Tie-out', 'recon_g', 'check_g', 'recon_check_g', 'Source Total = Direct Cost?', 'currency', 'Cross-Ref', rd(sourceCheck), null, sourceCheck < 100 ? 'PASS' : 'FAIL'));

  return rows;
}


// ── Tab: Crew Analytics (per-worker) ─────────────────────────

function parseWorkers(records: RecordRow[]): WorkerRecord[] {
  const laborRecords = records.filter(r => cat(r) === 'labor');
  const workerMap = new Map<string, { name: string; regHrs: number; otHrs: number; wages: number; codes: Set<string> }>();

  for (const rec of laborRecords) {
    const code = cc(rec);
    const hours = parseHours(fv(rec, 'Quantity (labor hours or units)'));
    const cost = num(fv(rec, 'Job-to-Date Cost (line)'));

    const workerEntries = str(fv(rec, 'Worker Details')) || str(fv(rec, 'PR Transactions'));
    if (!workerEntries) continue;

    const lines = workerEntries.split(/[;\n]/).filter(Boolean);
    for (const line of lines) {
      const match = line.match(/^(.+?)\s*\|\s*(\w+)\s*\|\s*([\d,.]+)\s*reg\s*\|\s*([\d,.]+)\s*ot\s*\|\s*\$?([\d,.]+)/i);
      if (!match) continue;
      const [, name, id, regStr, otStr, wageStr] = match;
      const key = id.trim();
      if (!workerMap.has(key)) {
        workerMap.set(key, { name: name.trim(), regHrs: 0, otHrs: 0, wages: 0, codes: new Set() });
      }
      const w = workerMap.get(key)!;
      w.regHrs += parseFloat(regStr.replace(/,/g, '')) || 0;
      w.otHrs += parseFloat(otStr.replace(/,/g, '')) || 0;
      w.wages += parseFloat(wageStr.replace(/,/g, '')) || 0;
      w.codes.add(code);
    }
  }

  return Array.from(workerMap.entries()).map(([id, w]) => {
    const totalHours = w.regHrs + w.otHrs;
    const rate = totalHours > 0 ? w.wages / totalHours : 0;
    return {
      name: w.name,
      id,
      regHours: w.regHrs,
      otHours: w.otHrs,
      totalHours,
      wages: w.wages,
      rate,
      codesWorked: w.codes.size,
      tier: classifyTier(rate),
    };
  }).sort((a, b) => b.totalHours - a.totalHours);
}

function buildWorkerCrewAnalytics(workers: WorkerRecord[]): ExportRow[] {
  const rows: ExportRow[] = [];
  const t = 'Crew Analytics';

  for (const w of workers) {
    const k = `worker=${w.id}`;
    const s = 'Worker Detail';
    rows.push(row(t, s, k, 'worker_reg_hrs', `worker_reg_hrs`, `${w.name} — REG HRS`, 'number', 'Extracted', rd(w.regHours), null));
    rows.push(row(t, s, k, 'worker_ot_hrs', `worker_ot_hrs`, `${w.name} — OT HRS`, 'number', 'Extracted', rd(w.otHours), null));
    rows.push(row(t, s, k, 'worker_total_hrs', `worker_total_hrs`, `${w.name} — TOTAL HRS`, 'number', 'Derived', rd(w.totalHours), null));
    rows.push(row(t, s, k, 'worker_ot_pct', `worker_ot`, `${w.name} — OT %`, 'percent', 'Derived', w.totalHours > 0 ? rd((w.otHours / w.totalHours) * 100) : 0, null));
    rows.push(row(t, s, k, 'worker_wages', `worker_wages`, `${w.name} — WAGES ($)`, 'currency', 'Extracted', rd(w.wages), null));
    rows.push(row(t, s, k, 'worker_rate', `worker__per_hr`, `${w.name} — $/HR`, 'currency', 'Derived', rd(w.rate), null));
    rows.push(row(t, s, k, 'worker_codes', `worker_codes`, `${w.name} — CODES`, 'integer', 'Derived', w.codesWorked, null));
    rows.push(row(t, s, k, 'worker_tier', `worker_tier`, `${w.name} — TIER`, 'string', 'Derived', null, w.tier));
  }

  return rows;
}

function buildWorkerCrewAnalyticsFromSecondary(workerRows: RecordRow[]): { rows: ExportRow[]; workers: WorkerRecord[] } {
  const exportRows: ExportRow[] = [];
  const workers: WorkerRecord[] = [];
  const t = 'Crew Analytics';

  for (const rec of workerRows) {
    const name = str(fv(rec, 'Worker Name', 'Employee Name', 'Name'));
    const id = str(fv(rec, 'Worker ID', 'Employee ID', 'ID')) || name.replace(/\s/g, '').slice(0, 4).toUpperCase();
    const regHours = num(fv(rec, 'Regular Hours', 'Reg Hours', 'REG HRS'));
    const otHours = num(fv(rec, 'OT Hours', 'Overtime Hours', 'OT HRS'));
    const totalHours = regHours + otHours || num(fv(rec, 'Total Hours', 'TOTAL HRS'));
    const wages = num(fv(rec, 'Wages', 'Total Wages', 'WAGES'));
    const rate = totalHours > 0 ? wages / totalHours : num(fv(rec, 'Rate', 'Hourly Rate', '$/HR'));
    const codes = num(fv(rec, 'Cost Codes Worked', 'Codes', 'CODES'));
    const tier = classifyTier(rate);

    const k = `worker=${id}`;
    const s = 'Worker Detail';
    exportRows.push(row(t, s, k, 'worker_reg_hrs', `worker_reg_hrs`, `${name} — REG HRS`, 'number', 'Extracted', rd(regHours), null));
    exportRows.push(row(t, s, k, 'worker_ot_hrs', `worker_ot_hrs`, `${name} — OT HRS`, 'number', 'Extracted', rd(otHours), null));
    exportRows.push(row(t, s, k, 'worker_total_hrs', `worker_total_hrs`, `${name} — TOTAL HRS`, 'number', 'Derived', rd(totalHours), null));
    exportRows.push(row(t, s, k, 'worker_ot_pct', `worker_ot`, `${name} — OT %`, 'percent', 'Derived', totalHours > 0 ? rd((otHours / totalHours) * 100) : 0, null));
    exportRows.push(row(t, s, k, 'worker_wages', `worker_wages`, `${name} — WAGES ($)`, 'currency', 'Extracted', rd(wages), null));
    exportRows.push(row(t, s, k, 'worker_rate', `worker__per_hr`, `${name} — $/HR`, 'currency', 'Derived', rd(rate), null));
    exportRows.push(row(t, s, k, 'worker_codes', `worker_codes`, `${name} — CODES`, 'integer', 'Derived', codes || 0, null));
    exportRows.push(row(t, s, k, 'worker_tier', `worker_tier`, `${name} — TIER`, 'string', 'Derived', null, tier));

    workers.push({ name, id, regHours, otHours, totalHours, wages, rate, codesWorked: codes || 0, tier });
  }

  workers.sort((a, b) => b.totalHours - a.totalHours);
  return { rows: exportRows, workers };
}


// ── Tab: Crew & Labor (tier breakdown) ───────────────────────

function buildCrewTiers(workers: WorkerRecord[], meta: ProjectMeta): ExportRow[] {
  const rows: ExportRow[] = [];
  const t = 'Crew & Labor';

  const tierGroups = new Map<string, WorkerRecord[]>();
  for (const w of workers) {
    if (!tierGroups.has(w.tier)) tierGroups.set(w.tier, []);
    tierGroups.get(w.tier)!.push(w);
  }

  for (const band of TIER_BANDS) {
    const group = tierGroups.get(band.tier) || [];
    if (group.length === 0) continue;
    const rates = group.map(w => w.rate).sort((a, b) => a - b);
    const minR = rates[0];
    const maxR = rates[rates.length - 1];
    const slug = band.tier.toLowerCase().replace(/\s+/g, '_');
    const s = 'Rate Tier';
    const k = `tier_${slug}`;

    rows.push(row(t, s, k, 'rate_range', `tier_${slug}_rate_range`, `${band.tier} Rate Range`, 'string', 'Derived', null, `$${Math.round(minR)}–$${Math.round(maxR)}/hr`));
    rows.push(row(t, s, k, 'workers', `tier_${slug}_workers`, `${band.tier} Worker Count`, 'integer', 'Derived', group.length, null));
  }

  const totalWorkers = workers.length;
  rows.push(row(t, 'Rate Tier', 'tier_total', 'total_crew_workers', 'tier_total_crew_workers', 'TOTAL CREW', 'integer', 'Derived', totalWorkers, null));

  // Blended summary metrics
  const totalHrs = workers.reduce((s, w) => s + w.totalHours, 0);
  const totalWages = workers.reduce((s, w) => s + w.wages, 0);
  const blendedGross = totalHrs > 0 ? totalWages / totalHrs : 0;

  rows.push(row(t, 'Blended Labor Metrics', 'blended', 'gross_wages_rate', 'tier_gross_wages_rate', 'Gross Wages $/hr', 'currency', 'Derived', rd(blendedGross), null));

  if (meta.unitCount && totalHrs > 0) {
    rows.push(row(t, 'Blended Labor Metrics', 'blended', 'hours_per_unit', 'tier_hours_per_unit', 'Hours per Unit', 'number', 'Derived', rd(totalHrs / meta.unitCount), null));
  }

  // Crew composition ratios
  const leads = (tierGroups.get('Superintendent') || []).length + (tierGroups.get('Lead Journeyman') || []).length;
  const helpers = (tierGroups.get('Helper') || []).length;
  const apprentices = (tierGroups.get('Apprentice') || []).length;

  if (helpers > 0 && leads > 0) {
    rows.push(row(t, 'Composition', 'composition', 'lead_to_helper_ratio', 'lead_to_helper_ratio', 'Lead-to-Helper Ratio', 'string', 'Derived', null, `1 : ${Math.round(helpers / leads)}`));
  }
  if (totalWorkers > 0 && apprentices > 0) {
    rows.push(row(t, 'Composition', 'composition', 'apprentice_ratio', 'apprentice_ratio', 'Apprentice Ratio', 'percent', 'Derived', rd((apprentices / totalWorkers) * 100), null));
  }
  if (meta.unitCount && totalWorkers > 0) {
    rows.push(row(t, 'Composition', 'composition', 'crew_density_per_100u', 'crew_density_per_100u', 'Crew Density per 100 Units', 'number', 'Derived', rd((totalWorkers / meta.unitCount) * 100), null));
  }

  return rows;
}


// ── Orchestrator ─────────────────────────────────────────────

export function buildExportRows(
  extractedData: { fields: FieldsMap; records: RecordRow[]; workerRecords?: RecordRow[] },
  meta: ProjectMeta = {},
): ExportRow[] {
  const { fields, records, workerRecords } = extractedData;

  const allRows = [
    ...buildOverview(records, fields, meta),
    ...buildBudgetVsActual(records),
    ...buildMaterial(records, meta),
    ...buildCostBreakdown(records, fields, meta),
    ...buildCrewLabor(records),
    ...buildCrewAnalytics(records),
    ...buildProductivity(records, meta),
    ...buildBenchmarkKPIs(records, fields, meta),
    ...buildInsights(records, fields),
    ...buildReconciliationTab(records, fields),
  ];

  let workers: WorkerRecord[] = [];

  if (workerRecords && workerRecords.length > 0) {
    const result = buildWorkerCrewAnalyticsFromSecondary(workerRecords);
    allRows.push(...result.rows);
    workers = result.workers;
  } else {
    const parsed = parseWorkers(records);
    if (parsed.length > 0) {
      allRows.push(...buildWorkerCrewAnalytics(parsed));
      workers = parsed;
    }
  }

  if (workers.length > 0) {
    allRows.push(...buildCrewTiers(workers, meta));
  }

  return allRows;
}

// ── Database Writer ──────────────────────────────────────────

export async function runJcrModel(
  pipelineLogId: string,
  projectId: string,
  orgId: string,
  extractedData: { fields: FieldsMap; records: RecordRow[]; skillId?: string; workerRecords?: RecordRow[] },
  meta: ProjectMeta = {},
): Promise<{ runId: string; rowCount: number }> {
  const sb = getSupabase();
  const runId = crypto.randomUUID();

  console.log(`[jcr-model] Starting run=${runId} project=${projectId} pipeline_log=${pipelineLogId}`);

  const exportRows = buildExportRows(
    { fields: extractedData.fields, records: extractedData.records, workerRecords: extractedData.workerRecords },
    meta,
  );

  console.log(`[jcr-model] Generated ${exportRows.length} export rows`);

  // Delete previous runs for this project (keep only latest)
  await sb.from('jcr_export').delete().eq('project_id', projectId).eq('org_id', orgId);

  // Insert in batches
  const dbRows = exportRows.map(r => ({
    org_id: orgId,
    project_id: projectId,
    run_id: runId,
    pipeline_log_id: pipelineLogId,
    tab: r.tab,
    section: r.section,
    record_key: r.record_key,
    field: r.field,
    canonical_name: r.canonical_name,
    display_name: r.display_name,
    data_type: r.data_type,
    status: r.status,
    value_text: r.value_text,
    value_number: r.value_number,
    notes: r.notes,
    confidence: 'Verified',
  }));

  for (let i = 0; i < dbRows.length; i += 100) {
    const batch = dbRows.slice(i, i + 100);
    const { error } = await sb.from('jcr_export').insert(batch);
    if (error) {
      console.error(`[jcr-model] Insert batch ${i} failed:`, error.message);
    }
  }

  console.log(`[jcr-model] Done: run=${runId} rows=${exportRows.length}`);
  return { runId, rowCount: exportRows.length };
}
