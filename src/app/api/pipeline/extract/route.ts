import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';
import { generatePipelineId } from '@/lib/pipeline';
import { extractWithSkill } from '@/lib/skills';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let sourceText: string;
  let projectId: string | null;
  let fileName: string;
  let fileUrl: string | null;

  try {
    const body = await request.json();
    sourceText = body.sourceText;
    projectId = body.projectId || null;
    fileName = body.fileName || 'Untitled Document';
    fileUrl = body.fileUrl || null;

    if (!sourceText || sourceText.trim().length === 0) {
      return Response.json({ error: 'sourceText is required' }, { status: 400 });
    }
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const orgId = session.orgId;

  const pipelineId = generatePipelineId();
  const now = new Date().toISOString();
  const sb = getSupabase();

  let recordId: string | null = null;
  try {
    const { data } = await sb.from('pipeline_log').insert({
      pipeline_id: pipelineId,
      ...(projectId ? { project_id: projectId } : {}),
      org_id: orgId,
      file_name: fileName,
      file_url: fileUrl || null,
      status: 'tier1_extracting',
      source_text: sourceText.substring(0, 500000),
      created_at: now,
      ai_model: 'opus-extract',
    }).select('id').single();
    if (data) recordId = String(data.id);
  } catch (err) {
    console.error('Failed to create pipeline record:', err);
  }

  let extraction;
  let overallConfidence: number;
  let flags;

  try {
    const result = await extractWithSkill(sourceText, projectId || '', orgId);
    extraction = result.extraction;
    overallConfidence = result.overallConfidence;
    flags = result.flags;
  } catch (err) {
    console.error('AI extraction failed:', err);

    if (recordId) {
      await sb.from('pipeline_log').update({
        status: 'intake',
        validation_flags: [{
          field: 'extraction',
          issue: `AI extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          severity: 'error',
        }],
      }).eq('id', recordId);
    }

    return Response.json(
      { error: 'AI extraction failed', pipelineId },
      { status: 500 }
    );
  }

  const hasErrors = flags.some((f) => f.severity === 'error');
  const hasWarnings = flags.some((f) => f.severity === 'warning');
  const autoApproveEligible = overallConfidence >= 0.95 && !hasErrors && !hasWarnings;
  const finalStatus = autoApproveEligible ? 'tier2_validated' : hasErrors ? 'tier2_flagged' : 'pending_review';

  if (recordId) {
    try {
      await sb.from('pipeline_log').update({
        document_type: extraction.skillId || null,
        status: finalStatus,
        overall_confidence: overallConfidence,
        extracted_data: extraction,
        validation_flags: flags.length > 0 ? flags : null,
        tier1_completed_at: new Date().toISOString(),
        tier2_completed_at: new Date().toISOString(),
      }).eq('id', recordId);
    } catch (err) {
      console.error('Failed to update pipeline record:', err);
    }
  }

  return Response.json({
    pipelineId,
    recordId,
    status: finalStatus,
    extraction,
    overallConfidence,
    flags,
    autoApproveEligible,
  });
}
