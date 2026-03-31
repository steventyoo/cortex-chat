import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { fetchAllProjectData, verifyProjectAccess, getOrganization } from '@/lib/supabase';
import { generateProjectBrief } from '@/lib/pdf-brief';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

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

  const hasAccess = await verifyProjectAccess(projectId, session.orgId);
  if (!hasAccess) {
    return new Response(JSON.stringify({ error: 'Project not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const data = await fetchAllProjectData(projectId);

    // Load org name for the PDF header
    const org = await getOrganization(session.orgId);
    const orgName = org?.orgName || undefined;

    // Generate PDF
    const pdfBuffer = generateProjectBrief(data, projectName, undefined, orgName);

    // Return PDF
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
