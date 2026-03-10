// Dashboard API — returns chart-ready aggregated project data
// for the visual analytics dashboard.

import { NextRequest } from 'next/server';
import { fetchAllProjectData, verifyProjectAccess } from '@/lib/supabase';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  // Auth
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('projectId');

  if (!projectId) {
    return Response.json({ error: 'projectId required' }, { status: 400 });
  }

  try {
    const data = await fetchAllProjectData(projectId);

    // ─── Budget Overview ─────────────────────────────
    const contractValue = Number(data.project?.['Contract Value'] || 0);
    const revisedBudget = Number(data.project?.['Revised Budget'] || contractValue);
    const jobToDate = Number(data.project?.['Job to Date'] || 0);
    const rawPercent = Number(data.project?.['Percent Complete Cost'] || 0);
    const percentComplete = rawPercent > 0 && rawPercent <= 1 ? rawPercent * 100 : rawPercent;
    const totalCOValue = Number(data.project?.['Total COs'] || 0);

    const budgetOverview = {
      contractValue,
      revisedBudget,
      jobToDate,
      percentComplete,
      totalCOValue,
      budgetRemaining: revisedBudget - jobToDate,
      budgetVariance: revisedBudget - jobToDate,
      budgetVariancePercent: revisedBudget > 0 ? ((jobToDate - revisedBudget) / revisedBudget) * 100 : 0,
    };

    // ─── Cost Codes (Budget vs Actual bar chart) ──────
    const costCodes = data.jobCosts.map((jc) => {
      const budget = Number(jc['Budget'] || jc['Contract Budget'] || jc['Revised Budget'] || 0);
      const actual = Number(jc['Actual'] || jc['JTD Cost'] || jc['Job to Date'] || 0);
      const variance = actual - budget;
      const code = String(jc['Item Code'] || jc['Cost Code'] || '');
      const description = String(jc['Item Description'] || jc['Description'] || code);

      return {
        code,
        description,
        budget,
        actual,
        variance,
        variancePercent: budget > 0 ? (variance / budget) * 100 : 0,
        status: variance > 0 ? 'over' : variance < 0 ? 'under' : 'on_track',
      };
    }).sort((a, b) => {
      // Sort by cost code number
      const numA = parseInt(a.code) || 0;
      const numB = parseInt(b.code) || 0;
      return numA - numB;
    });

    // ─── Production Metrics ───────────────────────────
    const production = data.production.map((pr) => {
      const budgetHrs = Number(pr['Budget Labor Hours'] || 0);
      const actualHrs = Number(pr['Actual Labor Hours'] || 0);
      const hoursRemaining = Number(pr['Hours to Complete'] || pr['Hrs Remaining'] || (budgetHrs - actualHrs));
      const ratio = budgetHrs > 0 ? actualHrs / budgetHrs : 0;
      const code = String(pr['Cost Code'] || '');
      const description = String(pr['Activity Description'] || pr['Description'] || code);

      return {
        code,
        description,
        budgetHours: budgetHrs,
        actualHours: actualHrs,
        hoursRemaining,
        performanceRatio: ratio,
        status: ratio > 1.15 ? 'critical' : ratio > 1.0 ? 'warning' : 'healthy',
      };
    }).sort((a, b) => b.performanceRatio - a.performanceRatio); // Worst first

    // Totals
    const totalBudgetHrs = production.reduce((sum, p) => sum + p.budgetHours, 0);
    const totalActualHrs = production.reduce((sum, p) => sum + p.actualHours, 0);
    const overallLaborRatio = totalBudgetHrs > 0 ? totalActualHrs / totalBudgetHrs : 0;

    // ─── Change Orders ────────────────────────────────
    const changeOrders = data.changeOrders.map((co) => {
      const amount = Number(co['GC Proposed Amount'] || co['Owner Approved Amount'] || 0);
      const approvedAmount = Number(co['Owner Approved Amount'] || 0);
      const approvalStatus = String(co['Approval Status'] || 'Unknown');
      const coId = String(co['CO ID'] || '');
      const scope = String(co['Scope Description'] || co['Scope'] || '');
      const dateSubmitted = String(co['Date Submitted'] || '');

      return {
        coId,
        scope,
        proposedAmount: amount,
        approvedAmount,
        approvalStatus,
        dateSubmitted,
        isPending: approvalStatus.toLowerCase().includes('pending') ||
                   approvalStatus.toLowerCase().includes('submitted') ||
                   approvalStatus.toLowerCase().includes('review'),
      };
    });

    const totalCOProposed = changeOrders.reduce((sum, co) => sum + co.proposedAmount, 0);
    const totalCOApproved = changeOrders.reduce((sum, co) => sum + co.approvedAmount, 0);
    const pendingCOs = changeOrders.filter((co) => co.isPending);
    const pendingCOAmount = pendingCOs.reduce((sum, co) => sum + co.proposedAmount, 0);

    // ─── Health Score (0-100) ─────────────────────────
    let healthScore = 100;

    // Budget impact: -20 for critical, -10 for warning
    const budgetPctOver = budgetOverview.budgetVariancePercent;
    if (budgetPctOver > 15) healthScore -= 25;
    else if (budgetPctOver > 5) healthScore -= 12;
    else if (budgetPctOver > 0) healthScore -= 5;

    // Labor impact
    const laborPctOver = (overallLaborRatio - 1) * 100;
    if (laborPctOver > 25) healthScore -= 25;
    else if (laborPctOver > 10) healthScore -= 12;
    else if (laborPctOver > 0) healthScore -= 5;

    // CO impact
    if (pendingCOAmount > 100000) healthScore -= 10;
    else if (pendingCOAmount > 50000) healthScore -= 5;

    // Over-budget cost codes penalty
    const overBudgetCodes = costCodes.filter((cc) => cc.variancePercent > 10);
    healthScore -= Math.min(20, overBudgetCodes.length * 3);

    healthScore = Math.max(0, Math.min(100, healthScore));

    const healthStatus = healthScore >= 80 ? 'healthy' : healthScore >= 60 ? 'warning' : 'critical';

    // ─── Alerts ───────────────────────────────────────
    const alerts: Array<{ type: string; severity: string; message: string }> = [];

    // Top over-budget cost codes
    const topOverBudget = costCodes
      .filter((cc) => cc.variance > 0)
      .sort((a, b) => b.variance - a.variance)
      .slice(0, 3);

    for (const cc of topOverBudget) {
      const amt = Math.abs(cc.variance);
      const formatted = amt >= 1000 ? `$${(amt / 1000).toFixed(0)}K` : `$${amt.toFixed(0)}`;
      alerts.push({
        type: 'budget',
        severity: cc.variancePercent > 20 ? 'critical' : 'warning',
        message: `${cc.code} ${cc.description} is ${formatted} over budget (${cc.variancePercent.toFixed(0)}%)`,
      });
    }

    // Labor alerts
    const criticalLabor = production.filter((p) => p.status === 'critical');
    for (const p of criticalLabor.slice(0, 2)) {
      const overPct = ((p.performanceRatio - 1) * 100).toFixed(0);
      alerts.push({
        type: 'labor',
        severity: 'critical',
        message: `${p.code} ${p.description}: ${overPct}% over budgeted hours (ratio: ${p.performanceRatio.toFixed(2)})`,
      });
    }

    // Pending CO alert
    if (pendingCOs.length > 0) {
      const formatted = pendingCOAmount >= 1000 ? `$${(pendingCOAmount / 1000).toFixed(0)}K` : `$${pendingCOAmount.toFixed(0)}`;
      alerts.push({
        type: 'change_order',
        severity: pendingCOAmount > 50000 ? 'warning' : 'info',
        message: `${pendingCOs.length} pending CO${pendingCOs.length > 1 ? 's' : ''} totaling ${formatted}`,
      });
    }

    // ─── Staffing ─────────────────────────────────────
    const staffing = data.staffing
      .filter((s) => s['Active'])
      .map((s) => ({
        name: String(s['Name'] || ''),
        role: String(s['Role'] || ''),
      }));

    return Response.json({
      projectId,
      projectName: String(data.project?.['Project Name'] || projectId),
      projectStatus: String(data.project?.['Project Status'] || ''),
      budgetOverview,
      costCodes,
      production: {
        items: production,
        totalBudgetHours: totalBudgetHrs,
        totalActualHours: totalActualHrs,
        overallRatio: overallLaborRatio,
      },
      changeOrders: {
        items: changeOrders,
        totalProposed: totalCOProposed,
        totalApproved: totalCOApproved,
        pendingCount: pendingCOs.length,
        pendingAmount: pendingCOAmount,
      },
      healthScore,
      healthStatus,
      alerts,
      staffing,
      recordCounts: data.meta.recordCounts,
    });
  } catch (err) {
    console.error('Dashboard API error:', err);
    return Response.json(
      { error: 'Failed to load dashboard data', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 }
    );
  }
}
