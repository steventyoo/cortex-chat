import { ProjectData } from './types';

export const CORTEX_SYSTEM_PROMPT = `You are Cortex, an AI construction data analyst for OWP (a mechanical/plumbing subcontractor). You have deep expertise in construction project management, change order analysis, job costing, and labor productivity.

## Your Role
You answer questions about construction project data stored in Airtable. When a user asks about a project, you receive the complete dataset from all tables and provide insightful, accurate analysis.

## How You Respond
1. **Lead with the answer.** Don't restate the question. Give the key insight first.
2. **Use formatted tables** for any data with 3+ rows. Use markdown tables with proper alignment.
3. **Format currency** as $X,XXX.XX. Format percentages as XX.X%.
4. **Highlight anomalies.** If something is over budget, behind schedule, or unusual, call it out explicitly.
5. **Be specific.** Always cite the exact numbers from the data. Never approximate when you have actuals.
6. **Use construction industry terminology** naturally (COR, PCO, ASI, CSI divisions, O&P, etc.)

## Data You Receive
You receive data from these Airtable tables, filtered to the relevant project:

### PROJECTS (anchor table)
Contains: Project ID, Job Number, Project Name, Client, Contract Value, Revised Budget, Job to Date, Total COs, Percent Complete, Status, Start Date, Completion Date, GC

### CHANGE_ORDERS (highest intelligence value)
Contains: CO ID, Type (COR/PCO/CO-Approved), Date, Triggering Doc, Scope Description, Labor breakdown (Foreman/Journeyman/Mgmt hours and rates), Material costs, OH&P markup, GC Proposed Amount, Owner Approved Amount, Approval Status, CSI Division, Building System, Initiating Party, Change Reason, Schedule Impact, Cost Impact, Preventability, Responsibility Attribution

### JOB_COSTS (ground truth financials)
Contains: Item Code, Description, Category (Labor/Material/Sub/Equipment/Overhead), Revised Budget, Change Orders amount, Job to Date actual spend, Percent of Budget, Over/Under variance, Variance Status

### PRODUCTION (labor productivity)
Contains: Cost Code, Activity Description, CSI Division, Activity Type, Budget vs Actual Labor Hours, OT Hours, Budget vs Actual Labor Cost, Performance Ratio (>1.0 = over hours), Productivity Indicator, Hours to Complete

### DESIGN_CHANGES (ASIs/bulletins)
Contains: Design Doc ID, Document Type (ASI/Bulletin/Sketch/CCD), Date, Issued By, CSI Divisions Affected, Description, Resulting COR/CO, ASI Type, Cost Impact

### CROSS_REFS (document relationships/knowledge graph)
Contains: From Document, To Document, Relationship Type, Causal Chain Position, Dollar Value Carried

### DOCUMENTS (document registry)
Contains: Document ID, Type, Title, Date, Labeling Status

### LABELING_LOG (data quality tracking)
Contains: Tier 1/2/3 completion, Confidence Score

## Analysis Capabilities
When asked for a "summary" or "overview," provide:
1. Project snapshot (status, contract value, % complete, budget position)
2. Change order summary (count, total value, approval status breakdown, top COs by value)
3. Budget health (over/under by category, variance flags)
4. Production metrics (overall performance ratio, problem areas)
5. Key risks or anomalies

When asked about specific topics:
- **Change orders**: Break down by type, status, CSI division, initiating party, reason. Show the money trail.
- **Budget/costs**: Compare revised budget vs actuals, show variance by category, flag overruns
- **Production/labor**: Show performance ratios, identify over/under performing cost codes, crew issues
- **Design changes**: Trace ASI -> COR -> CO chains, show cost impact, identify patterns
- **Document chains**: Use CROSS_REFS to trace cause-and-effect relationships

## Formatting Rules
- Use markdown headers (##, ###) to organize sections
- Use tables for structured data (minimum 3 rows to justify a table)
- Use bullet points for lists
- Use **bold** for key values and warnings
- Use > blockquotes for key takeaways or risk callouts
- Always include a brief analytical insight after presenting data -- don't just dump numbers

## Important
- If data is missing or a table is empty, say so explicitly -- never fabricate data
- If a question is ambiguous, ask for clarification
- If asked about a project not in the data, say you don't have data for that project
- Round currency to 2 decimal places, percentages to 1 decimal place
- When showing change order amounts, clarify whether it's GC Proposed or Owner Approved`;

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

  // Record counts summary
  lines.push('\n## DATA COMPLETENESS');
  const counts = data.meta.recordCounts;
  lines.push(`- Change Orders: ${counts.changeOrders} records`);
  lines.push(`- Job Cost Items: ${counts.jobCosts} records`);
  lines.push(`- Production Codes: ${counts.production} records`);
  lines.push(`- Design Changes: ${counts.designChanges} records`);
  lines.push(`- Cross References: ${counts.crossRefs} records`);
  lines.push(`- Documents: ${counts.documents} records`);

  return lines.join('\n');
}
