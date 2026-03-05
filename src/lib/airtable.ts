import { AirtableRecord, ProjectData, ProjectSummary, ProjectHealth, ProjectAlert, HealthStatus } from './types';

const BASE_URL = 'https://api.airtable.com/v0';

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_PAT}`,
    'Content-Type': 'application/json',
  };
}

function getBaseId() {
  return process.env.AIRTABLE_BASE_ID || '';
}

async function fetchTable(
  tableName: string,
  filterFormula?: string
): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (filterFormula) params.set('filterByFormula', filterFormula);
    if (offset) params.set('offset', offset);

    const url = `${BASE_URL}/${getBaseId()}/${encodeURIComponent(tableName)}?${params}`;

    let response: Response;
    let retries = 0;

    while (true) {
      response = await fetch(url, { headers: getHeaders(), cache: 'no-store' });

      if (response.status === 429 && retries < 3) {
        // Rate limited — wait and retry
        retries++;
        await new Promise((r) => setTimeout(r, 1000 * retries));
        continue;
      }
      break;
    }

    if (!response.ok) {
      console.error(`Airtable error for ${tableName}: ${response.status}`);
      return records; // Return what we have
    }

    const data = await response.json();
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return records;
}

export async function fetchAllProjectData(
  projectId: string
): Promise<ProjectData> {
  const filter = `{Project ID}='${projectId}'`;

  // Fetch all 9 tables in parallel
  const results = await Promise.allSettled([
    fetchTable('PROJECTS', filter),
    fetchTable('DOCUMENTS', filter),
    fetchTable('CHANGE_ORDERS', filter),
    fetchTable('PRODUCTION', filter),
    fetchTable('JOB_COSTS', filter),
    fetchTable('DESIGN_CHANGES', filter),
    fetchTable('CROSS_REFS', filter),
    fetchTable('LABELING_LOG', filter),
    fetchTable('STAFFING', filter),
  ]);

  const extract = (r: PromiseSettledResult<AirtableRecord[]>) =>
    r.status === 'fulfilled' ? r.value.map((rec) => rec.fields) : [];

  const projectRecords = extract(results[0]);
  const documents = extract(results[1]);
  const changeOrders = extract(results[2]);
  const production = extract(results[3]);
  const jobCosts = extract(results[4]);
  const designChanges = extract(results[5]);
  const crossRefs = extract(results[6]);
  const labelingLog = extract(results[7]);
  const staffing = extract(results[8]);

  return {
    project: projectRecords[0] || null,
    documents,
    changeOrders,
    production,
    jobCosts,
    designChanges,
    crossRefs,
    labelingLog,
    staffing,
    meta: {
      projectId,
      fetchedAt: Date.now(),
      recordCounts: {
        documents: documents.length,
        changeOrders: changeOrders.length,
        production: production.length,
        jobCosts: jobCosts.length,
        designChanges: designChanges.length,
        crossRefs: crossRefs.length,
        labelingLog: labelingLog.length,
        staffing: staffing.length,
      },
    },
  };
}

export async function fetchProjectList(): Promise<ProjectSummary[]> {
  const records = await fetchTable('PROJECTS');
  return records
    .map((rec) => ({
      projectId: String(rec.fields['Project ID'] || ''),
      projectName: String(rec.fields['Project Name'] || ''),
      status: String(rec.fields['Project Status'] || ''),
      contractValue: Number(rec.fields['Contract Value'] || 0),
    }))
    .filter((p) => p.projectId.length > 0); // Skip empty records
}

function computeHealthStatus(value: number, warningThreshold: number, criticalThreshold: number): HealthStatus {
  if (value >= criticalThreshold) return 'critical';
  if (value >= warningThreshold) return 'warning';
  return 'healthy';
}

export async function fetchProjectHealthData(): Promise<ProjectHealth[]> {
  // Fetch all projects
  const projectRecords = await fetchTable('PROJECTS');
  const projects = projectRecords
    .map((rec) => rec.fields)
    .filter((p) => String(p['Project ID'] || '').length > 0);

  if (projects.length === 0) return [];

  // Fetch all change orders, production, job costs, and staffing in parallel
  const [allCOs, allProduction, allJobCosts, allStaffing] = await Promise.all([
    fetchTable('CHANGE_ORDERS'),
    fetchTable('PRODUCTION'),
    fetchTable('JOB_COSTS'),
    fetchTable('STAFFING'),
  ]);

  const coFields = allCOs.map((r) => r.fields);
  const prodFields = allProduction.map((r) => r.fields);
  const jcFields = allJobCosts.map((r) => r.fields);
  const staffFields = allStaffing.map((r) => r.fields);

  return projects.map((p) => {
    const projectId = String(p['Project ID'] || '');
    const projectName = String(p['Project Name'] || '');
    const contractValue = Number(p['Contract Value'] || 0);
    const jobToDate = Number(p['Job to Date'] || 0);
    const rawPercent = Number(p['Percent Complete Cost'] || 0);
    // Airtable stores percentages as decimals (0.84 = 84%), convert if needed
    const percentComplete = rawPercent > 0 && rawPercent <= 1 ? rawPercent * 100 : rawPercent;
    const totalCOs = Number(p['Total COs'] || 0);
    const status = String(p['Project Status'] || '');

    // Filter data for this project
    const projectCOs = coFields.filter((co) => String(co['Project ID'] || '') === projectId);
    const projectProd = prodFields.filter((pr) => String(pr['Project ID'] || '') === projectId);
    const projectJC = jcFields.filter((jc) => String(jc['Project ID'] || '') === projectId);
    const projectStaff = staffFields.filter((s) => String(s['Project ID'] || '') === projectId);

    // Staffing
    const activeStaff = projectStaff.filter((s) => s['Active']);
    const foremanRecord = activeStaff.find((s) => {
      const role = String(s['Role'] || '').toLowerCase();
      return role.includes('foreman') || role.includes('superintendent');
    });
    const pmRecord = activeStaff.find((s) => {
      const role = String(s['Role'] || '').toLowerCase();
      return role.includes('project manager');
    });
    const foreman = foremanRecord ? String(foremanRecord['Name'] || '') : null;
    const projectManager = pmRecord ? String(pmRecord['Name'] || '') : null;
    const crewSize = activeStaff.length;

    // Pending COs
    const pendingCOs = projectCOs.filter((co) => {
      const approval = String(co['Approval Status'] || '').toLowerCase();
      return approval.includes('pending') || approval.includes('submitted') || approval.includes('review');
    });
    const pendingCOAmount = pendingCOs.reduce(
      (sum, co) => sum + Number(co['GC Proposed Amount'] || 0),
      0
    );

    // Labor performance
    const totalBudgetHrs = projectProd.reduce(
      (sum, pr) => sum + Number(pr['Budget Labor Hours'] || 0),
      0
    );
    const totalActualHrs = projectProd.reduce(
      (sum, pr) => sum + Number(pr['Actual Labor Hours'] || 0),
      0
    );
    const laborPerformanceRatio = totalBudgetHrs > 0 ? totalActualHrs / totalBudgetHrs : 0;

    // Budget variance (how much over/under budget overall)
    const revisedBudget = Number(p['Revised Budget'] || contractValue);
    const budgetVariancePercent = revisedBudget > 0
      ? ((jobToDate - revisedBudget) / revisedBudget) * 100
      : 0;

    // Compute health statuses
    const budgetHealth = computeHealthStatus(
      Math.max(0, budgetVariancePercent),
      5,  // 5% over = warning
      15  // 15% over = critical
    );

    const laborHealth = computeHealthStatus(
      Math.max(0, (laborPerformanceRatio - 1) * 100),
      10, // 10% over hours = warning
      25  // 25% over hours = critical
    );

    // Overall health: worst of budget and labor
    const healthPriority: Record<HealthStatus, number> = { healthy: 0, warning: 1, critical: 2 };
    const worstHealth = Math.max(healthPriority[budgetHealth], healthPriority[laborHealth]);
    const overallHealth: HealthStatus = worstHealth === 2 ? 'critical' : worstHealth === 1 ? 'warning' : 'healthy';

    // Generate alerts
    const alerts: ProjectAlert[] = [];

    // Over-budget job cost items
    const overBudgetItems = projectJC.filter((jc) => {
      const variance = String(jc['Variance Status'] || '').toLowerCase();
      return variance.includes('over');
    });
    if (overBudgetItems.length > 0) {
      const worstItem = overBudgetItems.reduce((worst, jc) =>
        Math.abs(Number(jc['Over Under'] || 0)) > Math.abs(Number(worst['Over Under'] || 0)) ? jc : worst
      );
      alerts.push({
        type: 'budget',
        severity: budgetHealth === 'critical' ? 'critical' : budgetHealth === 'warning' ? 'warning' : 'info',
        message: `${overBudgetItems.length} cost item${overBudgetItems.length > 1 ? 's' : ''} over budget — worst: ${String(worstItem['Item Description'] || worstItem['Item Code'])}`,
        projectId,
        projectName,
      });
    }

    // Labor over hours
    if (laborPerformanceRatio > 1.1) {
      const overPct = ((laborPerformanceRatio - 1) * 100).toFixed(0);
      alerts.push({
        type: 'labor',
        severity: laborHealth === 'critical' ? 'critical' : 'warning',
        message: `Labor ${overPct}% over budgeted hours (ratio: ${laborPerformanceRatio.toFixed(2)})`,
        projectId,
        projectName,
      });
    }

    // Pending COs
    if (pendingCOs.length > 0) {
      alerts.push({
        type: 'change_order',
        severity: pendingCOAmount > 50000 ? 'warning' : 'info',
        message: `${pendingCOs.length} pending CO${pendingCOs.length > 1 ? 's' : ''} totaling $${(pendingCOAmount / 1000).toFixed(0)}K awaiting approval`,
        projectId,
        projectName,
      });
    }

    return {
      projectId,
      projectName,
      status,
      contractValue,
      jobToDate,
      percentComplete,
      totalCOs,
      pendingCOs: pendingCOs.length,
      pendingCOAmount,
      budgetHealth,
      laborHealth,
      overallHealth,
      laborPerformanceRatio,
      budgetVariancePercent,
      foreman,
      projectManager,
      crewSize,
      alerts,
    };
  });
}

export async function resolveProjectId(
  userQuery: string
): Promise<string | null> {
  const projects = await fetchProjectList();
  if (projects.length === 0) return null;

  const query = userQuery.toLowerCase();

  // Exact match on Project ID
  const exactMatch = projects.find(
    (p) => p.projectId.toLowerCase() === query
  );
  if (exactMatch) return exactMatch.projectId;

  // Partial match on Project ID, Name, or query contains keywords
  const fuzzyMatch = projects.find((p) => {
    if (!p.projectId || !p.projectName) return false;
    const id = p.projectId.toLowerCase();
    const name = p.projectName.toLowerCase();
    return (
      (id.length > 0 && query.includes(id)) ||
      (id.length > 0 && id.includes(query)) ||
      (name.length > 2 && query.includes(name)) ||
      (name.length > 2 && name.includes(query)) ||
      name.split(/\s+/).some((word) => word.length > 2 && query.includes(word)) ||
      id.split(/[-_]/).some((part) => part.length > 2 && query.includes(part))
    );
  });

  if (fuzzyMatch) return fuzzyMatch.projectId;

  // If only one project, default to it
  if (projects.length === 1) return projects[0].projectId;

  return null;
}
