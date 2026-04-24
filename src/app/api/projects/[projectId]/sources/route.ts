import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import {
  verifyProjectAccess,
  listProjectSources,
  addProjectSource,
  removeProjectSource,
} from '@/lib/supabase';
import { testDriveFolderAccess } from '@/lib/google-drive';
import { getProvider, validateConfig } from '@/lib/source-registry';

export const maxDuration = 15;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await params;
  const hasAccess = await verifyProjectAccess(projectId, session.orgId);
  if (!hasAccess) {
    return Response.json({ error: 'Project not found' }, { status: 404 });
  }

  const sources = await listProjectSources(session.orgId, projectId);
  return Response.json({ sources });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await params;
  const hasAccess = await verifyProjectAccess(projectId, session.orgId);
  if (!hasAccess) {
    return Response.json({ error: 'Project not found' }, { status: 404 });
  }

  const body = await req.json();
  const { provider, config, label } = body as {
    provider?: string;
    config?: Record<string, unknown>;
    label?: string;
  };

  if (!provider || !config) {
    return Response.json({ error: 'provider and config are required' }, { status: 400 });
  }

  const providerDef = getProvider(provider);
  if (!providerDef) {
    return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }
  if (!providerDef.implemented) {
    return Response.json({ error: `Provider "${provider}" is not yet implemented` }, { status: 400 });
  }

  const configError = validateConfig(provider, config);
  if (configError) {
    return Response.json({ error: configError }, { status: 400 });
  }

  // For gdrive, validate the folder is accessible
  if (provider === 'gdrive' && config.folder_id) {
    const testResult = await testDriveFolderAccess(String(config.folder_id));
    if (!testResult.success) {
      return Response.json({ error: testResult.error }, { status: 400 });
    }
  }

  const source = await addProjectSource({
    orgId: session.orgId,
    projectId,
    kind: providerDef.kind,
    provider,
    config,
    label: label || providerDef.label,
  });

  if (!source) {
    return Response.json({ error: 'Failed to create source' }, { status: 500 });
  }

  return Response.json({ source }, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await params;
  const hasAccess = await verifyProjectAccess(projectId, session.orgId);
  if (!hasAccess) {
    return Response.json({ error: 'Project not found' }, { status: 404 });
  }

  const sourceId = req.nextUrl.searchParams.get('sourceId');
  if (!sourceId) {
    return Response.json({ error: 'sourceId query param required' }, { status: 400 });
  }

  const ok = await removeProjectSource(sourceId, session.orgId);
  if (!ok) {
    return Response.json({ error: 'Failed to remove source' }, { status: 500 });
  }

  return Response.json({ success: true });
}
