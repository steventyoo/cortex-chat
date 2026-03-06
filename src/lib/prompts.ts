import { ProjectData } from './types';

export const CORTEX_SYSTEM_PROMPT = `You are Cortex, an AI construction data analyst for OWP (a mechanical/plumbing subcontractor).

## How You Respond
- Be data-forward. Lead with tables and numbers, not prose.
- Use construction terminology naturally (COR, PCO, ASI, CSI, O&P, JTD).
- Never fabricate data. If a table is empty, say so.
- Use emoji status indicators in tables: 🔴 for over budget / behind, ✅ for under budget / on track, ⚠️ for warnings.
- Bold important rows (like PROJECT TOTAL or worst performers).
- Keep currency as $XXK or $X,XXX format. Keep percentages as whole numbers (84%, not 84.0%).

## CRITICAL: Summary Format
When the user asks for a "summary", "overview", or general project question, you MUST use this EXACT structure:

### Section 1: Title
Start with: **OWP — [Project Name] Summary**

### Section 2: PROJECTS table
Header: **PROJECTS**
Show a 2-column table (Field | Value) with:
- Contract Value
- Job to Date
- Total COs
- % Complete

### Section 3: JOB_COSTS table
Header: **JOB_COSTS (X line items from Job Report)**
Text: **Key variances flagged:**
Show a table with columns: Item | Budget | Actual | % | Flag
- Show the top 3-5 most significant variances (over AND under budget)
- Use 🔴 Over for items over budget, ✅ Under for items under budget
- Use $XXK format for dollar amounts

### Section 4: PRODUCTION table
Header: **PRODUCTION (X cost code groups from M3 Hours)**
Show a table with columns: Activity | Perf. Ratio | Status
- List all production cost codes
- Use ✅ Above Expected, 🔴 Below Expected, or **🔴 Significantly Behind** (bold) for worst
- Include a **PROJECT TOTAL** row at bottom with ⚠️ X% over hours

### Section 5: CHANGE_ORDERS
Header: **CHANGE_ORDERS (X records)**
Show a table with columns: CO ID | Scope | Amount | Status | Triggered By
- List all change orders
- Show GC Proposed amounts

### Section 6: Records summary
Header: **Records across all tables:**
Bullet list showing:
- **PROJECTS**: X record
- **DOCUMENTS**: X records (list doc names)
- **CHANGE_ORDERS**: X records (total $ sum)
- **JOB_COSTS**: X records
- **PRODUCTION**: X records
- **DESIGN_CHANGES**: X records (list doc IDs)
- **CROSS_REFS**: X records (show chain like ASI-04 → COR-06)
- **LABELING_LOG**: X records

## For Non-Summary Questions
When asked about specific topics (not a general summary):
- **Change orders**: Break down by type, status, CSI division, initiating party. Show the money trail.
- **Budget/costs**: Compare budget vs actuals, show variance by category with 🔴/✅ flags
- **Production/labor**: Show performance ratios, identify problem areas with emoji indicators
- **Design changes**: Trace ASI → COR → CO chains, show cost impact
- **Document chains**: Use CROSS_REFS to trace cause-and-effect

Still use tables with emoji indicators for all responses. Be concise — data first, brief analysis after.

## Cross-Project / Portfolio Questions
When the user asks about multiple projects, portfolio health, or cross-project patterns:
- Show a comparison table with all projects: Project | Contract | JTD | % Complete | EAC | Risk | Flags
- EAC (Estimate at Completion) = JTD / (% Complete / 100)
- Budget at Risk = EAC - Revised Budget
- Burn Multiplier = (JTD / % Complete) / (Budget / 100) — if >1, spending faster than planned
- Identify cross-project PATTERNS: same cost codes overrunning across projects, labor trends, CO exposure
- Lead with the scariest number — what's the total $ at risk across the portfolio
- End with 2-3 specific ACTIONS the PM should take this week`;

