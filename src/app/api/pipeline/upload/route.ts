import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { getSupabase, uploadToStorage } from '@/lib/supabase';
import { generatePipelineId } from '@/lib/pipeline';
import { isSupportedMimeType } from '@/lib/file-parser';
import { publishProcessJob, ProcessPayload } from '@/lib/qstash';
import { getBaseUrl } from '@/lib/base-url';

export const maxDuration = 30;

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export async function POST(request: NextRequest) {
  const t0 = Date.now();
  const timing: Record<string, number> = {};

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  timing.auth = Date.now() - t0;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  const projectId = (formData.get('projectId') as string) || null;
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

  let tStep = Date.now();

  let recordId: string | null = null;
  try {
    const { data } = await sb.from('pipeline_log').insert({
      pipeline_id: pipelineId,
      ...(projectId ? { project_id: projectId } : {}),
      org_id: orgId,
      file_name: fileName,
      status: 'queued',
      created_at: now,
      ai_model: 'haiku-classify+opus-extract',
    }).select('id').single();
    if (data) recordId = String(data.id);
  } catch (err) {
    console.error('Failed to create pipeline record:', err);
  }
  timing.db_insert = Date.now() - tStep;

  tStep = Date.now();
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
  timing.storage_upload = Date.now() - tStep;

  if (recordId && fileUrl) {
    await sb.from('pipeline_log').update({ file_url: fileUrl }).eq('id', recordId);
  }

  tStep = Date.now();
  let qstashMessageId: string | null = null;
  if (recordId) {
    try {
      const baseUrl = getBaseUrl(request);
      const payload: ProcessPayload = {
        recordId,
        orgId,
        projectId,
        fileName,
        mimeType,
        storagePath,
      };
      qstashMessageId = await publishProcessJob(payload, baseUrl);
      console.log(`[upload] Queued processing for ${fileName} — qstash_msg=${qstashMessageId}`);
    } catch (err) {
      console.error('Failed to publish QStash job:', err);
      // Fall back: mark as failed so user can retry
      await sb.from('pipeline_log').update({
        status: 'failed',
        validation_flags: [{
          field: 'queue',
          issue: `Failed to queue processing: ${err instanceof Error ? err.message : 'Unknown'}`,
          severity: 'error',
        }],
      }).eq('id', recordId);
    }
  }
  timing.queue_publish = Date.now() - tStep;
  timing.total = Date.now() - t0;

  console.log(`[upload] ${fileName} (${(file.size / 1024).toFixed(0)}KB ${mimeType}) — ` +
    Object.entries(timing).map(([k, v]) => `${k}=${v}ms`).join(' '));

  return Response.json({
    pipelineId,
    recordId,
    status: 'queued',
    fileName,
    fileUrl,
    qstashMessageId,
    timing,
  });
}
