import { NextRequest } from 'next/server';
import { z } from 'zod';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { verifyProjectAccess } from '@/lib/supabase';
import { ProjectSourceSchema, CreateSourceInput } from '@/lib/schemas/project-sources.schema';
import { listProjectSources, insertProjectSource, deleteProjectSource } from '@/lib/stores/project-sources.store';
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

  try {
    const raw = await listProjectSources(session.orgId, projectId);
    const sources = z.array(ProjectSourceSchema).parse(raw);
    return Response.json({ sources });
  } catch (err) {
    console.error('[project-sources] GET error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = CreateSourceInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { provider, config, label } = parsed.data;

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

  if (provider === 'gdrive' && config.folder_id) {
    const testResult = await testDriveFolderAccess(String(config.folder_id));
    if (!testResult.success) {
      return Response.json({ error: testResult.error }, { status: 400 });
    }
  }

  try {
    const raw = await insertProjectSource({
      org_id: session.orgId,
      project_id: projectId,
      kind: providerDef.kind,
      provider,
      config,
      label: label || providerDef.label,
    });
    const source = ProjectSourceSchema.parse(raw);
    return Response.json({ source }, { status: 201 });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[project-sources] POST error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
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

  try {
    await deleteProjectSource(sourceId, session.orgId);
    return Response.json({ success: true });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[project-sources] DELETE error:', err);
    return Response.json({ error: pgErr.message ?? 'Failed to remove source' }, { status: 500 });
  }
}
