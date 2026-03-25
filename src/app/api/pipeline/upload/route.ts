import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { getSupabase, uploadToStorage } from '@/lib/supabase';
import { generatePipelineId } from '@/lib/pipeline';
import { extractWithSkill } from '@/lib/skills';
import { parseFileBuffer, isSupportedMimeType } from '@/lib/file-parser';

export const maxDuration = 120;

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  const projectId = (formData.get('projectId') as string) || '';
  const fileNameOverride = formData.get('fileName') as string | null;

  if (!file) {
    return Response.json({ error: 'No file provided' }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return Response.json(
      { error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is 50 MB.` },
      { status: 413 }
    );
  }

  const mimeType = file.type || 'application/octet-stream';
  if (!isSupportedMimeType(mimeType)) {
    return Response.json(
      { error: `Unsupported file type: ${mimeType}. Supported: PDF, images, XLSX, DOCX, PPTX, CSV, TXT.` },
      { status: 415 }
    );
  }

  const fileName = fileNameOverride || file.name || 'Untitled Document';
  const orgId = (session as SessionPayload).orgId;
  const pipelineId = generatePipelineId();
  const now = new Date().toISOString();
  const sb = getSupabase();

  // Create pipeline_log entry first so we have the record ID for the storage path
  let recordId: string | null = null;
  try {
    const { data } = await sb.from('pipeline_log').insert({
      pipeline_id: pipelineId,
      project_id: projectId,
      org_id: orgId,
      file_name: fileName,
      status: 'tier1_extracting',
      created_at: now,
      ai_model: 'sonnet-classify+sonnet-extract',
    }).select('id').single();
    if (data) recordId = String(data.id);
  } catch (err) {
    console.error('Failed to create pipeline record:', err);
  }

  // Upload original file to Supabase Storage
  const buffer = Buffer.from(await file.arrayBuffer());
  const storagePath = [
    orgId,
    projectId || '_unassigned',
    recordId || pipelineId,
    fileName,
  ].join('/');

  let fileUrl: string | null = null;
  try {
    const path = await uploadToStorage(storagePath, buffer, mimeType);
    if (path) {
      fileUrl = `storage://${path}`;
    }
  } catch (err) {
    console.error('Storage upload failed (non-fatal):', err);
  }

  // Update pipeline_log with file_url
  if (recordId && fileUrl) {
    await sb.from('pipeline_log').update({ file_url: fileUrl }).eq('id', recordId);
  }

  // Parse file to extract text
  let sourceText: string;
  try {
    const result = await parseFileBuffer(buffer, mimeType, fileName);
    sourceText = result.text;
  } catch (err) {
    console.error('File parsing failed:', err);
    if (recordId) {
      await sb.from('pipeline_log').update({
        status: 'intake',
        validation_flags: [{
          field: 'file_type',
          issue: `Failed to extract text: ${err instanceof Error ? err.message : 'Unknown error'}`,
          severity: 'error',
        }],
      }).eq('id', recordId);
    }
    return Response.json(
      { error: `Failed to extract text from file: ${err instanceof Error ? err.message : 'Unknown'}` },
      { status: 422 }
    );
  }

  // Store extracted text
  if (recordId) {
    await sb.from('pipeline_log').update({
      source_text: sourceText.substring(0, 500000),
    }).eq('id', recordId);
  }

  // Run skill-based classification + extraction
  let extraction;
  let overallConfidence: number;
  let flags;

  try {
    const result = await extractWithSkill(sourceText, projectId, orgId);
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
        document_type: extraction.documentType,
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
    fileName,
    fileUrl,
    extraction,
    overallConfidence,
    flags,
    autoApproveEligible,
  });
}
