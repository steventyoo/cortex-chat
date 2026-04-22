/**
 * Project Profile Materializer
 *
 * Aggregates extracted data + drift metrics + reconciliation results +
 * coverage into a single materialized snapshot per project per day.
 * The chat tool reads from this table for instant project health answers.
 */

import { getSupabase } from './supabase';
import { computeDriftMetrics, type DriftMetrics } from './drift-engine';

// ── Types ────────────────────────────────────────────────────

type FieldRecord = Record<string, string | number | null>;

export interface ProjectProfile {
  orgId: string;
  projectId: string;
  snapshotDate: string;
  documentCounts: Record<string, number>;
  totalDocuments: number;
  contractValue: number | null;
  revisedBudget: number | null;
  jobToDateCost: number | null;
  percentComplete: number | null;
  projectedFinalCost: number | null;
  projectedMargin: number | null;
  projectedMarginPct: number | null;
  totalBudgetHours: number | null;
  totalActualHours: number | null;
  laborProductivityRatio: number | null;
  blendedLaborRate: number | null;
  estimatedLaborRate: number | null;
  totalCos: number;
  totalCoValue: number;
  approvedCoValue: number;
  pendingCoValue: number;
  coAbsorptionRate: number | null;
  riskScore: number | null;
  riskLevel: string | null;
  productivityDrift: number | null;
  burnGap: number | null;
  rateDrift: number | null;
  reconciliationPassRate: number | null;
  reconciliationWarnings: number;
  reconciliationFailures: number;
  coverageScore: number | null;
  coveredCostCodes: number;
  missingCostCodes: number;
  topSubs: Array<{ name: string; bidAmount: number; coCount: number }>;
  subCoRate: number | null;
  // Enriched KPIs from computed_export
  netProfit: number | null;
  grossMarginPct: number | null;
  directCostTotal: number | null;
  laborCost: number | null;
  materialCost: number | null;
  overheadCost: number | null;
  burdenCost: number | null;
  subcontractCost: number | null;
  otherCost: number | null;
  revenuePerUnit: number | null;
  profitPerUnit: number | null;
  costPerUnit: number | null;
  laborPerUnit: number | null;
  materialPerUnit: number | null;
  hoursPerUnit: number | null;
  hoursPerFixture: number | null;
  blendedGrossWage: number | null;
  fullyLoadedWage: number | null;
  burdenMultiplier: number | null;
  totalWorkers: number | null;
  unitCount: number | null;
  fixtureCount: number | null;
  durationMonths: number | null;
  revenuePerHour: number | null;
  profitPerHour: number | null;
  unitsPerMonth: number | null;
  vendorCount: number | null;
  apTotal: number | null;
  laborMaterialRatio: number | null;
  laborPctOfRevenue: number | null;
  materialPctOfRevenue: number | null;
  totalLaborHours: number | null;
  totalOtHours: number | null;
  otRatio: number | null;
}

// ── Helpers ──────────────────────────────────────────────────

