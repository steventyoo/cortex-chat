// Cross-Project AI Insights API
// Uses Claude to analyze patterns across all projects and generate intelligence

import { NextRequest } from 'next/server';
import { fetchProjectHealthData, fetchAllProjectData } from '@/lib/airtable';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. Get all projects for this org
    const healthData = await fetchProjectHealthData(session.orgId);
    const activeProjects = healthData.filter(
      (p) => !p.status.toLowerCase().includes('complete') && !p.status.toLowerCase().includes('closed')
    );

    if (activeProjects.length === 0) {
      return Response.json({ insights: [], message: 'No active projects' });
    }

    // 2. Fetch detailed data for all active projects in parallel
    const detailedData = await Promise.allSettled(
      activeProjects.map((p) => fetchAllProjectData(p.projectId))
    );

    const allProjectData = detailedData
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchAllProjectData>>> => r.status === 'fulfilled')
      .map((r) => r.value);

    // 3. Build a cross-project summary for Claude
    const crossProjectContext = buildCrossProjectContext(allProjectData);

    // 4. Ask Claude to find patterns and anomalies
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: `You are Cortex Intelligence, an AI that analyzes construction project portfolios to find cross-project patterns, anomalies, and actionable insights.

Rules:
- Return ONLY valid JSON (no markdown, no code fences)
- Focus on patterns that span MULTIPLE projects — not single-project issues
- Prioritize insights that save money or prevent problems
- Be specific with numbers and project names
- Each insight should be actionable — tell the PM what to DO about it

Return this JSON structure:
{
  "insights": [
    {
      "type": "pattern" | "anomaly" | "prediction" | "recommendation",
      "severity": "critical" | "warning" | "info",
      "title": "Short title (under 60 chars)",
      "detail": "1-2 sentence explanation with specific numbers",
      "projects": ["Project Name 1", "Project Name 2"],
      "action": "What the PM should do about this"
    }
  ],
  "portfolioSummary": "2-3 sentence executive summary of portfolio health"
}`,
      messages: [{
        role: 'user',
        content: `Analyze this construction portfolio for cross-project patterns, anomalies, and predictions:\n\n${crossProjectContext}`,
      }],
    });

    const responseText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');

    let parsed;
    try {
      let jsonStr = responseText.trim();
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) jsonStr = jsonMatch[1].trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      parsed = { insights: [], portfolioSummary: 'Unable to parse AI response' };
    }

    return Response.json(parsed);
  } catch (err) {
    console.error('Insights API error:', err);
    return Response.json(
      { error: 'Failed to generate insights', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 }
    );
  }
}

function buildCrossProjectContext(projects: Awaited<ReturnType<typeof fetchAllProjectData>>[]): string {
  const lines: string[] = [];

  lines.push(`PORTFOLIO: ${projects.length} active projects\n`);

  for (const data of projects) {
    if (!data.project) continue;
    const p = data.project;
    const projectName = String(p['Project Name'] || p['Project ID']);
    const contractValue = Number(p['Contract Value'] || 0);
    const revisedBudget = Number(p['Revised Budget'] || contractValue);
    const jobToDate = Number(p['Job to Date'] || 0);
    const rawPct = Number(p['Percent Complete Cost'] || 0);
    const pctComplete = rawPct > 0 && rawPct <= 1 ? rawPct * 100 : rawPct;

    lines.push(`--- PROJECT: ${projectName} ---`);
    lines.push(`Contract: $${contractValue.toLocaleString()} | Budget: $${revisedBudget.toLocaleString()} | JTD: $${jobToDate.toLocaleString()} | ${pctComplete.toFixed(0)}% complete`);

    // Job costs summary
    if (data.jobCosts.length > 0) {
      const overBudget = data.jobCosts.filter((jc) => {
        const budget = Number(jc['Revised Budget'] || jc['Budget'] || 0);
        const actual = Number(jc['Job to Date'] || jc['Actual'] || 0);
        return actual > budget && budget > 0;
      });
      lines.push(`Cost codes: ${data.jobCosts.length} total, ${overBudget.length} over budget`);

      // Top 3 worst cost codes
      const worst = data.jobCosts
        .map((jc) => {
          const budget = Number(jc['Revised Budget'] || jc['Budget'] || 0);
          const actual = Number(jc['Job to Date'] || jc['Actual'] || 0);
          return {
            code: String(jc['Item Code'] || ''),
            desc: String(jc['Item Description'] || ''),
            budget, actual,
            variance: actual - budget,
            pct: budget > 0 ? ((actual - budget) / budget) * 100 : 0,
          };
        })
        .filter((x) => x.budget > 0)
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 3);

      for (const w of worst) {
        if (w.variance > 0) {
          lines.push(`  ${w.code} ${w.desc}: ${w.pct.toFixed(0)}% over ($${w.variance.toLocaleString()})`);
        }
      }
    }

    // Production summary
    if (data.production.length > 0) {
      const totalBudgetHrs = data.production.reduce((s, pr) => s + Number(pr['Budget Labor Hours'] || 0), 0);
      const totalActualHrs = data.production.reduce((s, pr) => s + Number(pr['Actual Labor Hours'] || 0), 0);
      const ratio = totalBudgetHrs > 0 ? totalActualHrs / totalBudgetHrs : 0;
      lines.push(`Labor: ${totalActualHrs.toLocaleString()} / ${totalBudgetHrs.toLocaleString()} hrs (ratio: ${ratio.toFixed(2)})`);

      // Anomalous activities
      const anomalies = data.production.filter((pr) => {
        const b = Number(pr['Budget Labor Hours'] || 0);
        const a = Number(pr['Actual Labor Hours'] || 0);
        return b > 0 && (a / b > 1.25 || a / b < 0.5);
      });
      if (anomalies.length > 0) {
        for (const a of anomalies.slice(0, 2)) {
          const b = Number(a['Budget Labor Hours'] || 0);
          const act = Number(a['Actual Labor Hours'] || 0);
          const r = b > 0 ? act / b : 0;
          lines.push(`  ANOMALY ${a['Cost Code']} ${a['Activity Description']}: ratio ${r.toFixed(2)}`);
        }
      }
    }

    // Change orders
    if (data.changeOrders.length > 0) {
      const totalCO = data.changeOrders.reduce((s, co) => s + Number(co['GC Proposed Amount'] || 0), 0);
      const pending = data.changeOrders.filter((co) => {
        const status = String(co['Approval Status'] || '').toLowerCase();
        return status.includes('pending') || status.includes('submitted');
      });
      const pendingAmt = pending.reduce((s, co) => s + Number(co['GC Proposed Amount'] || 0), 0);
      lines.push(`COs: ${data.changeOrders.length} total ($${totalCO.toLocaleString()}), ${pending.length} pending ($${pendingAmt.toLocaleString()})`);
    }

    lines.push('');
  }

  return lines.join('\n');
}
