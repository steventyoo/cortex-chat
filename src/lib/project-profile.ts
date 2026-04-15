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

  // 3. Financial KPIs from JCR (aggregate from line-item records + top-level)
  const jcrDocs = docs.filter(d => d.skillId === 'job_cost_report');
  let contractValue = 0, revisedBudget = 0, jobToDateCost = 0, percentComplete = 0;

  if (jcrDocs.length > 0) {
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
      const rev = fieldVal(latest.fields, 'total_revenues', 'sales_cost_code_999_rev_budget');
      if (rev) contractValue = Math.abs(rev);
    }
  }

  const projectedFinalCost = percentComplete > 0
    ? (jobToDateCost / (percentComplete / 100))
    : null;

  // If percent complete wasn't in top-level fields, compute from aggregated budget vs JTD
  if (!percentComplete && revisedBudget > 0 && jobToDateCost > 0) {
    percentComplete = (jobToDateCost / revisedBudget) * 100;
  }

  const projectedFinalCostFinal = percentComplete > 0
    ? (jobToDateCost / (percentComplete / 100))
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
        if (qtyField?.value) {
          const raw = String(qtyField.value);
          const hoursMatch = raw.match(/([\d,.]+)\s*hours/i);
          if (hoursMatch) {
            totalActualHours += parseFloat(hoursMatch[1].replace(/,/g, '')) || 0;
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
    }, {
      onConflict: 'org_id,project_id,snapshot_date',
    });

  if (upsertError) {
    console.error(`[profile] Upsert failed:`, upsertError.message);
  }

  console.log(`[profile] Materialized: project=${projectId} docs=${totalDocuments} elapsed=${Date.now() - t0}ms`);

  return profile;
}
