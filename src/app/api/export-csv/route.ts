import { NextRequest } from 'next/server';
import { validateToken, SESSION_COOKIE } from '@/lib/auth';
import { fetchAllProjectData } from '@/lib/airtable';
import { generateProjectCsv } from '@/lib/csv-export';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  // 1. Auth check
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateToken(token))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Parse request
  let projectId: string;
  let projectName: string;

  try {
    const body = await request.json();
    projectId = body.projectId;
    projectName = body.projectName || projectId;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!projectId) {
    return new Response(JSON.stringify({ error: 'Project ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 3. Fetch project data
    const data = await fetchAllProjectData(projectId);

    // 4. Generate CSV
    const csv = generateProjectCsv(data, projectName);

    // 5. Return CSV
    const filename = `${projectName.replace(/[^a-zA-Z0-9]/g, '-')}-Data.csv`;
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error('CSV export error:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to export CSV' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
