import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';
import { publishProcessBatch, ProcessPayload } from '@/lib/qstash';

export const maxDuration = 120;

const BATCH_SIZE = 50;

const EXT_MIME_MAP: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  csv: 'text/csv',
  txt: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/**
 * POST /api/pipeline/reprocess-batch
 *
 * Re-queues already-processed documents matching specific file extensions.
 * Useful after deploying extraction improvements (e.g., codegen routing).
 *
 * Body: { extensions: string[], dryRun?: boolean }
 *   extensions — file extensions to reprocess (e.g., ["xlsx", "xls", "docx"])
 *   dryRun     — if true, returns matching docs without re-queuing
 */
export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (session as SessionPayload).orgId;
  const body = await request.json();
  const extensions: string[] = body.extensions || [];
  const dryRun = body.dryRun === true;
  const includeStatuses: string[] = body.statuses || [
    'pending_review', 'tier2_validated', 'tier2_flagged', 'approved', 'failed',
  ];

  if (!extensions.length) {
    return Response.json({ error: 'extensions array is required (e.g., ["xlsx", "xls", "docx"])' }, { status: 400 });
  }

  const sb = getSupabase();

  const likePatterns = extensions.map(ext => `%.${ext.toLowerCase()}`);

  let allRows: Array<{
    id: string;
    file_name: string;
    project_id: string | null;
    status: string;
    storage_path: string | null;
    drive_file_id: string | null;
    drive_modified_time: string | null;
    drive_web_view_link: string | null;
    drive_folder_path: string | null;
    ai_model: string | null;
  }> = [];

  for (const pattern of likePatterns) {
    const { data, error } = await sb
      .from('pipeline_log')
      .select('id, file_name, project_id, status, storage_path, drive_file_id, drive_modified_time, drive_web_view_link, drive_folder_path, ai_model')
      .eq('org_id', orgId)
      .neq('is_latest_version', false)
      .in('status', includeStatuses)
      .ilike('file_name', pattern)
      .limit(500);

    if (error) {
      console.error(`[reprocess-batch] Query failed for pattern ${pattern}:`, error.message);
      continue;
    }
    if (data) allRows.push(...data);
  }

  const seen = new Set<string>();
  allRows = allRows.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  console.log(`[reprocess-batch] Found ${allRows.length} docs matching extensions=[${extensions.join(',')}] statuses=[${includeStatuses.join(',')}]`);

  if (dryRun) {
    const summary: Record<string, number> = {};
    for (const row of allRows) {
      const ext = row.file_name.split('.').pop()?.toLowerCase() || '?';
      summary[ext] = (summary[ext] || 0) + 1;
    }
    return Response.json({
      dryRun: true,
      totalMatched: allRows.length,
      byExtension: summary,
      byStatus: allRows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {} as Record<string, number>),
      files: allRows.map(r => ({ id: r.id, fileName: r.file_name, status: r.status, aiModel: r.ai_model })),
    });
  }

  const baseUrl = getBaseUrl(request);
  const payloads: ProcessPayload[] = [];
  const resetIds: string[] = [];

  for (const row of allRows) {
    const ext = row.file_name.split('.').pop()?.toLowerCase() || '';
    const mimeType = EXT_MIME_MAP[ext] || 'application/octet-stream';

    resetIds.push(row.id);
    payloads.push({
      recordId: row.id,
      orgId,
      projectId: row.project_id || null,
      fileName: row.file_name,
      mimeType,
      storagePath: row.storage_path || '',
      ...(row.drive_file_id ? {
        driveFileId: row.drive_file_id,
        driveModifiedTime: row.drive_modified_time || undefined,
        driveWebViewLink: row.drive_web_view_link || undefined,
        driveFolderPath: row.drive_folder_path || undefined,
      } : {}),
    });
  }

  for (let i = 0; i < resetIds.length; i += 100) {
    const batch = resetIds.slice(i, i + 100);
    await sb.from('pipeline_log').update({
      status: 'queued',
      validation_flags: null,
      extracted_data: null,
      overall_confidence: null,
    }).in('id', batch);
  }

  const messageIds: string[] = [];
  for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
    const batch = payloads.slice(i, i + BATCH_SIZE);
    try {
      const ids = await publishProcessBatch(batch, baseUrl);
      messageIds.push(...ids);
      console.log(`[reprocess-batch] Queued batch ${Math.floor(i / BATCH_SIZE) + 1}: ${ids.length} jobs`);
    } catch (err) {
      console.error(`[reprocess-batch] Failed to queue batch:`, err);
    }
  }

  console.log(`[reprocess-batch] Done: ${messageIds.length} jobs queued for ${allRows.length} docs`);

  return Response.json({
    success: true,
    totalRequeued: allRows.length,
    qstashJobs: messageIds.length,
    extensions,
    byExtension: allRows.reduce((acc, r) => {
      const ext = r.file_name.split('.').pop()?.toLowerCase() || '?';
      acc[ext] = (acc[ext] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  });
}

function getBaseUrl(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  const host = request.headers.get('host') || 'localhost:3000';
  const proto = host.includes('localhost') ? 'http' : 'https';
  return `${proto}://${host}`;
}
