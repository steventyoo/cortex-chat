import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';
import { publishProcessJob, ProcessPayload } from '@/lib/qstash';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { recordId } = await request.json();
  if (!recordId) {
    return Response.json({ error: 'recordId is required' }, { status: 400 });
  }

  const orgId = (session as SessionPayload).orgId;
  const sb = getSupabase();

  const { data: record, error } = await sb
    .from('pipeline_log')
    .select('id, org_id, project_id, file_name, file_url, status, storage_path, drive_file_id, drive_modified_time, drive_web_view_link, drive_folder_path')
    .eq('id', recordId)
    .eq('org_id', orgId)
    .single();

  if (error || !record) {
    return Response.json({ error: 'Record not found' }, { status: 404 });
  }

  const retryableStatuses = ['failed', 'queued', 'stored_only', 'pending_review', 'approved', 'tier2_flagged'];
  if (!retryableStatuses.includes(record.status as string)) {
    return Response.json({ error: `Cannot retry record with status "${record.status}"` }, { status: 400 });
  }

  const fileUrl = record.file_url as string | null;
  const storagePath = (record.storage_path as string | null)
    || (fileUrl?.startsWith('storage://') ? fileUrl.replace('storage://', '') : null);
  const driveFileId = record.drive_file_id as string | null;

  if (!storagePath && !driveFileId) {
    return Response.json({ error: 'No stored file to reprocess' }, { status: 400 });
  }

  const fileName = record.file_name as string;

  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = {
    pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    csv: 'text/csv',
    txt: 'text/plain',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
  };
  const mimeType = mimeMap[ext] || 'application/octet-stream';

  await sb.from('pipeline_log').update({
    status: 'queued',
    validation_flags: null,
  }).eq('id', recordId);

  const baseUrl = getBaseUrl(request);
  const payload: ProcessPayload = {
    recordId: String(record.id),
    orgId,
    projectId: (record.project_id as string) || null,
    fileName,
    mimeType,
    storagePath: storagePath || '',
    ...(record.status === 'stored_only' ? { forceProcess: true } : {}),
    ...(driveFileId ? {
      driveFileId,
      driveModifiedTime: (record.drive_modified_time as string) || undefined,
      driveWebViewLink: (record.drive_web_view_link as string) || undefined,
      driveFolderPath: (record.drive_folder_path as string) || undefined,
    } : {}),
  };

  // Try QStash first; if rate-limited, fall back to direct processing
  try {
    console.log(`[retry] Re-queuing ${recordId}: storagePath=${storagePath} driveFileId=${driveFileId}`);
    const messageId = await publishProcessJob(payload, baseUrl);
    console.log(`[retry] Re-queued ${recordId} — qstash_msg=${messageId}`);
    return Response.json({ success: true, recordId, qstashMessageId: messageId });
  } catch (qstashErr) {
    const isRateLimit = qstashErr instanceof Error && (
      qstashErr.message.includes('rate limit') ||
      qstashErr.message.includes('Ratelimit') ||
      (qstashErr as { status?: number }).status === 429
    );

    if (!isRateLimit) {
      console.error('[retry] Failed to re-queue processing:', qstashErr);
      await sb.from('pipeline_log').update({
        status: 'failed',
        validation_flags: [{
          field: 'queue',
          issue: `Failed to re-queue: ${qstashErr instanceof Error ? qstashErr.message : 'Unknown'}`,
          severity: 'error',
        }],
      }).eq('id', recordId);
      return Response.json({ error: 'Failed to queue retry' }, { status: 500 });
    }

    // QStash rate-limited — process directly via internal fetch
    console.log(`[retry] QStash rate-limited, processing ${recordId} directly`);
    try {
      const processRes = await fetch(`${baseUrl}/api/pipeline/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cortex-direct-retry': 'true',
        },
        body: JSON.stringify(payload),
      });
      const result = await processRes.json();
      if (processRes.ok) {
        console.log(`[retry] Direct processing complete for ${recordId}: status=${result.status}`);
        return Response.json({ success: true, recordId, direct: true, ...result });
      }
      throw new Error(result.error || `Process returned ${processRes.status}`);
    } catch (directErr) {
      console.error('[retry] Direct processing also failed:', directErr);
      await sb.from('pipeline_log').update({
        status: 'failed',
        validation_flags: [{
          field: 'queue',
          issue: `QStash rate-limited and direct processing failed: ${directErr instanceof Error ? directErr.message : 'Unknown'}`,
          severity: 'error',
        }],
      }).eq('id', recordId);
      return Response.json({ error: 'QStash rate-limited and direct processing failed' }, { status: 500 });
    }
  }
}

function getBaseUrl(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  const host = request.headers.get('host') || 'localhost:3000';
  const proto = host.includes('localhost') ? 'http' : 'https';
  return `${proto}://${host}`;
}
