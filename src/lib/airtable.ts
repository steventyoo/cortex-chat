import { AirtableRecord, ProjectData, ProjectSummary } from './types';

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

  // Fetch all 8 tables in parallel
  const results = await Promise.allSettled([
    fetchTable('PROJECTS', filter),
    fetchTable('DOCUMENTS', filter),
    fetchTable('CHANGE_ORDERS', filter),
    fetchTable('PRODUCTION', filter),
    fetchTable('JOB_COSTS', filter),
    fetchTable('DESIGN_CHANGES', filter),
    fetchTable('CROSS_REFS', filter),
    fetchTable('LABELING_LOG', filter),
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

  return {
    project: projectRecords[0] || null,
    documents,
    changeOrders,
    production,
    jobCosts,
    designChanges,
    crossRefs,
    labelingLog,
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
