import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getOrganization } from '@/lib/organizations';

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

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projects } = await req.json();
  if (!Array.isArray(projects) || projects.length === 0) {
    return Response.json({ error: 'projects array required' }, { status: 400 });
  }

  // Verify org exists
  const org = await getOrganization(session.orgId);
  if (!org) {
    return Response.json({ error: 'Organization not found' }, { status: 404 });
  }

  // Create PROJECTS records in Airtable (batch of 10 per Airtable limit)
  const created: string[] = [];
  const batches = [];

  for (let i = 0; i < projects.length; i += 10) {
    batches.push(projects.slice(i, i + 10));
  }

  for (const batch of batches) {
    const records = batch.map(
      (p: { name: string; projectId?: string; driveFolderId?: string }) => ({
        fields: {
          'Project ID': p.projectId || p.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase(),
          'Project Name': p.name,
          'Organization ID': session.orgId,
          'Project Status': 'Active',
          'Contract Value': 0,
          'Revised Budget': 0,
          'Job to Date': 0,
          'Percent Complete Cost': 0,
          'Total COs': 0,
        },
      })
    );

    const url = `${BASE_URL}/${getBaseId()}/${encodeURIComponent('PROJECTS')}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ records }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Failed to create projects:', err);
      continue;
    }

    const data = await res.json();
    for (const rec of data.records || []) {
      created.push(rec.fields['Project ID']);
    }
  }

  return Response.json({
    success: true,
    created: created.length,
    projectIds: created,
  });
}
