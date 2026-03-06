// Intelligence API — predictive analytics and risk scoring
// Returns projected-at-completion, burn rates, risk scores, and anomalies

import { NextRequest } from 'next/server';
import { fetchAllProjectData, fetchProjectList, fetchProjectHealthData } from '@/lib/airtable';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('projectId');

  try {
    if (projectId) {
      // Single project predictive analytics
      const prediction = await computeProjectPrediction(projectId);
      return Response.json(prediction);
    } else {
      // Portfolio-level intelligence (all projects for this org)
      const portfolio = await computePortfolioIntelligence(session.orgId);
      return Response.json(portfolio);
    }
  } catch (err) {
    console.error('Intelligence API error:', err);
    return Response.json(
      { error: 'Failed to compute intelligence', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 }
    );
  }
}

// ─── Single Project Predictions ──────────────────────────────

async function computeProjectPrediction(projectId: string) {
  const data = await fetchAllProjectData(projectId);
  if (!data.project) {
    return { error: 'Project not found' };
  }

  const p = data.project;
  const contractValue = Number(p['Contract Value'] || 0);
  const revisedBudget = Number(p['Revised Budget'] || contractValue);
  const jobToDate = Number(p['Job to Date'] || 0);
  const rawPercent = Number(p['Percent Complete Cost'] || 0);
  const percentComplete = rawPercent > 0 && rawPercent <= 1 ? rawPercent * 100 : rawPercent;

  // ─── Estimate at Completion (EAC) ─────────────
  // EAC = JTD / (% Complete / 100) — extrapolates current spend rate to 100%
  const eac = percentComplete > 5
    ? (jobToDate / percentComplete) * 100
    : revisedBudget; // Not enough data to predict if < 5% complete

  const eacVariance = eac - revisedBudget;
  const eacVariancePercent = revisedBudget > 0 ? (eacVariance / revisedBudget) * 100 : 0;

  // ─── Burn Rate ────────────────────────────────
  // Cost per percentage point of completion
  const burnRate = percentComplete > 0 ? jobToDate / percentComplete : 0;
  // Expected burn rate (if on budget)
  const expectedBurnRate = revisedBudget / 100;
  // Burn multiplier: >1 means spending faster than planned
  const burnMultiplier = expectedBurnRate > 0 ? burnRate / expectedBurnRate : 1;

  // ─── Budget at Risk ───────────────────────────
  // How much $ will be over/under at completion based on current trajectory
  const budgetAtRisk = Math.max(0, eac - revisedBudget);
  const budgetRemaining = revisedBudget - jobToDate;
  const workRemaining = 100 - percentComplete;
  // Cost to complete at current burn rate
  const costToComplete = burnRate * workRemaining;
  // Can you finish with remaining budget?
  const budgetSufficiency = budgetRemaining > 0 ? costToComplete / budgetRemaining : Infinity;

  // ─── Labor Predictions ────────────────────────
  const totalBudgetHrs = data.production.reduce(
    (sum, pr) => sum + Number(pr['Budget Labor Hours'] || 0), 0
  );
  const totalActualHrs = data.production.reduce(
    (sum, pr) => sum + Number(pr['Actual Labor Hours'] || 0), 0
  );
  const laborRatio = totalBudgetHrs > 0 ? totalActualHrs / totalBudgetHrs : 0;

  // Project total labor hours at completion
  const laborEAC = percentComplete > 5
    ? (totalActualHrs / percentComplete) * 100
    : totalBudgetHrs;
  const laborVariance = laborEAC - totalBudgetHrs;

  // ─── Cost Code Risk Analysis ──────────────────
  const costCodeRisks = data.jobCosts
    .map((jc) => {
      const budget = Number(jc['Revised Budget'] || jc['Budget'] || 0);
      const actual = Number(jc['Job to Date'] || jc['Actual'] || 0);
      const variance = actual - budget;
      const variancePct = budget > 0 ? (variance / budget) * 100 : 0;
      const code = String(jc['Item Code'] || jc['Cost Code'] || '');
      const description = String(jc['Item Description'] || jc['Description'] || code);

      // Risk level based on how far over budget
      let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
      if (variancePct > 25) riskLevel = 'critical';
      else if (variancePct > 15) riskLevel = 'high';
      else if (variancePct > 5) riskLevel = 'medium';

      return {
        code,
        description,
        budget,
        actual,
        variance,
        variancePercent: variancePct,
        riskLevel,
        // Projected at completion for this cost code
        projectedTotal: percentComplete > 5 ? (actual / percentComplete) * 100 : budget,
      };
    })
    .filter((cc) => cc.budget > 0)
    .sort((a, b) => b.variancePercent - a.variancePercent);

  // ─── Production Anomalies ─────────────────────
  const productionAnomalies = data.production
    .map((pr) => {
      const budgetHrs = Number(pr['Budget Labor Hours'] || 0);
      const actualHrs = Number(pr['Actual Labor Hours'] || 0);
      const ratio = budgetHrs > 0 ? actualHrs / budgetHrs : 0;
      const code = String(pr['Cost Code'] || '');
      const description = String(pr['Activity Description'] || pr['Description'] || code);

      return {
        code,
        description,
        budgetHours: budgetHrs,
        actualHours: actualHrs,
        performanceRatio: ratio,
        projectedTotalHours: percentComplete > 5 ? (actualHrs / percentComplete) * 100 : budgetHrs,
        isAnomaly: ratio > 1.25 || ratio < 0.5, // 25%+ deviation is anomalous
        anomalyType: ratio > 1.25 ? 'overrun' : ratio < 0.5 ? 'underutilized' : 'normal',
      };
    })
    .filter((p) => p.budgetHours > 0);

  // ─── Change Order Exposure ────────────────────
  const pendingCOs = data.changeOrders.filter((co) => {
    const status = String(co['Approval Status'] || '').toLowerCase();
    return status.includes('pending') || status.includes('submitted') || status.includes('review');
  });
  const pendingCOExposure = pendingCOs.reduce(
    (sum, co) => sum + Number(co['GC Proposed Amount'] || 0), 0
  );
  const totalCOValue = data.changeOrders.reduce(
    (sum, co) => sum + Number(co['GC Proposed Amount'] || 0), 0
  );

  // ─── Composite Risk Score (0-100, higher = more risk) ──
  let riskScore = 0;

  // Budget trajectory risk (0-30 points)
  if (eacVariancePercent > 20) riskScore += 30;
  else if (eacVariancePercent > 10) riskScore += 20;
  else if (eacVariancePercent > 5) riskScore += 10;
  else if (eacVariancePercent > 0) riskScore += 5;

  // Labor performance risk (0-25 points)
  const laborOverPct = (laborRatio - 1) * 100;
  if (laborOverPct > 25) riskScore += 25;
  else if (laborOverPct > 15) riskScore += 18;
  else if (laborOverPct > 5) riskScore += 10;
  else if (laborOverPct > 0) riskScore += 3;

  // Pending CO risk (0-20 points)
  const coRatio = contractValue > 0 ? pendingCOExposure / contractValue : 0;
  if (coRatio > 0.1) riskScore += 20;
  else if (coRatio > 0.05) riskScore += 12;
  else if (coRatio > 0.02) riskScore += 6;

  // Cost code concentration risk (0-15 points)
  const criticalCodes = costCodeRisks.filter((cc) => cc.riskLevel === 'critical');
  riskScore += Math.min(15, criticalCodes.length * 5);

  // Budget sufficiency risk (0-10 points)
  if (budgetSufficiency > 1.3) riskScore += 10;
  else if (budgetSufficiency > 1.1) riskScore += 5;

  riskScore = Math.min(100, riskScore);

  const riskLevel = riskScore >= 70 ? 'critical' : riskScore >= 40 ? 'high' : riskScore >= 20 ? 'medium' : 'low';

  return {
    projectId,
    projectName: String(p['Project Name'] || projectId),
    percentComplete,

    // Predictions
    estimateAtCompletion: eac,
    eacVariance,
    eacVariancePercent,
    budgetAtRisk,
    costToComplete,
    budgetRemaining,
    budgetSufficiency,

    // Burn rate
    burnRate,
    expectedBurnRate,
    burnMultiplier,

    // Labor
    laborEAC,
    laborVariance,
    totalBudgetHours: totalBudgetHrs,
    totalActualHours: totalActualHrs,
    laborRatio,

    // Risk
    riskScore,
    riskLevel,

    // Change orders
    pendingCOExposure,
    totalCOValue,
    pendingCOCount: pendingCOs.length,

    // Details
    costCodeRisks: costCodeRisks.slice(0, 10),
    productionAnomalies: productionAnomalies.filter((p) => p.isAnomaly),
    topRisks: generateRiskNarrative(riskScore, eacVariancePercent, laborOverPct, pendingCOExposure, criticalCodes.length, contractValue),
  };
}

