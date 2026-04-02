// Cron-triggered endpoint that scans Google Drive for new documents
// and queues them for async processing via QStash.
//
// Called by Vercel Cron every 5 minutes. Also callable manually.
//
// Flow:
//   1. Recursively list all files across Drive folder tree
//   2. Check pipeline_log for already-processed files (by Drive file ID)
//   3. For new files (up to MAX_FILES_PER_RUN):
//      a. Create pipeline_log entry with status 'queued'
//      b. Publish QStash job to /api/pipeline/process
//   4. Return summary

import { NextRequest } from 'next/server';
import {
  listAllDriveFiles,
  buildDriveFileUrl,
  isSupportedFileType,
} from '@/lib/google-drive';
import { generatePipelineId } from '@/lib/pipeline';
import { fetchProjectList, getSupabase, getOrganization } from '@/lib/supabase';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { publishProcessJob, ProcessPayload } from '@/lib/qstash';

const MAX_FILES_PER_RUN = 10;

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  const isCronCall = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isAdminCall = request.cookies.get('cortex-admin')?.value === 'true';
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
  const isLoggedIn = sessionToken ? await validateUserSession(sessionToken) : false;

  if (!isCronCall && !isAdminCall && !isLoggedIn) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    return Response.json({
      error: 'Google Drive not configured',
      hint: 'Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY',
    }, { status: 503 });
  }

  let driveFolderId: string | undefined;

  const session = sessionToken ? await validateUserSession(sessionToken) : null;
  if (session?.orgId) {
    const org = await getOrganization(session.orgId);
    if (org?.driveFolderId) {
      driveFolderId = org.driveFolderId;
    }
  }

  if (!driveFolderId) {
    driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  }

  if (!driveFolderId) {
    return Response.json({
      error: 'No Google Drive folder configured',
      hint: 'Connect a Google Drive folder in Settings, or set GOOGLE_DRIVE_FOLDER_ID env var',
    }, { status: 503 });
  }

  try {
    const t0 = Date.now();
    const timing: Record<string, number> = {};

    let tStep = Date.now();
    const allDriveFiles = await listAllDriveFiles(driveFolderId);
    const supportedFiles = allDriveFiles.filter((f) => isSupportedFileType(f.mimeType));
    timing.list_drive_files = Date.now() - tStep;

    tStep = Date.now();
    let orgId = session?.orgId || '';
    if (!orgId && driveFolderId) {
      const sb = getSupabase();
      const { data: orgRow } = await sb
        .from('organizations')
        .select('org_id')
        .eq('google_drive_folder_id', driveFolderId)
        .limit(1)
        .maybeSingle();
      if (orgRow?.org_id) orgId = orgRow.org_id;
    }

    const { urls: processedFileUrls, nameKeys: processedNameKeys } = await getProcessedDriveFiles(orgId);
    timing.dedup_query = Date.now() - tStep;

    const newFiles = supportedFiles.filter((f) => {
      if (processedFileUrls.has(buildDriveFileUrl(f.id))) return false;
      const nameKey = `${f.name.toLowerCase()}|${f.parentFolderName?.toLowerCase() || ''}`;
      if (processedNameKeys.has(nameKey)) return false;
      return true;
    });

    if (newFiles.length === 0) {
      timing.total = Date.now() - t0;
      console.log(`[scan-drive] No new files (${supportedFiles.length} total, ${processedFileUrls.size} processed) — ${fmtTiming(timing)}`);
      return Response.json({
        message: 'No new files found',
        totalDriveFiles: allDriveFiles.length,
        supportedFiles: supportedFiles.length,
        alreadyProcessed: processedFileUrls.size,
        timing,
      });
    }

    tStep = Date.now();
    const projects = await fetchProjectList();
    const folderLookup = new Map<string, string>();
    for (const p of projects) {
      folderLookup.set(p.projectName.toLowerCase(), p.projectId);
      folderLookup.set(p.projectId.toLowerCase(), p.projectId);
      folderLookup.set(p.projectId.toLowerCase().replace(/[-_]/g, ' '), p.projectId);
      folderLookup.set(p.projectName.toLowerCase().replace(/\s+/g, '-'), p.projectId);
    }
    timing.fetch_projects = Date.now() - tStep;

    const filesToQueue = newFiles.slice(0, MAX_FILES_PER_RUN);
    const baseUrl = getBaseUrl(request);
    const sb = getSupabase();
    const now = new Date().toISOString();

    const results: Array<{
      fileName: string;
      driveId: string;
      status: string;
      pipelineId?: string;
      projectId?: string;
      error?: string;
    }> = [];

    tStep = Date.now();
    for (const file of filesToQueue) {
      try {
        let projectId = '';
        if (file.parentFolderName && file.parentFolderName !== '_Root') {
          projectId = matchProject(file.parentFolderName, folderLookup);
        }

        const pipelineId = generatePipelineId();
        const driveFileUrl = buildDriveFileUrl(file.id);

        const { data: createData, error: createError } = await sb
          .from('pipeline_log')
          .insert({
            pipeline_id: pipelineId,
            ...(projectId ? { project_id: projectId } : {}),
            org_id: orgId,
            file_name: file.name,
            file_url: driveFileUrl,
            status: 'queued',
            created_at: now,
            ai_model: 'haiku-classify+sonnet-extract',
          })
          .select('id')
          .single();

        if (createError) {
          throw new Error(`DB insert failed: ${createError.message}`);
        }

        const recordId = String(createData.id);

        const payload: ProcessPayload = {
          recordId,
          orgId,
          projectId: projectId || null,
          fileName: file.name,
          mimeType: file.mimeType,
          storagePath: '',
          driveFileId: file.id,
        };

        const msgId = await publishProcessJob(payload, baseUrl);
        console.log(`[scan-drive] Queued ${file.name} → qstash_msg=${msgId}`);

        results.push({
          fileName: file.name,
          driveId: file.id,
          status: 'queued',
          pipelineId,
          projectId: projectId || '(unmatched)',
        });
      } catch (err) {
        console.error(`[scan-drive] Failed to queue ${file.name}:`, err);
        results.push({
          fileName: file.name,
          driveId: file.id,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
    timing.queue_files = Date.now() - tStep;
    timing.total = Date.now() - t0;

    console.log(`[scan-drive] Queued ${results.filter((r) => r.status === 'queued').length}/${filesToQueue.length} files — ${fmtTiming(timing)}`);

    return Response.json({
      message: `Queued ${results.filter((r) => r.status === 'queued').length} file(s) for processing`,
      totalDriveFiles: allDriveFiles.length,
      supportedFiles: supportedFiles.length,
      newFilesFound: newFiles.length,
      queued: results,
      remainingNewFiles: Math.max(0, newFiles.length - MAX_FILES_PER_RUN),
      timing,
    });
  } catch (err) {
    console.error('Drive scan error:', err);
    const detail = err instanceof Error ? err.message : 'Unknown';
    const hint = detail.includes('invalid_grant') || detail.includes('private key')
      ? 'Check that GOOGLE_PRIVATE_KEY is correctly formatted with real newlines'
      : detail.includes('notFound') || detail.includes('404')
      ? 'Check that the Drive folder is shared with the service account email'
      : detail.includes('403') || detail.includes('forbidden')
      ? 'The service account does not have access. Share the Drive folder with the service account email as a Viewer.'
      : undefined;
    return Response.json(
      { error: 'Drive scan failed', detail, ...(hint && { hint }) },
      { status: 500 }
    );
  }
}

// ─── Helper Functions ────────────────────────────────────────────

function matchProject(folderName: string, lookup: Map<string, string>): string {
  const folderLower = folderName.toLowerCase();
  let projectId = lookup.get(folderLower) || '';
  if (!projectId) projectId = lookup.get(folderLower.replace(/[-_]/g, ' ')) || '';
  if (!projectId) projectId = lookup.get(folderLower.replace(/\s+/g, '-')) || '';
  if (!projectId) {
    for (const [key, id] of lookup) {
      if (folderLower.includes(key) || key.includes(folderLower)) {
        projectId = id;
        break;
      }
    }
  }
  return projectId;
}

async function getProcessedDriveFiles(orgId: string): Promise<{ urls: Set<string>; nameKeys: Set<string> }> {
  const urls = new Set<string>();
  const nameKeys = new Set<string>();
  const sb = getSupabase();

  try {
    let query = sb
      .from('pipeline_log')
      .select('file_url, file_name, project_id')
      .neq('status', 'deleted');

    if (orgId) {
      query = query.eq('org_id', orgId);
    }

    const { data } = await query;

    for (const row of data || []) {
      if (row.file_url) urls.add(String(row.file_url));
      if (row.file_name) {
        nameKeys.add(`${String(row.file_name).toLowerCase()}|${String(row.project_id || '').toLowerCase()}`);
      }
    }
  } catch (err) {
    console.error('Failed to fetch processed file IDs:', err);
  }

  return { urls, nameKeys };
}

function fmtTiming(t: Record<string, number>): string {
  return Object.entries(t).map(([k, v]) => `${k}=${v}ms`).join(' ');
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