function numVal(field: { value: string | number | null } | undefined): number {
  if (!field?.value) return 0;
  if (typeof field.value === 'number') return field.value;
  const cleaned = String(field.value).replace(/[$,%\s]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function fieldVal(
  fields: Record<string, { value: string | number | null; confidence: number }>,
  ...names: string[]
): number {
  for (const name of names) {
    const exact = fields[name];
    if (exact) return numVal(exact);
    for (const [key, val] of Object.entries(fields)) {
      if (key.toLowerCase() === name.toLowerCase()) return numVal(val);
    }
  }
  return 0;
}

function recFieldVal(
  rec: Record<string, { value: string | number | null; confidence: number }>,
  ...names: string[]
): number {
  return fieldVal(rec, ...names);
}

// ── Main Entry Point ─────────────────────────────────────────

export async function materializeProjectProfile(
  projectId: string,
  orgId: string,
): Promise<ProjectProfile> {
  const t0 = Date.now();
  const sb = getSupabase();

  console.log(`[profile] Materializing profile: project=${projectId} org=${orgId}`);

  // 1. Load all extracted documents
  const { data: pipelineDocs } = await sb
    .from('pipeline_log')
    .select('id, file_name, extracted_data, status')
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .not('extracted_data', 'is', null);

  type DocRow = {
    skillId: string;
    fields: Record<string, { value: string | number | null; confidence: number }>;
    records?: Array<Record<string, unknown>>;
  };

  const docs: DocRow[] = (pipelineDocs || [])
    .filter((d: Record<string, unknown>) => {
      const ed = d.extracted_data as Record<string, unknown> | null;
      return ed?.skillId && ed?.fields;
    })
    .map((d: Record<string, unknown>) => {
      const ed = d.extracted_data as Record<string, unknown>;
      return {
        skillId: ed.skillId as string,
        fields: (ed.fields || {}) as Record<string, { value: string | number | null; confidence: number }>,
        records: ed.records as Array<Record<string, unknown>> | undefined,
      };
    });

  // 2. Document inventory
  const documentCounts: Record<string, number> = {};
  for (const doc of docs) {
    documentCounts[doc.skillId] = (documentCounts[doc.skillId] || 0) + 1;
  }
  const totalDocuments = docs.length;

  // 3. Financial KPIs — prefer computed_export canonical values (already filtered correctly)
  const jcrDocs = docs.filter(d => d.skillId === 'job_cost_report');
  let contractValue = 0, revisedBudget = 0, jobToDateCost = 0, percentComplete = 0;

  // Try computed_export first (these are computed with proper 999/overhead filtering)
  const { data: baseKpis } = await sb
    .from('computed_export')
    .select('canonical_name, value_number')
    .eq('project_id', projectId)
    .eq('record_key', 'project')
    .in('canonical_name', ['contract_value', 'total_revised_budget', 'total_jtd_cost']);

  const baseMap = new Map<string, number>();
  for (const r of baseKpis || []) {
    if (r.value_number != null) baseMap.set(r.canonical_name, r.value_number);
  }

  contractValue = baseMap.get('contract_value') || 0;
  revisedBudget = baseMap.get('total_revised_budget') || 0;
  jobToDateCost = baseMap.get('total_jtd_cost') || 0;

  // Fall back to raw extracted_data if computed_export is empty
  if (!contractValue && !revisedBudget && !jobToDateCost && jcrDocs.length > 0) {
    const latest = jcrDocs[jcrDocs.length - 1];

    contractValue = fieldVal(latest.fields, 'Contract Value', 'Original Contract', 'Contract Amount');
    const rawPct = fieldVal(latest.fields, 'Percent Complete Cost', 'Percent Complete', '% Complete', '% Budget Consumed');
    percentComplete = rawPct > 0 && rawPct <= 1 ? rawPct * 100 : rawPct;

    // Try top-level summary fields first
    revisedBudget = fieldVal(latest.fields, 'Total Revised Budget', 'Revised Budget', 'Revised Contract', 'Total Budget');
    jobToDateCost = fieldVal(latest.fields, 'Total Jtd Cost', 'Job to Date', 'Job To Date Cost', 'total_expenses', 'Actual Cost to Date');

    // If top-level totals are missing, sum from per-line-item records
    if (latest.records && latest.records.length > 0) {
      const recordFields = latest.records as Array<Record<string, { value: string | number | null; confidence: number }>>;

      if (!revisedBudget) {
        let sum = 0;
        for (const rec of recordFields) {
          sum += recFieldVal(rec, 'Revised Budget (line)', 'Revised Budget');
        }
        if (sum) revisedBudget = sum;
      }

      if (!jobToDateCost) {
        let sum = 0;
        for (const rec of recordFields) {
          sum += recFieldVal(rec, 'Job-to-Date Cost (line)', 'Job-to-Date Cost', 'Jtd Cost');
        }
        if (sum) jobToDateCost = sum;
      }

      if (!contractValue) {
        let sum = 0;
        for (const rec of recordFields) {
          sum += recFieldVal(rec, 'Original Budget (line)', 'Original Budget');
        }
        if (sum) contractValue = sum;
      }
    }

    // Use total_revenues as contract value fallback (negated since it's stored negative)
    if (!contractValue) {
      const rev = fieldVal(latest.fields, 'total_revenues', 'sales_cost_code_rev_budget');
      if (rev) contractValue = Math.abs(rev);
    }
  }

  const projectedFinalCost = percentComplete > 0
    ? (Math.abs(jobToDateCost) / (percentComplete / 100))
    : null;

  // If percent complete wasn't in top-level fields, compute from aggregated budget vs JTD
  // JTD cost may be stored as negative by accounting convention; use absolute value
  if (!percentComplete && revisedBudget > 0 && jobToDateCost !== 0) {
    percentComplete = (Math.abs(jobToDateCost) / revisedBudget) * 100;
  }

  const projectedFinalCostFinal = percentComplete > 0
    ? (Math.abs(jobToDateCost) / (percentComplete / 100))
    : projectedFinalCost;
  const projectedMargin = revisedBudget > 0 && projectedFinalCostFinal
    ? revisedBudget - projectedFinalCostFinal
    : null;
  const projectedMarginPct = revisedBudget > 0 && projectedMargin != null
    ? (projectedMargin / revisedBudget) * 100
    : null;

  // Also compute total over/under from JCR records if available
  let totalOverUnder: number | null = null;
  if (jcrDocs.length > 0) {
    const latest = jcrDocs[jcrDocs.length - 1];
    if (latest.records && latest.records.length > 0) {
      const recordFields = latest.records as Array<Record<string, { value: string | number | null; confidence: number }>>;
      let sum = 0;
      let found = false;
      for (const rec of recordFields) {
        const v = recFieldVal(rec, 'Over/Under Budget — $ (line)', 'Over/Under Budget');
        if (v) { sum += v; found = true; }
      }
      if (found) totalOverUnder = sum;
    }
  }

  // 4. Labor KPIs from production docs + JCR records
  const prodDocs = docs.filter(d => d.skillId === 'production_activity');
  let totalBudgetHours = 0, totalActualHours = 0;

  for (const doc of prodDocs) {
    totalBudgetHours += fieldVal(doc.fields, 'Budget Labor Hours', 'Budget Hours', 'Estimated Hours');
    totalActualHours += fieldVal(doc.fields, 'Actual Labor Hours', 'Total Labor Hours', 'Actual Hours');
  }

  // Extract labor hours from JCR line items if production docs don't have them
  if (jcrDocs.length > 0 && !totalActualHours) {
    const latest = jcrDocs[jcrDocs.length - 1];
    if (latest.records && latest.records.length > 0) {
      const recordFields = latest.records as Array<Record<string, { value: string | number | null; confidence: number }>>;
      for (const rec of recordFields) {
        const category = String(rec['Cost Category']?.value || '').toLowerCase();
        if (category !== 'labor') continue;
        const qtyField = rec['Quantity (labor hours or units)'] || rec['Quantity'];
        if (qtyField?.value != null) {
          if (typeof qtyField.value === 'number') {
            totalActualHours += qtyField.value;
          } else {
            const raw = String(qtyField.value);
            const hoursMatch = raw.match(/([\d,.]+)\s*hours/i);
            if (hoursMatch) {
              totalActualHours += parseFloat(hoursMatch[1].replace(/,/g, '')) || 0;
            } else {
              const plain = parseFloat(raw.replace(/,/g, ''));
              if (!isNaN(plain) && plain > 0) totalActualHours += plain;
            }
          }
        }
      }
    }
  }

  const laborProductivityRatio = totalBudgetHours > 0
    ? totalActualHours / totalBudgetHours
    : null;

  // Compute drift metrics using the existing engine
  let driftMetrics: DriftMetrics | null = null;
  if (jcrDocs.length > 0) {
    const projectData: FieldRecord = {};
    const latestJcr = jcrDocs[jcrDocs.length - 1];
    for (const [key, val] of Object.entries(latestJcr.fields)) {
      projectData[key] = val.value;
    }

    const jcrRecords: FieldRecord[] = jcrDocs.flatMap(d =>
      (d.records || []).map(r => {
        const flat: FieldRecord = {};
        for (const [key, val] of Object.entries(r)) {
          flat[key] = (val && typeof val === 'object' && 'value' in val)
            ? (val as { value: string | number | null }).value
            : (val as string | number | null);
        }
        return flat;
      })
    );

    const prodRecords: FieldRecord[] = prodDocs.flatMap(d =>
      (d.records || []).map(r => {
        const flat: FieldRecord = {};
        for (const [key, val] of Object.entries(r)) {
          flat[key] = (val && typeof val === 'object' && 'value' in val)
            ? (val as { value: string | number | null }).value
            : (val as string | number | null);
        }
        return flat;
      })
    );

    try {
      driftMetrics = computeDriftMetrics(projectData, jcrRecords, prodRecords);
    } catch (err) {
      console.warn(`[profile] Drift computation failed:`, err);
    }
  }

  // 5. Change order KPIs
  const coDocs = docs.filter(d => d.skillId === 'change_order');
  let totalCoValue = 0, approvedCoValue = 0, pendingCoValue = 0;

  for (const doc of coDocs) {
    const amount = fieldVal(doc.fields, 'Owner Approved Amount', 'CO Amount', 'Change Order Amount', 'Amount');
    const status = String(doc.fields['Status']?.value || doc.fields['CO Status']?.value || '').toLowerCase();
    totalCoValue += amount;
    if (status.includes('approved') || status.includes('executed')) {
      approvedCoValue += amount;
    } else if (status.includes('pending') || status.includes('submitted')) {
      pendingCoValue += amount;
    } else {
      approvedCoValue += amount;
    }
  }

  const coAbsorptionRate = revisedBudget > 0 && contractValue > 0 && revisedBudget !== contractValue
    ? ((revisedBudget - contractValue) > 0 ? approvedCoValue / (revisedBudget - contractValue) * 100 : null)
    : null;

  // 6. Reconciliation KPIs
  const { data: reconResults } = await sb
    .from('reconciliation_results')
    .select('status')
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(500);

  const reconTotal = reconResults?.length || 0;
  const reconPass = reconResults?.filter(r => r.status === 'pass').length || 0;
  const reconWarnings = reconResults?.filter(r => r.status === 'warning').length || 0;
  const reconFailures = reconResults?.filter(r => r.status === 'fail').length || 0;
  const reconciliationPassRate = reconTotal > 0 ? (reconPass / reconTotal) * 100 : null;

  // 7. Coverage KPIs
  const { data: coverageData } = await sb
    .from('coverage_reports')
    .select('report_data')
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1);

  let coverageScore: number | null = null;
  let coveredCostCodes = 0, missingCostCodes = 0;
  if (coverageData && coverageData.length > 0) {
    const report = coverageData[0].report_data as Record<string, unknown>;
    coverageScore = Number(report?.coverageScore || report?.coverage_score || 0);
    coveredCostCodes = Number(report?.coveredCount || report?.covered_count || 0);
    missingCostCodes = Number(report?.missingCount || report?.missing_count || 0);
  }

  // 8. Sub/vendor KPIs
  const subDocs = docs.filter(d => d.skillId === 'sub_bid');

  // 8b. JCR Export enrichment — read canonical KPIs from computed_export
  type JcrRow = { canonical_name: string; value_number: number | null; value_text: string | null };
  const { data: jcrExportRows } = await sb
    .from('computed_export')
    .select('canonical_name, value_number, value_text')
    .eq('project_id', projectId)
    .eq('record_key', 'project')
    .in('canonical_name', [
      'net_profit', 'gross_margin_pct', 'direct_cost_total',
      'labor_cost', 'material_cost', 'overhead_cost', 'burden_cost',
      'subcontract_cost', 'other_cost',
      'revenue_per_unit', 'profit_per_unit', 'cost_per_unit',
      'labor_per_unit', 'material_per_unit',
      'hours_per_unit', 'hours_per_fixture',
      'blended_gross_wage', 'fully_loaded_wage', 'burden_multiplier',
      'unit_count', 'fixture_count', 'duration_months',
      'revenue_per_hour', 'kpi_profit_per_hour',
      'units_per_month', 'vendor_count', 'ap_total',
      'labor_material_ratio', 'labor_pct_of_revenue', 'material_pct_of_revenue',
      'crew_total_hours', 'crew_total_ot_hours', 'crew_ot_ratio',
      'crew_total_hours_pr', 'crew_total_ot_hours_pr', 'crew_ot_ratio_pr',
      'blended_gross_wage_pr', 'total_workers',
      'total_labor_hours', 'source_pr', 'source_ap',
    ]);

  const jcrMap = new Map<string, JcrRow>();
  for (const r of (jcrExportRows || []) as JcrRow[]) {
    jcrMap.set(r.canonical_name, r);
  }
  const jn = (name: string): number | null => jcrMap.get(name)?.value_number ?? null;
  const topSubs: Array<{ name: string; bidAmount: number; coCount: number }> = [];
  for (const doc of subDocs) {
    const name = String(doc.fields['Subcontractor']?.value || doc.fields['Vendor Name']?.value || 'Unknown');
    const bidAmount = fieldVal(doc.fields, 'Bid Amount', 'Total Bid', 'Contract Amount');
    const subCOs = coDocs.filter(co => {
      const coSub = String(co.fields['Subcontractor']?.value || co.fields['Vendor']?.value || '').toLowerCase();
      return coSub.includes(name.toLowerCase());
    });
    topSubs.push({ name, bidAmount, coCount: subCOs.length });
  }
  topSubs.sort((a, b) => b.bidAmount - a.bidAmount);

  const subCoRate = subDocs.length > 0
    ? (topSubs.filter(s => s.coCount > 0).length / subDocs.length) * 100
    : null;

  const profile: ProjectProfile = {
    orgId,
    projectId,
    snapshotDate: new Date().toISOString().slice(0, 10),
    documentCounts,
    totalDocuments,
    contractValue: contractValue || null,
    revisedBudget: revisedBudget || null,
    jobToDateCost: jobToDateCost || null,
    percentComplete: percentComplete || null,
    projectedFinalCost: projectedFinalCostFinal ? Math.round(projectedFinalCostFinal) : null,
    projectedMargin: projectedMargin ? Math.round(projectedMargin) : null,
    projectedMarginPct: projectedMarginPct ? Math.round(projectedMarginPct * 100) / 100 : null,
    totalBudgetHours: totalBudgetHours || null,
    totalActualHours: totalActualHours || null,
    laborProductivityRatio: laborProductivityRatio ? Math.round(laborProductivityRatio * 1000) / 1000 : null,
    blendedLaborRate: driftMetrics?.actualLaborRate ? Math.round(driftMetrics.actualLaborRate * 100) / 100 : null,
    estimatedLaborRate: driftMetrics?.estimatedLaborRate ? Math.round(driftMetrics.estimatedLaborRate * 100) / 100 : null,
    totalCos: coDocs.length,
    totalCoValue: Math.round(totalCoValue),
    approvedCoValue: Math.round(approvedCoValue),
    pendingCoValue: Math.round(pendingCoValue),
    coAbsorptionRate: coAbsorptionRate ? Math.round(coAbsorptionRate * 100) / 100 : null,
    riskScore: driftMetrics?.riskScore ?? null,
    riskLevel: driftMetrics?.riskLevel ?? null,
    productivityDrift: driftMetrics?.productivityDrift ? Math.round(driftMetrics.productivityDrift * 100) / 100 : null,
    burnGap: driftMetrics?.burnGap ? Math.round(driftMetrics.burnGap * 100) / 100 : null,
    rateDrift: driftMetrics?.rateDrift ? Math.round(driftMetrics.rateDrift * 100) / 100 : null,
    reconciliationPassRate: reconciliationPassRate ? Math.round(reconciliationPassRate * 100) / 100 : null,
    reconciliationWarnings: reconWarnings,
    reconciliationFailures: reconFailures,
    coverageScore,
    coveredCostCodes,
    missingCostCodes,
    topSubs: topSubs.slice(0, 10),
    subCoRate: subCoRate ? Math.round(subCoRate * 100) / 100 : null,
    // Enriched from computed_export
    netProfit: jn('net_profit'),
    grossMarginPct: jn('gross_margin_pct'),
    directCostTotal: jn('direct_cost_total'),
    laborCost: jn('labor_cost'),
    materialCost: jn('material_cost'),
    overheadCost: jn('overhead_cost'),
    burdenCost: jn('burden_cost'),
    subcontractCost: jn('subcontract_cost'),
    otherCost: jn('other_cost'),
    revenuePerUnit: jn('revenue_per_unit'),
    profitPerUnit: jn('profit_per_unit'),
    costPerUnit: jn('cost_per_unit'),
    laborPerUnit: jn('labor_per_unit'),
    materialPerUnit: jn('material_per_unit'),
    hoursPerUnit: jn('hours_per_unit'),
    hoursPerFixture: jn('hours_per_fixture'),
    blendedGrossWage: jn('blended_gross_wage_pr') ?? jn('blended_gross_wage'),
    fullyLoadedWage: jn('fully_loaded_wage'),
    burdenMultiplier: jn('burden_multiplier'),
    totalWorkers: jn('total_workers') ? Math.round(jn('total_workers')!) : null,
    unitCount: jn('unit_count') ? Math.round(jn('unit_count')!) : null,
    fixtureCount: jn('fixture_count') ? Math.round(jn('fixture_count')!) : null,
    durationMonths: jn('duration_months'),
    revenuePerHour: jn('revenue_per_hour'),
    profitPerHour: jn('kpi_profit_per_hour'),
    unitsPerMonth: jn('units_per_month'),
    vendorCount: jn('vendor_count') ? Math.round(jn('vendor_count')!) : null,
    apTotal: jn('ap_total') ?? jn('source_ap'),
    laborMaterialRatio: jn('labor_material_ratio'),
    laborPctOfRevenue: jn('labor_pct_of_revenue'),
    materialPctOfRevenue: jn('material_pct_of_revenue'),
    totalLaborHours: jn('crew_total_hours_pr') ?? jn('total_labor_hours') ?? jn('crew_total_hours'),
    totalOtHours: jn('crew_total_ot_hours_pr') ?? jn('crew_total_ot_hours'),
    otRatio: jn('crew_ot_ratio_pr') ?? jn('crew_ot_ratio'),
  };

  // 9. Upsert into project_profiles
  const { error: upsertError } = await sb
    .from('project_profiles')
    .upsert({
      org_id: orgId,
      project_id: projectId,
      snapshot_date: profile.snapshotDate,
      document_counts: profile.documentCounts,
      total_documents: profile.totalDocuments,
      contract_value: profile.contractValue,
      revised_budget: profile.revisedBudget,
      job_to_date_cost: profile.jobToDateCost,
      percent_complete: profile.percentComplete,
      projected_final_cost: profile.projectedFinalCost,
      projected_margin: profile.projectedMargin,
      projected_margin_pct: profile.projectedMarginPct,
      total_budget_hours: profile.totalBudgetHours,
      total_actual_hours: profile.totalActualHours,
      labor_productivity_ratio: profile.laborProductivityRatio,
      blended_labor_rate: profile.blendedLaborRate,
      estimated_labor_rate: profile.estimatedLaborRate,
      total_cos: profile.totalCos,
      total_co_value: profile.totalCoValue,
      approved_co_value: profile.approvedCoValue,
      pending_co_value: profile.pendingCoValue,
      co_absorption_rate: profile.coAbsorptionRate,
      risk_score: profile.riskScore,
      risk_level: profile.riskLevel,
      productivity_drift: profile.productivityDrift,
      burn_gap: profile.burnGap,
      rate_drift: profile.rateDrift,
      reconciliation_pass_rate: profile.reconciliationPassRate,
      reconciliation_warnings: profile.reconciliationWarnings,
      reconciliation_failures: profile.reconciliationFailures,
      coverage_score: profile.coverageScore,
      covered_cost_codes: profile.coveredCostCodes,
      missing_cost_codes: profile.missingCostCodes,
      top_subs: profile.topSubs,
      sub_co_rate: profile.subCoRate,
      net_profit: profile.netProfit,
      gross_margin_pct: profile.grossMarginPct,
      direct_cost_total: profile.directCostTotal,
      labor_cost: profile.laborCost,
      material_cost: profile.materialCost,
      overhead_cost: profile.overheadCost,
      burden_cost: profile.burdenCost,
      subcontract_cost: profile.subcontractCost,
      other_cost: profile.otherCost,
      revenue_per_unit: profile.revenuePerUnit,
      profit_per_unit: profile.profitPerUnit,
      cost_per_unit: profile.costPerUnit,
      labor_per_unit: profile.laborPerUnit,
      material_per_unit: profile.materialPerUnit,
      hours_per_unit: profile.hoursPerUnit,
      hours_per_fixture: profile.hoursPerFixture,
      blended_gross_wage: profile.blendedGrossWage,
      fully_loaded_wage: profile.fullyLoadedWage,
      burden_multiplier: profile.burdenMultiplier,
      total_workers: profile.totalWorkers,
      unit_count: profile.unitCount,
      fixture_count: profile.fixtureCount,
      duration_months: profile.durationMonths,
      revenue_per_hour: profile.revenuePerHour,
      profit_per_hour: profile.profitPerHour,
      units_per_month: profile.unitsPerMonth,
      vendor_count: profile.vendorCount,
      ap_total: profile.apTotal,
      labor_material_ratio: profile.laborMaterialRatio,
      labor_pct_of_revenue: profile.laborPctOfRevenue,
      material_pct_of_revenue: profile.materialPctOfRevenue,
      total_labor_hours: profile.totalLaborHours,
      total_ot_hours: profile.totalOtHours,
      ot_ratio: profile.otRatio,
    }, {
      onConflict: 'org_id,project_id,snapshot_date',
    });

  if (upsertError) {
    console.error(`[profile] Upsert failed:`, upsertError.message);
  }

  console.log(`[profile] Materialized: project=${projectId} docs=${totalDocuments} elapsed=${Date.now() - t0}ms`);

  return profile;
}