// ─── Portfolio Intelligence ──────────────────────────────────

async function computePortfolioIntelligence(orgId: string) {
  const healthData = await fetchProjectHealthData(orgId);

  if (healthData.length === 0) {
    return { projects: [], insights: [], portfolioRisk: 'low', totalExposure: 0 };
  }

  // Get detailed predictions for each active project
  const activeProjects = healthData.filter(
    (p) => !p.status.toLowerCase().includes('complete') && !p.status.toLowerCase().includes('closed')
  );

  const predictions = await Promise.allSettled(
    activeProjects.map((p) => computeProjectPrediction(p.projectId))
  );

  const projectPredictions = predictions
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof computeProjectPrediction>>> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((p): p is Exclude<typeof p, { error: string }> => !('error' in p));

  // Portfolio-level metrics
  const totalContractValue = activeProjects.reduce((sum, p) => sum + p.contractValue, 0);
  const totalJTD = activeProjects.reduce((sum, p) => sum + p.jobToDate, 0);
  const totalEAC = projectPredictions.reduce((sum, p) => sum + (p.estimateAtCompletion || 0), 0);
  const totalBudget = projectPredictions.reduce((sum, p) => sum + (p.budgetRemaining || 0), 0);
  const totalBudgetAtRisk = projectPredictions.reduce((sum, p) => sum + (p.budgetAtRisk || 0), 0);
  const totalPendingCO = projectPredictions.reduce((sum, p) => sum + (p.pendingCOExposure || 0), 0);

  // Cross-project patterns
  const insights: Array<{ type: string; severity: string; message: string; projects: string[] }> = [];

  // Find projects with worst trajectories
  const atRiskProjects = projectPredictions
    .filter((p) => p.riskScore >= 40)
    .sort((a, b) => b.riskScore - a.riskScore);

  if (atRiskProjects.length > 0) {
    insights.push({
      type: 'risk',
      severity: atRiskProjects[0].riskScore >= 70 ? 'critical' : 'warning',
      message: `${atRiskProjects.length} project${atRiskProjects.length > 1 ? 's' : ''} at elevated risk — combined $${Math.round(atRiskProjects.reduce((s, p) => s + (p.budgetAtRisk || 0), 0) / 1000)}K budget exposure`,
      projects: atRiskProjects.map((p) => p.projectName),
    });
  }

  // Find labor overrun pattern
  const laborOverrunProjects = projectPredictions.filter((p) => p.laborRatio > 1.1);
  if (laborOverrunProjects.length > 1) {
    const avgOver = laborOverrunProjects.reduce((sum, p) => sum + (p.laborRatio - 1) * 100, 0) / laborOverrunProjects.length;
    insights.push({
      type: 'pattern',
      severity: avgOver > 20 ? 'critical' : 'warning',
      message: `Labor overruns detected across ${laborOverrunProjects.length} projects — averaging ${avgOver.toFixed(0)}% over budgeted hours`,
      projects: laborOverrunProjects.map((p) => p.projectName),
    });
  }

  // Find projects with high burn multipliers
  const fastBurners = projectPredictions.filter((p) => p.burnMultiplier > 1.15);
  if (fastBurners.length > 0) {
    insights.push({
      type: 'trend',
      severity: 'warning',
      message: `${fastBurners.length} project${fastBurners.length > 1 ? 's' : ''} spending faster than planned — budget will run out before completion at current rate`,
      projects: fastBurners.map((p) => p.projectName),
    });
  }

  // Pending CO exposure
  if (totalPendingCO > 50000) {
    insights.push({
      type: 'exposure',
      severity: totalPendingCO > 200000 ? 'critical' : 'warning',
      message: `$${Math.round(totalPendingCO / 1000)}K in pending change orders across portfolio — risk of scope creep without approval`,
      projects: projectPredictions.filter((p) => (p.pendingCOExposure || 0) > 0).map((p) => p.projectName),
    });
  }

  // Portfolio health
  const avgRisk = projectPredictions.length > 0
    ? projectPredictions.reduce((sum, p) => sum + p.riskScore, 0) / projectPredictions.length
    : 0;
  const portfolioRisk = avgRisk >= 60 ? 'critical' : avgRisk >= 35 ? 'high' : avgRisk >= 15 ? 'medium' : 'low';

  return {
    portfolio: {
      totalContractValue,
      totalJobToDate: totalJTD,
      totalEstimateAtCompletion: totalEAC,
      totalBudgetAtRisk: totalBudgetAtRisk,
      totalPendingCOExposure: totalPendingCO,
      activeProjectCount: activeProjects.length,
      averageRiskScore: avgRisk,
      portfolioRisk,
    },
    projects: projectPredictions.map((p) => ({
      projectId: p.projectId,
      projectName: p.projectName,
      percentComplete: p.percentComplete,
      estimateAtCompletion: p.estimateAtCompletion,
      eacVariancePercent: p.eacVariancePercent,
      budgetAtRisk: p.budgetAtRisk,
      burnMultiplier: p.burnMultiplier,
      laborRatio: p.laborRatio,
      riskScore: p.riskScore,
      riskLevel: p.riskLevel,
      pendingCOExposure: p.pendingCOExposure,
    })),
    insights,
  };
}