export function assembleContext(data: ProjectData): string {
  const lines: string[] = [];

  // Project Overview
  if (data.project) {
    const p = data.project;
    lines.push('## PROJECT OVERVIEW');
    lines.push(`- Project ID: ${p['Project ID']}`);
    lines.push(`- Job Number: ${p['Job Number']}`);
    lines.push(`- Project Name: ${p['Project Name']}`);
    lines.push(`- Client/Owner: ${p['Client Owner']}`);
    lines.push(`- GC Prime: ${p['GC Prime']}`);
    lines.push(`- Project Type: ${p['Project Type']}`);
    lines.push(`- Building Type: ${p['Building Type']}`);
    lines.push(`- Contract Value: $${Number(p['Contract Value'] || 0).toLocaleString()}`);
    lines.push(`- Revised Budget: $${Number(p['Revised Budget'] || 0).toLocaleString()}`);
    lines.push(`- Job to Date: $${Number(p['Job to Date'] || 0).toLocaleString()}`);
    lines.push(`- Total COs: $${Number(p['Total COs'] || 0).toLocaleString()}`);
    lines.push(`- Total Units: ${p['Total Units']}`);
    lines.push(`- Percent Complete (Cost): ${p['Percent Complete Cost']}%`);
    lines.push(`- Project Status: ${p['Project Status']}`);
    lines.push(`- Start Date: ${p['Start Date']}`);
    lines.push(`- Substantial Completion: ${p['Substantial Completion']}`);
    lines.push('');
  }

  // Change Orders
  lines.push(`## CHANGE ORDERS (${data.changeOrders.length} records)`);
  if (data.changeOrders.length > 0) {
    data.changeOrders.forEach((co) => {
      lines.push(`\n### ${co['CO ID']} | ${co['CO Type']} | Status: ${co['Approval Status']}`);
      lines.push(`- Scope: ${co['Scope Description']}`);
      lines.push(`- Date Submitted: ${co['Date Submitted']}`);
      lines.push(`- Triggering Doc: ${co['Triggering Doc Ref'] || 'None'}`);
      lines.push(`- Foreman: ${co['Foreman Hours']} hrs @ $${co['Foreman Rate']}/hr`);
      lines.push(`- Journeyman: ${co['Journeyman Hours']} hrs @ $${co['Journeyman Rate']}/hr`);
      lines.push(`- Mgmt: ${co['Mgmt Hours']} hrs @ $${co['Mgmt Rate']}/hr`);
      lines.push(`- Labor Subtotal: $${co['Labor Subtotal']}`);
      lines.push(`- Material Subtotal: $${co['Material Subtotal']}`);
      lines.push(`- Sub Tier Amount: $${co['Sub Tier Amount'] || 0}`);
      lines.push(`- OH&P Rate: ${co['OHP Rate']}`);
      lines.push(`- OH&P on Labor: $${co['OHP on Labor']}`);
      lines.push(`- OH&P on Material: $${co['OHP on Material']}`);
      lines.push(`- GC Proposed Amount: $${co['GC Proposed Amount']}`);
      lines.push(`- Owner Approved Amount: $${co['Owner Approved Amount'] || 'Pending'}`);
      lines.push(`- CSI Division: ${co['CSI Division Primary']}`);
      lines.push(`- Building System: ${co['Building System']}`);
      lines.push(`- Initiating Party: ${co['Initiating Party'] || 'Not labeled'}`);
      lines.push(`- Change Reason: ${co['Change Reason'] || 'Not labeled'}`);
      lines.push(`- Schedule Impact: ${co['Schedule Impact'] || 'Not labeled'}`);
      lines.push(`- Preventability: ${co['Preventability'] || 'Not labeled'}`);
      lines.push(`- Responsibility: ${co['Responsibility Attribution'] || 'Not labeled'}`);
      if (co['Raw Line Items JSON']) {
        lines.push(`- Raw Line Items: ${co['Raw Line Items JSON']}`);
      }
    });
    lines.push('');
  }

  // Job Costs
  lines.push(`\n## JOB COSTS (${data.jobCosts.length} line items)`);
  if (data.jobCosts.length > 0) {
    data.jobCosts.forEach((jc) => {
      lines.push(
        `- ${jc['Item Code']}: ${jc['Item Description']} | Cat: ${jc['Category']} | Budget: $${jc['Revised Budget']} | COs: $${jc['Change Orders']} | JTD: $${jc['Job to Date']} | ${jc['Pct of Budget']}% | Var: $${jc['Over Under']} (${jc['Variance Status']})`
      );
    });
    lines.push('');
  }

  // Production
  lines.push(`\n## PRODUCTION METRICS (${data.production.length} cost codes)`);
  if (data.production.length > 0) {
    data.production.forEach((pr) => {
      lines.push(
        `- ${pr['Cost Code']}: ${pr['Activity Description']} | Budget Hrs: ${pr['Budget Labor Hours']} | Actual Hrs: ${pr['Actual Labor Hours']} | Perf Ratio: ${pr['Performance Ratio']} | ${pr['Productivity Indicator']} | Hrs to Complete: ${pr['Hrs to Complete']}`
      );
    });
    lines.push('');
  }

  // Design Changes
  lines.push(`\n## DESIGN CHANGES (${data.designChanges.length} records)`);
  if (data.designChanges.length > 0) {
    data.designChanges.forEach((dc) => {
      lines.push(
        `- ${dc['Design Doc ID']}: ${dc['Document Type']} | ${dc['Description']} | Issued By: ${dc['Issued By']} | Cost Impact: ${dc['Cost Impact']} | Resulting COR/CO: ${dc['Resulting COR CO']}`
      );
    });
    lines.push('');
  }

  // Cross Refs
  lines.push(`\n## DOCUMENT RELATIONSHIPS (${data.crossRefs.length} links)`);
  if (data.crossRefs.length > 0) {
    data.crossRefs.forEach((cr) => {
      lines.push(
        `- ${cr['From Document']} -> ${cr['To Document']} | Type: ${cr['Relationship Type']} | Position: ${cr['Causal Chain Position']} | $${cr['Dollar Value Carried']}`
      );
    });
    lines.push('');
  }

  // Documents
  lines.push(`\n## DOCUMENTS (${data.documents.length} records)`);
  if (data.documents.length > 0) {
    data.documents.forEach((doc) => {
      lines.push(
        `- ${doc['Document ID']}: ${doc['Document Type']} | ${doc['Document Title']} | ${doc['Date on Document']} | Status: ${doc['Labeling Status']}`
      );
    });
    lines.push('');
  }

  // Staffing
  lines.push(`\n## STAFFING (${data.staffing.length} records)`);
  if (data.staffing.length > 0) {
    data.staffing.forEach((s) => {
      const active = s['Active'] ? 'ACTIVE' : 'INACTIVE';
      lines.push(
        `- ${s['Name']}: ${s['Role']} | ${s['Hours Per Week'] || '?'} hrs/week | Rate: $${s['Labor Rate'] || '?'}/hr | ${active} | ${s['Phone'] || ''} | ${s['Email'] || ''}`
      );
    });
    lines.push('');
  }

  // Record counts summary
  lines.push('\n## DATA COMPLETENESS');
  const counts = data.meta.recordCounts;
  lines.push(`- Change Orders: ${counts.changeOrders} records`);
  lines.push(`- Job Cost Items: ${counts.jobCosts} records`);
  lines.push(`- Production Codes: ${counts.production} records`);
  lines.push(`- Design Changes: ${counts.designChanges} records`);
  lines.push(`- Cross References: ${counts.crossRefs} records`);
  lines.push(`- Documents: ${counts.documents} records`);
  lines.push(`- Staffing: ${counts.staffing || 0} records`);

  return lines.join('\n');
}

