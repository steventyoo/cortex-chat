import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, isAdminRole } from '@/lib/auth-v2';
import { z } from 'zod';
import { OrgSkillConfigSchema, CreateOrgSkillConfigInput } from '@/lib/schemas/skills.schema';
import {
  listOrgSkillConfigs,
  upsertOrgSkillConfig,
  deleteOrgSkillConfig,
} from '@/lib/stores/skills.store';

interface RouteParams {
  params: Promise<{ skillId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { skillId } = await params;

  try {
    const raw = await listOrgSkillConfigs(skillId);
    const configs = z.array(OrgSkillConfigSchema).parse(raw);
    return Response.json({ configs });
  } catch (err) {
    console.error('[org-configs] GET error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session || !isAdminRole(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { skillId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = CreateOrgSkillConfigInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const raw = await upsertOrgSkillConfig({
      org_id: parsed.data.orgId,
      skill_id: skillId,
      pinned_version: parsed.data.pinned_version ?? null,
      document_aliases: parsed.data.document_aliases,
      hidden_fields: parsed.data.hidden_fields,
    });
    const config = OrgSkillConfigSchema.parse(raw);
    return Response.json({ config });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[org-configs] POST error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session || !isAdminRole(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { skillId } = await params;
  const { orgId } = await request.json() as { orgId: string };

  try {
    await deleteOrgSkillConfig(skillId, orgId);
    return Response.json({ success: true });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[org-configs] DELETE error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
}