// ─── Risk Narrative Generator ────────────────────────────────

function generateRiskNarrative(
  riskScore: number,
  eacVariancePct: number,
  laborOverPct: number,
  pendingCOExposure: number,
  criticalCodes: number,
  contractValue: number,
): string[] {
  const risks: string[] = [];

  if (eacVariancePct > 10) {
    risks.push(`Project is tracking ${eacVariancePct.toFixed(0)}% over budget at current trajectory`);
  } else if (eacVariancePct > 5) {
    risks.push(`Budget trending ${eacVariancePct.toFixed(0)}% over — early warning`);
  }

  if (laborOverPct > 15) {
    risks.push(`Labor hours ${laborOverPct.toFixed(0)}% over budget — productivity issue`);
  } else if (laborOverPct > 5) {
    risks.push(`Labor hours slightly over budget (${laborOverPct.toFixed(0)}%) — monitor closely`);
  }

  if (pendingCOExposure > 50000) {
    const pct = contractValue > 0 ? (pendingCOExposure / contractValue * 100).toFixed(1) : '?';
    risks.push(`$${Math.round(pendingCOExposure / 1000)}K pending COs (${pct}% of contract) awaiting approval`);
  }

  if (criticalCodes > 2) {
    risks.push(`${criticalCodes} cost codes in critical overrun territory (>25% over budget)`);
  }

  if (risks.length === 0) {
    risks.push('No significant risk factors detected — project is tracking well');
  }

  return risks;
}