import { ProjectHealth } from './types';

export function assemblePortfolioContext(
  allProjectData: ProjectData[],
  healthData: ProjectHealth[],
): string {
  const lines: string[] = [];

  lines.push('## PORTFOLIO OVERVIEW');
  lines.push(`Active projects: ${allProjectData.length}`);
  lines.push('');

  let totalContract = 0;
  let totalJTD = 0;
  let totalBudget = 0;

  for (const data of allProjectData) {
    if (!data.project) continue;
    const p = data.project;
    const name = String(p['Project Name'] || p['Project ID']);
    const contractValue = Number(p['Contract Value'] || 0);
    const revisedBudget = Number(p['Revised Budget'] || contractValue);
    const jobToDate = Number(p['Job to Date'] || 0);
    const rawPct = Number(p['Percent Complete Cost'] || 0);
    const pctComplete = rawPct > 0 && rawPct <= 1 ? rawPct * 100 : rawPct;
    const eac = pctComplete > 5 ? (jobToDate / pctComplete) * 100 : revisedBudget;
    const eacVariance = eac - revisedBudget;

    totalContract += contractValue;
    totalJTD += jobToDate;
    totalBudget += revisedBudget;

    lines.push(`### ${name}`);
    lines.push(`- Contract: $${contractValue.toLocaleString()} | Budget: $${revisedBudget.toLocaleString()}`);
    lines.push(`- JTD: $${jobToDate.toLocaleString()} | ${pctComplete.toFixed(0)}% complete`);
    lines.push(`- EAC: $${Math.round(eac).toLocaleString()} | Variance: $${Math.round(eacVariance).toLocaleString()}`);

    const totalBudgetHrs = data.production.reduce((s, pr) => s + Number(pr['Budget Labor Hours'] || 0), 0);
    const totalActualHrs = data.production.reduce((s, pr) => s + Number(pr['Actual Labor Hours'] || 0), 0);
    const laborRatio = totalBudgetHrs > 0 ? totalActualHrs / totalBudgetHrs : 0;
    lines.push(`- Labor: ${totalActualHrs.toLocaleString()} / ${totalBudgetHrs.toLocaleString()} hrs (ratio: ${laborRatio.toFixed(2)})`);

    const worstCodes = data.jobCosts
      .map((jc) => ({
        code: String(jc['Item Code'] || ''),
        desc: String(jc['Item Description'] || ''),
        budget: Number(jc['Revised Budget'] || jc['Budget'] || 0),
        actual: Number(jc['Job to Date'] || jc['Actual'] || 0),
      }))
      .filter((x) => x.budget > 0 && x.actual > x.budget)
      .sort((a, b) => (b.actual - b.budget) - (a.actual - a.budget))
      .slice(0, 3);

    if (worstCodes.length > 0) {
      lines.push('- Over-budget codes:');
      for (const wc of worstCodes) {
        const pct = ((wc.actual - wc.budget) / wc.budget * 100).toFixed(0);
        lines.push(`  - ${wc.code} ${wc.desc}: $${(wc.actual - wc.budget).toLocaleString()} over (${pct}%)`);
      }
    }

    if (data.changeOrders.length > 0) {
      const totalCO = data.changeOrders.reduce((s, co) => s + Number(co['GC Proposed Amount'] || 0), 0);
      const pending = data.changeOrders.filter((co) => {
        const status = String(co['Approval Status'] || '').toLowerCase();
        return status.includes('pending') || status.includes('submitted');
      });
      lines.push(`- COs: ${data.changeOrders.length} total ($${totalCO.toLocaleString()}), ${pending.length} pending`);
    }
    lines.push('');
  }

  if (healthData.length > 0) {
    lines.push('## PROJECT HEALTH SUMMARY');
    for (const h of healthData) {
      lines.push(`- ${h.projectName}: ${h.overallHealth.toUpperCase()} | Budget: ${h.budgetHealth} | Labor: ${h.laborHealth} | Pending COs: ${h.pendingCOs} ($${h.pendingCOAmount.toLocaleString()})`);
    }
    lines.push('');
  }

  lines.push('## PORTFOLIO TOTALS');
  lines.push(`- Total contract value: $${totalContract.toLocaleString()}`);
  lines.push(`- Total JTD spend: $${totalJTD.toLocaleString()}`);
  lines.push(`- Total budget: $${totalBudget.toLocaleString()}`);

  return lines.join('\n');
}
