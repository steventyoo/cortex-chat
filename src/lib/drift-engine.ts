// Drift Engine — Continuous Productivity Intelligence
// Computes: productivity drift, burn gap, rate creep, composite risk score
// Powers the Weekly Job Risk Report

// ─── Types ──────────────────────────────────────────────────

// Generic record type (Airtable fields extracted)
type FieldRecord = Record<string, unknown>;

export interface DriftMetrics {
  // Predictor 1: Labor Productivity Drift
  // actual_hours_per_unit vs estimated_hours_per_unit
  productivityDrift: number; // % drift from estimate (positive = worse)
  productivityDriftRaw: number; // absolute drift value
  productivitySignal: 'normal' | 'watch' | 'high'; // >10% for 2+ weeks = high, >5% trending = watch

  // Predictor 2: Burn Rate vs Progress
  // cost_burn (actual/budget) vs progress (% complete based on work)
  costBurn: number; // actual_cost / revised_budget as %
  progressPercent: number; // % complete (work-based if available, else cost-based)
  burnGap: number; // cost_burn - progress (positive = spending faster than working)
  burnGapSignal: 'normal' | 'watch' | 'high'; // >10% = high, >5% = watch

  // Predictor 3: Labor Rate Creep
  // actual $/hr vs estimated $/hr
  actualLaborRate: number; // actual labor cost / actual labor hours
  estimatedLaborRate: number; // budget labor cost / budget labor hours
  rateDrift: number; // % drift (positive = rates increasing)
  rateDriftSignal: 'normal' | 'watch' | 'high';

  // Composite Risk Score (Palantir formula)
  // score = 0.5 * prod_drift_norm + 0.3 * burn_gap_norm + 0.2 * rate_drift_norm
  riskScore: number; // 0-100
  riskLevel: 'low' | 'medium' | 'high' | 'critical';

  // Projected impact
  projectedMarginImpact: number; // $ impact at completion
  projectedLaborOverrun: number; // $ labor overrun at current drift

  // Top drivers (for the weekly report)
  drivers: DriftDriver[];
  recommendations: string[];
}

