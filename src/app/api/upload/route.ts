// CSV Upload API — parse job cost reports and write to Airtable
// POST /api/upload
// Body: { text: string, fileName: string, projectId?: string, orgId: string, action: 'preview' | 'import' }

import { NextRequest, NextResponse } from 'next/server';
import { parseJobCostReport, computeFingerprint, ParsedJobCostReport } from '@/lib/job-cost-parser';

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

// Fetch existing JOB_COSTS for a project to compute diff
async function fetchExistingJobCosts(projectId: string) {
  const filter = encodeURIComponent(`{Project ID}='${projectId}'`);
  const url = `${BASE_URL}/${getBaseId()}/JOB_COSTS?filterByFormula=${filter}&pageSize=100`;
  const res = await fetch(url, { headers: getHeaders(), cache: 'no-store' });
  if (!res.ok) return [];
  const data = await res.json();
  return data.records || [];
}

// Fetch projects for matching
async function fetchProjects(orgId: string): Promise<Array<{ id: string; fields: Record<string, unknown> }>> {
  const filter = encodeURIComponent(`{Organization ID}='${orgId}'`);
  const url = `${BASE_URL}/${getBaseId()}/PROJECTS?filterByFormula=${filter}&pageSize=100`;
  const res = await fetch(url, { headers: getHeaders(), cache: 'no-store' });
  if (!res.ok) return [];
  const data = await res.json();
  return data.records || [];
}

// Check for duplicate uploads via PIPELINE_LOG
async function checkDuplicate(fingerprint: string) {
  const filter = encodeURIComponent(`{Fingerprint}='${fingerprint}'`);
  const url = `${BASE_URL}/${getBaseId()}/PIPELINE_LOG?filterByFormula=${filter}&pageSize=1`;
  const res = await fetch(url, { headers: getHeaders(), cache: 'no-store' });
  if (!res.ok) return null;
  const data = await res.json();
  return data.records?.[0] || null;
}

// Match parsed project to existing projects
function matchProject(parsed: ParsedJobCostReport, projects: Array<{ id: string; fields: Record<string, unknown> }>) {
  if (projects.length === 0) return null;

  // Try exact job number match
  if (parsed.projectInfo.jobNumber) {
    const match = projects.find(p =>
      String(p.fields['Job Number'] || '').toLowerCase() === parsed.projectInfo.jobNumber!.toLowerCase()
    );
    if (match) return match;
  }

  // Try project name match
  if (parsed.projectInfo.projectName) {
    const parsedName = parsed.projectInfo.projectName.toLowerCase();
    const match = projects.find(p => {
      const name = String(p.fields['Project Name'] || '').toLowerCase();
      return name === parsedName || name.includes(parsedName) || parsedName.includes(name);
    });
    if (match) return match;
  }

  // If only one project, default to it
  if (projects.length === 1) return projects[0];

  return null;
}

// Compute diff between parsed data and existing records
function computeDiff(
  parsed: ParsedJobCostReport,
  existing: Array<{ id: string; fields: Record<string, unknown> }>
) {
  const changes: Array<{
    costCode: string;
    description: string;
    field: string;
    oldValue: number;
    newValue: number;
    change: number;
    changePercent: number;
  }> = [];

  for (const item of parsed.lineItems) {
    const existingRecord = existing.find(r =>
      String(r.fields['Item Code'] || '') === item.costCode
    );

    if (existingRecord) {
      const oldBudget = Number(existingRecord.fields['Revised Budget'] || existingRecord.fields['Budget'] || 0);
      const oldActual = Number(existingRecord.fields['Job to Date'] || existingRecord.fields['Actual'] || 0);

      if (oldBudget !== item.revisedBudget) {
        changes.push({
          costCode: item.costCode,
          description: item.description,
          field: 'Revised Budget',
          oldValue: oldBudget,
          newValue: item.revisedBudget,
          change: item.revisedBudget - oldBudget,
          changePercent: oldBudget > 0 ? ((item.revisedBudget - oldBudget) / oldBudget) * 100 : 0,
        });
      }

      if (Math.abs(oldActual - item.jobToDate) > 0.01) {
        changes.push({
          costCode: item.costCode,
          description: item.description,
          field: 'Job to Date',
          oldValue: oldActual,
          newValue: item.jobToDate,
          change: item.jobToDate - oldActual,
          changePercent: oldActual > 0 ? ((item.jobToDate - oldActual) / oldActual) * 100 : 0,
        });
      }
    }
  }

  const newCostCodes = parsed.lineItems.filter(
    item => !existing.some(r => String(r.fields['Item Code'] || '') === item.costCode)
  );

  const removedCostCodes = existing.filter(
    r => !parsed.lineItems.some(item => item.costCode === String(r.fields['Item Code'] || ''))
  );

  return { changes, newCostCodes, removedCostCodes };
}

