import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, isAdminRole } from '@/lib/auth-v2';
import { z } from 'zod';
import { SkillSchema, SkillVersionSchema } from '@/lib/schemas/skills.schema';
import {
  listSkillVersions,
  getSkillVersionSnapshot,
  getSkillById,
  updateSkill,
  upsertSkillVersion,
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
    const raw = await listSkillVersions(skillId);
    const versions = z.array(SkillVersionSchema).parse(raw);
    return Response.json({ versions });
  } catch (err) {
    console.error('[skill-versions] GET error:', err);
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
  const { version } = await request.json() as { version: number };

  if (!version) {
    return Response.json({ error: 'version is required' }, { status: 400 });
  }

  try {
    const historyRow = await getSkillVersionSnapshot(skillId, version);
    if (!historyRow) {
      return Response.json({ error: `Version ${version} not found` }, { status: 404 });
    }

    const snapshot = historyRow.snapshot as Record<string, unknown>;

    let current;
    try {
      current = await getSkillById(skillId);
    } catch {
      return Response.json({ error: 'Skill not found' }, { status: 404 });
    }

    const newVersion = ((current?.version as number) || 1) + 1;

    const raw = await updateSkill(skillId, {
      display_name: snapshot.display_name,
      system_prompt: snapshot.system_prompt,
      extraction_instructions: snapshot.extraction_instructions,
      field_definitions: snapshot.field_definitions,
      classifier_hints: snapshot.classifier_hints,
      sample_extractions: snapshot.sample_extractions,
      reference_doc_ids: snapshot.reference_doc_ids,
      status: snapshot.status,
      version: newVersion,
      updated_at: new Date().toISOString(),
    });

    await upsertSkillVersion({
      skill_id: skillId,
      version: newVersion,
      snapshot,
      changed_by: session.email,
      change_summary: `Rolled back to v${version}`,
    });

    const skill = SkillSchema.parse(raw);
    return Response.json({ skill });
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error('[skill-versions] POST error:', err);
    return Response.json({ error: pgErr.message ?? 'Internal server error' }, { status: 500 });
  }
}