export interface DriftDriver {
  metric: string;
  value: string;
  impact: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface WeeklySnapshot {
  weekEnding: string; // ISO date
  projectId: string;
  productivityDrift: number;
  burnGap: number;
  rateDrift: number;
  riskScore: number;
  totalBudget: number;
  totalActual: number;
  percentComplete: number;
  laborRatio: number;
}

export interface WeeklyRiskReport {
  generatedAt: string;
  orgId: string;
  projects: ProjectRiskSummary[];
  portfolioRiskScore: number;
  portfolioRiskLevel: string;
  totalExposure: number;
  keyInsights: string[];
}

export interface ProjectRiskSummary {
  projectId: string;
  projectName: string;
  riskScore: number;
  riskLevel: string;
  percentComplete: number;
  drivers: DriftDriver[];
  recommendations: string[];
  projectedMarginImpact: number;
  weekOverWeekChange: number | null; // change in risk score from last week
}

// ─── Compute Drift Metrics ──────────────────────────────────

export function computeDriftMetrics(
  project: Record<string, unknown>,
  jobCosts: FieldRecord[],
  production: FieldRecord[],
  previousSnapshot?: WeeklySnapshot | null,
): DriftMetrics {
  // ─── Extract project-level data ───────────────
  const contractValue = Number(project['Contract Value'] || 0);
  const revisedBudget = Number(project['Revised Budget'] || contractValue);
  const jobToDate = Number(project['Job to Date'] || 0);
  const rawPercent = Number(project['Percent Complete Cost'] || 0);
  const percentComplete = rawPercent > 0 && rawPercent <= 1 ? rawPercent * 100 : rawPercent;

  // ─── Predictor 1: Labor Productivity Drift ────
  // From PRODUCTION table: actual hours / budget hours per activity
  const totalBudgetHrs = production.reduce(
    (sum, pr) => sum + Number(pr['Budget Labor Hours'] || 0), 0
  );
  const totalActualHrs = production.reduce(
    (sum, pr) => sum + Number(pr['Actual Labor Hours'] || 0), 0
  );

  // Drift = (actual_hours / budget_hours) - 1
  // Positive means more hours than planned (worse)
  const productivityDriftRaw = totalBudgetHrs > 0
    ? (totalActualHrs / totalBudgetHrs) - 1
    : 0;
  const productivityDrift = productivityDriftRaw * 100; // as percentage

  // Signal based on drift magnitude and trend
  let productivitySignal: DriftMetrics['productivitySignal'] = 'normal';
  if (Math.abs(productivityDrift) > 10) {
    // Check if sustained (compare with previous snapshot)
    if (previousSnapshot && Math.abs(previousSnapshot.productivityDrift) > 10) {
      productivitySignal = 'high'; // >10% for 2 consecutive periods
    } else {
      productivitySignal = previousSnapshot ? 'high' : 'watch';
    }
  } else if (Math.abs(productivityDrift) > 5) {
    // Check if trending up
    if (previousSnapshot && productivityDrift > previousSnapshot.productivityDrift) {
      productivitySignal = 'watch'; // >5% and trending worse
    }
  }

  // ─── Predictor 2: Burn Rate vs Progress ───────
  // cost_burn = actual_cost / revised_budget (as %)
  const costBurn = revisedBudget > 0 ? (jobToDate / revisedBudget) * 100 : 0;

  // For now we use cost-based % complete
  // TODO: When production quantities are tracked, use units_installed / total_units
  const progressPercent = percentComplete;

  // burn_gap = cost_burn - progress
  // Positive = spending faster than progressing (bad)
  const burnGap = costBurn - progressPercent;

  let burnGapSignal: DriftMetrics['burnGapSignal'] = 'normal';
  if (burnGap > 10) burnGapSignal = 'high';
  else if (burnGap > 5) burnGapSignal = 'watch';

  // ─── Predictor 3: Labor Rate Creep ────────────
  // Compare blended actual labor rate vs estimated labor rate
  // Get labor cost codes from JOB_COSTS (category L or code 100-199)
  const laborCosts = jobCosts.filter((jc) => {
    const code = String(jc['Item Code'] || jc['Cost Code'] || '');
    const codeNum = parseInt(code);
    const desc = String(jc['Item Description'] || jc['Description'] || '').toLowerCase();
    return (codeNum >= 100 && codeNum < 200) || desc.includes('labor');
  });

  const totalLaborBudget = laborCosts.reduce(
    (sum, jc) => sum + Number(jc['Revised Budget'] || jc['Budget'] || 0), 0
  );
  const totalLaborActual = laborCosts.reduce(
    (sum, jc) => sum + Number(jc['Job to Date'] || jc['Actual'] || 0), 0
  );

  // Estimated rate = total labor budget / total budget hours
  const estimatedLaborRate = totalBudgetHrs > 0 ? totalLaborBudget / totalBudgetHrs : 0;

  // Actual rate = total labor actual / total actual hours
  const actualLaborRate = totalActualHrs > 0 ? totalLaborActual / totalActualHrs : 0;

  // Rate drift = (actual_rate / estimated_rate) - 1
  const rateDrift = estimatedLaborRate > 0
    ? ((actualLaborRate / estimatedLaborRate) - 1) * 100
    : 0;

  let rateDriftSignal: DriftMetrics['rateDriftSignal'] = 'normal';
  if (Math.abs(rateDrift) > 10) rateDriftSignal = 'high';
  else if (Math.abs(rateDrift) > 5) rateDriftSignal = 'watch';

  // ─── Composite Risk Score ─────────────────────
  // score = 0.5 * productivity_drift_norm + 0.3 * burn_gap_norm + 0.2 * rate_drift_norm
  // Normalize each to 0-100 scale

  // Productivity drift: 0% = 0, 5% = 25, 10% = 50, 20% = 75, 30%+ = 100
  const prodNorm = normalizeMetric(Math.abs(productivityDrift), 0, 30);

  // Burn gap: 0% = 0, 5% = 25, 10% = 50, 20% = 75, 30%+ = 100
  const burnNorm = normalizeMetric(Math.max(0, burnGap), 0, 30);

  // Rate drift: 0% = 0, 5% = 25, 10% = 50, 15% = 75, 20%+ = 100
  const rateNorm = normalizeMetric(Math.abs(rateDrift), 0, 20);

  const riskScore = Math.round(
    0.5 * prodNorm + 0.3 * burnNorm + 0.2 * rateNorm
  );

  const clampedScore = Math.min(100, Math.max(0, riskScore));
  const riskLevel: DriftMetrics['riskLevel'] =
    clampedScore >= 75 ? 'critical' :
    clampedScore >= 50 ? 'high' :
    clampedScore >= 25 ? 'medium' : 'low';

  // ─── Projected Impact ─────────────────────────
  // If productivity drift continues at current rate, how much extra will we spend?
  const workRemainingPct = Math.max(0, 100 - percentComplete);

  // Projected labor overrun based on current drift
  const projectedLaborOverrun = productivityDrift > 0
    ? totalLaborBudget * (productivityDrift / 100) * (workRemainingPct / 100) * 2
    : 0; // multiply remaining by drift rate, times 2 for full project extrapolation

  // Total margin impact = burn gap extrapolated + rate drift impact
  const projectedMarginImpact = burnGap > 0
    ? revisedBudget * (burnGap / 100) * (workRemainingPct / percentComplete || 1)
    : 0;

  // ─── Drivers & Recommendations ────────────────
  const drivers: DriftDriver[] = [];
  const recommendations: string[] = [];

  // Productivity drift driver
  if (productivityDrift > 5) {
    const worstActivities = production
      .map((pr) => ({
        code: String(pr['Cost Code'] || ''),
        desc: String(pr['Activity Description'] || pr['Description'] || ''),
        ratio: Number(pr['Budget Labor Hours'] || 0) > 0
          ? Number(pr['Actual Labor Hours'] || 0) / Number(pr['Budget Labor Hours'] || 0)
          : 0,
      }))
      .filter((a) => a.ratio > 1.1)
      .sort((a, b) => b.ratio - a.ratio);

    const worstDesc = worstActivities.length > 0
      ? ` — worst: ${worstActivities[0].desc} (${Math.round((worstActivities[0].ratio - 1) * 100)}% over)`
      : '';

    drivers.push({
      metric: 'Productivity drift',
      value: `+${productivityDrift.toFixed(1)}%`,
      impact: projectedLaborOverrun > 0 ? `-$${Math.round(projectedLaborOverrun / 1000)}k margin` : 'Monitor',
      severity: productivitySignal === 'high' ? 'critical' : productivitySignal === 'watch' ? 'warning' : 'info',
    });

    if (worstActivities.length > 0) {
      recommendations.push(
        `Review crew allocation on ${worstActivities[0].desc}${worstDesc}`
      );
    }
    if (productivityDrift > 10) {
      recommendations.push('Add short-term crew to catch up on lagging activities');
    }
  }

  // Burn gap driver
  if (burnGap > 5) {
    drivers.push({
      metric: 'Burn gap',
      value: `+${burnGap.toFixed(0)}%`,
      impact: `Spending ${burnGap.toFixed(0)}% faster than progress`,
      severity: burnGapSignal === 'high' ? 'critical' : 'warning',
    });
    recommendations.push('Audit recent expenditures for waste or inefficiency');
    if (burnGap > 15) {
      recommendations.push('Consider requesting scope reduction or additional budget');
    }
  }

  // Rate drift driver
  if (rateDrift > 5) {
    drivers.push({
      metric: 'Labor rate creep',
      value: `+${rateDrift.toFixed(0)}%`,
      impact: `$${actualLaborRate.toFixed(0)}/hr vs est. $${estimatedLaborRate.toFixed(0)}/hr`,
      severity: rateDriftSignal === 'high' ? 'critical' : 'warning',
    });
    recommendations.push('Review OT hours and crew mix — check for unnecessary premium time');
  }

  // If everything looks good
  if (drivers.length === 0) {
    drivers.push({
      metric: 'All metrics',
      value: 'On track',
      impact: 'No significant drift detected',
      severity: 'info',
    });
  }

  return {
    productivityDrift,
    productivityDriftRaw,
    productivitySignal,
    costBurn,
    progressPercent,
    burnGap,
    burnGapSignal,
    actualLaborRate,
    estimatedLaborRate,
    rateDrift,
    rateDriftSignal,
    riskScore: clampedScore,
    riskLevel,
    projectedMarginImpact,
    projectedLaborOverrun,
    drivers,
    recommendations,
  };
}

// ─── Weekly Report Generator ────────────────────────────────

export function generateFridayReport(
  projects: Array<{
    projectId: string;
    projectName: string;
    percentComplete: number;
    drift: DriftMetrics;
    previousSnapshot?: WeeklySnapshot | null;
  }>,
  orgName: string,
): WeeklyRiskReport {
  const now = new Date();
  const fridayDate = getNextFriday(now);

  const projectSummaries: ProjectRiskSummary[] = projects
    .map((p) => ({
      projectId: p.projectId,
      projectName: p.projectName,
      riskScore: p.drift.riskScore,
      riskLevel: p.drift.riskLevel,
      percentComplete: p.percentComplete,
      drivers: p.drift.drivers,
      recommendations: p.drift.recommendations,
      projectedMarginImpact: p.drift.projectedMarginImpact,
      weekOverWeekChange: p.previousSnapshot
        ? p.drift.riskScore - p.previousSnapshot.riskScore
        : null,
    }))
    .sort((a, b) => b.riskScore - a.riskScore);

  // Portfolio-level metrics
  const totalExposure = projectSummaries.reduce(
    (sum, p) => sum + Math.max(0, p.projectedMarginImpact), 0
  );
  const avgRisk = projectSummaries.length > 0
    ? projectSummaries.reduce((sum, p) => sum + p.riskScore, 0) / projectSummaries.length
    : 0;

  const portfolioRiskLevel =
    avgRisk >= 75 ? 'critical' :
    avgRisk >= 50 ? 'high' :
    avgRisk >= 25 ? 'medium' : 'low';

  // Key portfolio insights
  const keyInsights: string[] = [];

  const highRiskProjects = projectSummaries.filter((p) => p.riskScore >= 50);
  if (highRiskProjects.length > 0) {
    keyInsights.push(
      `${highRiskProjects.length} project${highRiskProjects.length > 1 ? 's' : ''} at high risk — combined $${Math.round(totalExposure / 1000)}K margin exposure`
    );
  }

  const worseningProjects = projectSummaries.filter(
    (p) => p.weekOverWeekChange !== null && p.weekOverWeekChange > 5
  );
  if (worseningProjects.length > 0) {
    keyInsights.push(
      `${worseningProjects.map((p) => p.projectName).join(', ')} risk scores worsening week-over-week`
    );
  }

  const improvingProjects = projectSummaries.filter(
    (p) => p.weekOverWeekChange !== null && p.weekOverWeekChange < -5
  );
  if (improvingProjects.length > 0) {
    keyInsights.push(
      `${improvingProjects.map((p) => p.projectName).join(', ')} showing improvement`
    );
  }

  if (keyInsights.length === 0) {
    keyInsights.push('All projects tracking within acceptable risk parameters');
  }

  return {
    generatedAt: now.toISOString(),
    orgId: '', // Set by caller
    projects: projectSummaries,
    portfolioRiskScore: Math.round(avgRisk),
    portfolioRiskLevel,
    totalExposure,
    keyInsights,
  };
}

// ─── Snapshot Builder ───────────────────────────────────────

export function buildSnapshot(
  projectId: string,
  drift: DriftMetrics,
  project: Record<string, unknown>,
): WeeklySnapshot {
  const contractValue = Number(project['Contract Value'] || 0);
  const revisedBudget = Number(project['Revised Budget'] || contractValue);
  const jobToDate = Number(project['Job to Date'] || 0);
  const rawPercent = Number(project['Percent Complete Cost'] || 0);
  const percentComplete = rawPercent > 0 && rawPercent <= 1 ? rawPercent * 100 : rawPercent;

  const now = new Date();
  const friday = getNextFriday(now);

  return {
    weekEnding: friday.toISOString().split('T')[0],
    projectId,
    productivityDrift: drift.productivityDrift,
    burnGap: drift.burnGap,
    rateDrift: drift.rateDrift,
    riskScore: drift.riskScore,
    totalBudget: revisedBudget,
    totalActual: jobToDate,
    percentComplete,
    laborRatio: drift.productivityDriftRaw + 1, // convert back to ratio
  };
}

// ─── Helpers ────────────────────────────────────────────────

function normalizeMetric(value: number, min: number, max: number): number {
  const clamped = Math.min(Math.max(value, min), max);
  return ((clamped - min) / (max - min)) * 100;
}

function getNextFriday(from: Date): Date {
  const d = new Date(from);
  const day = d.getDay();
  const daysUntilFriday = day <= 5 ? 5 - day : 0;
  d.setDate(d.getDate() + daysUntilFriday);
  return d;
}