// Write job cost data to Airtable (upsert: update existing, create new)
async function writeJobCosts(
  projectId: string,
  parsed: ParsedJobCostReport,
  existing: Array<{ id: string; fields: Record<string, unknown> }>
) {
  const results = { updated: 0, created: 0, errors: [] as string[] };

  for (const item of parsed.lineItems) {
    const existingRecord = existing.find(r =>
      String(r.fields['Item Code'] || '') === item.costCode
    );

    const fields: Record<string, unknown> = {
      'Project ID': projectId,
      'Item Code': item.costCode,
      'Item Description': item.description,
      'Category': item.category === 'L' ? 'Labor' : item.category === 'M' ? 'Material' : item.category === 'S' ? 'Subcontractor' : item.category === 'E' ? 'Equipment' : 'Other',
      'Revised Budget': item.revisedBudget,
      'Job to Date': item.jobToDate,
      'Change Orders': item.changeOrders,
      'Over Under': item.overUnder,
      'Pct of Budget': item.percentOfBudget,
      'Variance Status': item.overUnder > 0 ? 'over' : 'under',
    };

    try {
      if (existingRecord) {
        // Update existing record
        const url = `${BASE_URL}/${getBaseId()}/JOB_COSTS/${existingRecord.id}`;
        const res = await fetch(url, {
          method: 'PATCH',
          headers: getHeaders(),
          body: JSON.stringify({ fields }),
        });
        if (res.ok) {
          results.updated++;
        } else {
          results.errors.push(`Failed to update ${item.costCode}: ${res.status}`);
        }
      } else {
        // Create new record
        const url = `${BASE_URL}/${getBaseId()}/JOB_COSTS`;
        const res = await fetch(url, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({ fields }),
        });
        if (res.ok) {
          results.created++;
        } else {
          results.errors.push(`Failed to create ${item.costCode}: ${res.status}`);
        }
      }

      // Rate limit protection: small delay between writes
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      results.errors.push(`Error for ${item.costCode}: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }

  return results;
}

// Update PROJECTS table summary fields
async function updateProjectSummary(
  projectId: string,
  parsed: ParsedJobCostReport,
  projects: Array<{ id: string; fields: Record<string, unknown> }>
) {
  const project = projects.find(p => String(p.fields['Project ID'] || '') === projectId);
  if (!project) return;

  const fields: Record<string, unknown> = {
    'Revised Budget': parsed.summary.totalBudget,
    'Job to Date': parsed.summary.totalActual,
    'Total COs': parsed.summary.totalChangeOrders,
  };

  if (parsed.summary.percentComplete != null) {
    fields['Percent Complete Cost'] = parsed.summary.percentComplete;
  }

  const url = `${BASE_URL}/${getBaseId()}/PROJECTS/${project.id}`;
  await fetch(url, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify({ fields }),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, fileName, projectId: explicitProjectId, orgId, action } = body;

    if (!text || !orgId) {
      return NextResponse.json({ error: 'text and orgId are required' }, { status: 400 });
    }

    // 1. Parse the report
    const parsed = parseJobCostReport(text);

    if (parsed.lineItems.length === 0) {
      return NextResponse.json({
        error: 'Could not parse any line items from the uploaded file',
        warnings: parsed.warnings,
        format: parsed.format,
      }, { status: 400 });
    }

    // 2. Fingerprint for dedup
    const fingerprint = computeFingerprint(text);
    const duplicate = await checkDuplicate(fingerprint);

    if (duplicate) {
      return NextResponse.json({
        error: 'This exact file has already been uploaded',
        duplicateId: duplicate.fields?.['Pipeline ID'],
        uploadedAt: duplicate.fields?.['Created At'],
      }, { status: 409 });
    }

    // 3. Match to project
    const projects = await fetchProjects(orgId);
    const matchedProject = explicitProjectId
      ? projects.find(p => String(p.fields['Project ID'] || '') === explicitProjectId)
      : matchProject(parsed, projects);

    const projectId = explicitProjectId || (matchedProject ? String(matchedProject.fields['Project ID'] || '') : null);

    if (!projectId) {
      return NextResponse.json({
        error: 'Could not match this report to a project',
        parsed: {
          format: parsed.format,
          projectInfo: parsed.projectInfo,
          summary: parsed.summary,
          lineItemCount: parsed.lineItems.length,
        },
        availableProjects: projects.map(p => ({
          projectId: p.fields['Project ID'],
          projectName: p.fields['Project Name'],
          jobNumber: p.fields['Job Number'],
        })),
      }, { status: 404 });
    }

    // 4. Fetch existing data and compute diff
    const existing = await fetchExistingJobCosts(projectId);
    const diff = computeDiff(parsed, existing);

    // 5. Preview mode — return parsed data + diff without writing
    if (action === 'preview') {
      return NextResponse.json({
        status: 'preview',
        fingerprint,
        format: parsed.format,
        projectInfo: parsed.projectInfo,
        matchedProject: {
          projectId,
          projectName: matchedProject?.fields['Project Name'] || 'Unknown',
          jobNumber: matchedProject?.fields['Job Number'] || null,
        },
        summary: parsed.summary,
        lineItems: parsed.lineItems,
        diff: {
          changes: diff.changes,
          newCostCodes: diff.newCostCodes.map(c => ({ costCode: c.costCode, description: c.description })),
          removedCostCodes: diff.removedCostCodes.map(r => ({
            costCode: r.fields['Item Code'],
            description: r.fields['Item Description'],
          })),
        },
        existingRecordCount: existing.length,
        warnings: parsed.warnings,
      });
    }

    // 6. Import mode — write to Airtable
    const writeResults = await writeJobCosts(projectId, parsed, existing);
    await updateProjectSummary(projectId, parsed, projects);

    return NextResponse.json({
      status: 'imported',
      fingerprint,
      format: parsed.format,
      projectId,
      projectName: matchedProject?.fields['Project Name'] || 'Unknown',
      summary: parsed.summary,
      results: writeResults,
      diff: {
        changesApplied: diff.changes.length,
        newCostCodes: diff.newCostCodes.length,
      },
    });
  } catch (err: unknown) {
    console.error('Upload error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
