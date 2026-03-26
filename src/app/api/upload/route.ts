// CSV Upload API — parse job cost reports and write to Supabase
// POST /api/upload
// Body: { text: string, fileName: string, projectId?: string, orgId: string, action: 'preview' | 'import' }

import { NextRequest, NextResponse } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { parseJobCostReport, computeFingerprint, ParsedJobCostReport } from '@/lib/job-cost-parser';
import { getSupabase } from '@/lib/supabase';

// Fetch existing job_costs for a project to compute diff
async function fetchExistingJobCosts(projectId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('job_costs')
    .select('*')
    .eq('project_id', projectId);
  if (error) return [];
  return (data || []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    fields: {
      'Item Code': row.item_code,
      'Item Description': row.item_description,
      'Revised Budget': row.revised_budget,
      'Budget': row.revised_budget,
      'Job to Date': row.job_to_date,
      'Actual': row.job_to_date,
    },
  }));
}

// Fetch projects for matching
async function fetchProjects(orgId: string): Promise<Array<{ id: string; fields: Record<string, unknown> }>> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('projects')
    .select('*')
    .eq('org_id', orgId);
  if (error) return [];
  return (data || []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    fields: {
      'Project ID': row.project_id,
      'Project Name': row.project_name,
      'Job Number': row.job_number,
    },
  }));
}

// Check for duplicate uploads via pipeline_log fingerprint
async function checkDuplicate(fingerprint: string) {
  const sb = getSupabase();
  const { data } = await sb
    .from('pipeline_log')
    .select('pipeline_id, created_at')
    .eq('fingerprint', fingerprint)
    .limit(1);
  if (data && data.length > 0) {
    return {
      fields: {
        'Pipeline ID': data[0].pipeline_id,
        'Created At': data[0].created_at,
      },
    };
  }
  return null;
}

// Match parsed project to existing projects
function matchProject(parsed: ParsedJobCostReport, projects: Array<{ id: string; fields: Record<string, unknown> }>) {
  if (projects.length === 0) return null;

  if (parsed.projectInfo.jobNumber) {
    const match = projects.find(p =>
      String(p.fields['Job Number'] || '').toLowerCase() === parsed.projectInfo.jobNumber!.toLowerCase()
    );
    if (match) return match;
  }

  if (parsed.projectInfo.projectName) {
    const parsedName = parsed.projectInfo.projectName.toLowerCase();
    const match = projects.find(p => {
      const name = String(p.fields['Project Name'] || '').toLowerCase();
      return name === parsedName || name.includes(parsedName) || parsedName.includes(name);
    });
    if (match) return match;
  }

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

// Write job cost data to Supabase (upsert: update existing, create new)
async function writeJobCosts(
  projectId: string,
  orgId: string,
  parsed: ParsedJobCostReport,
  existing: Array<{ id: string; fields: Record<string, unknown> }>
) {
  const sb = getSupabase();
  const results = { updated: 0, created: 0, errors: [] as string[] };

  for (const item of parsed.lineItems) {
    const existingRecord = existing.find(r =>
      String(r.fields['Item Code'] || '') === item.costCode
    );

    const row: Record<string, unknown> = {
      project_id: projectId,
      org_id: orgId,
      item_code: item.costCode,
      item_description: item.description,
      category: item.category === 'L' ? 'Labor' : item.category === 'M' ? 'Material' : item.category === 'S' ? 'Subcontractor' : item.category === 'E' ? 'Equipment' : 'Other',
      revised_budget: item.revisedBudget,
      job_to_date: item.jobToDate,
      change_orders: item.changeOrders,
      over_under: item.overUnder,
      pct_of_budget: item.percentOfBudget,
      variance_status: item.overUnder > 0 ? 'over' : 'under',
    };

    try {
      if (existingRecord) {
        const { error } = await sb.from('job_costs').update(row).eq('id', existingRecord.id);
        if (!error) {
          results.updated++;
        } else {
          results.errors.push(`Failed to update ${item.costCode}: ${error.message}`);
        }
      } else {
        const { error } = await sb.from('job_costs').insert(row);
        if (!error) {
          results.created++;
        } else {
          results.errors.push(`Failed to create ${item.costCode}: ${error.message}`);
        }
      }
    } catch (err) {
      results.errors.push(`Error for ${item.costCode}: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }

  return results;
}

// Update projects table summary fields
async function updateProjectSummary(
  projectId: string,
  parsed: ParsedJobCostReport
) {
  const sb = getSupabase();
  const update: Record<string, unknown> = {
    revised_budget: parsed.summary.totalBudget,
    job_to_date: parsed.summary.totalActual,
    total_cos: parsed.summary.totalChangeOrders,
  };

  if (parsed.summary.percentComplete != null) {
    update.percent_complete_cost = parsed.summary.percentComplete;
  }

  await sb.from('projects').update(update).eq('project_id', projectId);
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { text, fileName, projectId: explicitProjectId, action } = body;
    const orgId = session.orgId;

    if (!text) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
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

    // 6. Import mode — write to Supabase
    const writeResults = await writeJobCosts(projectId, orgId, parsed, existing);
    await updateProjectSummary(projectId, parsed);

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
