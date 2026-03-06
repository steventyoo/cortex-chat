import { NextRequest } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { fetchAllProjectData } from '@/lib/airtable';
import { generateProjectBrief } from '@/lib/pdf-brief';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  // 1. Auth check
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
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

    // 4. Load OWP logo as base64
    let logoBase64: string | undefined;
    try {
      const logoPath = join(process.cwd(), 'public', 'owp-logo.png');
      const logoBuffer = await readFile(logoPath);
      logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`;
    } catch {
      // Logo not found — skip it
    }

    // 5. Generate PDF
    const pdfBuffer = generateProjectBrief(data, projectName, logoBase64);

    // 6. Return PDF
    const filename = `${projectName.replace(/[^a-zA-Z0-9]/g, '-')}-Brief.pdf`;
    return new Response(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error('Brief generation error:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to generate brief' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
