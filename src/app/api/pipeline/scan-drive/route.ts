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
import { generatePipelineId, MAX_RETRY_COUNT } from '@/lib/pipeline';
import { fetchProjectList, getSupabase, getOrganization, listActiveFileSourcesForOrg, updateSourceLastSynced } from '@/lib/supabase';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { publishProcessBatch, publishScanContinuation, ProcessPayload, ScanContinuationPayload } from '@/lib/qstash';
import { getQStashReceiver } from '@/lib/qstash';
import { getBaseUrl } from '@/lib/base-url';

const MAX_FILES_PER_RUN = 50;

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

  const explicitFolder = request.nextUrl.searchParams.get('folderId');

  const session = sessionToken ? await validateUserSession(sessionToken) : null;
  if (session?.orgId) {
    const org = await getOrganization(session.orgId);
    if (org?.driveFolderId) {
      driveFolderId = org.driveFolderId;
    }
  }

  if (explicitFolder) {
    driveFolderId = explicitFolder;
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

  const orgId = session?.orgId || '';

  try {
    return await runScan(request, orgId, driveFolderId);
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

// ─── Core scan logic shared by GET (manual/cron) and POST (QStash continuation) ───

async function runScan(request: NextRequest, orgIdInput: string, driveFolderId: string): Promise<Response> {
  const t0 = Date.now();
  const timing: Record<string, number> = {};

  let tStep = Date.now();
  const allDriveFiles = await listAllDriveFiles(driveFolderId);
  const supportedFiles = allDriveFiles.filter((f) => isSupportedFileType(f.mimeType));
  timing.list_drive_files = Date.now() - tStep;

  tStep = Date.now();
  let orgId = orgIdInput;
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

  const { urls: processedFileUrls, nameKeys: processedNameKeys, driveStatusMap } = await getProcessedDriveFiles(orgId);
  timing.dedup_query = Date.now() - tStep;

  // ── Per-project source scanning ──
  // Scan each project's explicit file sources first. Files found here are
  // tagged with the source's project_id directly (no fuzzy matching).
  tStep = Date.now();
  const perSourceFiles: typeof supportedFiles = [];
  const claimedDriveIds = new Set<string>();
  const scannedSourceIds: string[] = [];

  if (orgId) {
    try {
      const fileSources = await listActiveFileSourcesForOrg(orgId);
      const gdriveSources = fileSources.filter((s) => s.provider === 'gdrive' && s.config.folder_id);

      for (const source of gdriveSources) {
        const fid = String(source.config.folder_id);
        try {
          const sourceFiles = await listAllDriveFiles(fid);
          const supported = sourceFiles.filter((f) => isSupportedFileType(f.mimeType));
          for (const f of supported) {
            (f as typeof f & { _sourceProjectId?: string })._sourceProjectId = source.projectId;
            perSourceFiles.push(f);
            claimedDriveIds.add(f.id);
          }
          scannedSourceIds.push(source.id);
        } catch (err) {
          console.error(`[scan-drive] Failed to scan source ${source.id} (folder=${fid}):`, err);
        }
      }
    } catch (err) {
      console.error('[scan-drive] Failed to fetch project sources:', err);
    }
  }
  timing.per_source_scan = Date.now() - tStep;

  const newFiles: typeof supportedFiles = [];
  const updatedFiles: Array<{ file: typeof supportedFiles[0]; previousRecordId: string }> = [];
  const retryFiles: Array<{ file: typeof supportedFiles[0]; existingRecordId: string; retryCount: number }> = [];
  let skippedMaxRetries = 0;

  for (const f of supportedFiles) {
    // Skip files already claimed by an explicit per-project source
    if (claimedDriveIds.has(f.id)) continue;

    const existing = driveStatusMap.get(f.id);

    if (!existing) {
      // Genuinely new file -- check fallback dedup by URL / name
      if (processedFileUrls.has(buildDriveFileUrl(f.id))) continue;
      const nameKey = `${f.name.toLowerCase()}|${f.parentFolderName?.toLowerCase() || ''}`;
      if (processedNameKeys.has(nameKey)) continue;
      newFiles.push(f);
      continue;
    }

    switch (existing.status) {
      case 'deleted':
        continue;

      case 'failed': {
        if (existing.retryCount >= MAX_RETRY_COUNT) {
          skippedMaxRetries++;
          continue;
        }
        retryFiles.push({ file: f, existingRecordId: existing.recordId, retryCount: existing.retryCount });
        continue;
      }

      case 'queued':
      case 'processing':
      case 'tier1_extracting':
        continue;

      default: {
        // Already processed (pending_review, approved, stored_only, etc.)
        // Check for Drive version update
        if (existing.isLatestVersion && existing.modifiedTime && f.modifiedTime && isDriveFileNewer(f.modifiedTime, existing.modifiedTime)) {
          console.log(`[scan-drive] Version change detected for ${f.name}: drive=${f.modifiedTime} > stored=${existing.modifiedTime}`);
          updatedFiles.push({ file: f, previousRecordId: existing.recordId });
        }
        continue;
      }
    }
  }

  // Add per-source files into newFiles (they have _sourceProjectId pre-tagged)
  for (const f of perSourceFiles) {
    const existing = driveStatusMap.get(f.id);
    if (!existing) {
      if (processedFileUrls.has(buildDriveFileUrl(f.id))) continue;
      const nameKey = `${f.name.toLowerCase()}|${f.parentFolderName?.toLowerCase() || ''}`;
      if (processedNameKeys.has(nameKey)) continue;
      newFiles.push(f);
    }
  }

  if (newFiles.length === 0 && updatedFiles.length === 0 && retryFiles.length === 0) {
    timing.total = Date.now() - t0;
    const msg = skippedMaxRetries > 0
      ? `No new files found (${skippedMaxRetries} permanently failed — max retries exceeded)`
      : 'No new files found';
    console.log(`[scan-drive] ${msg} (${supportedFiles.length} total, ${driveStatusMap.size} tracked) — ${fmtTiming(timing)}`);
    return Response.json({
      message: msg,
      totalDriveFiles: allDriveFiles.length,
      supportedFiles: supportedFiles.length,
      alreadyProcessed: driveStatusMap.size,
      skippedMaxRetries,
      timing,
    });
  }

  console.log(`[scan-drive] Found ${newFiles.length} new, ${updatedFiles.length} updated, ${retryFiles.length} retryable files (${skippedMaxRetries} hit max retries)`);

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
  const updatedToQueue = updatedFiles.slice(0, Math.max(0, MAX_FILES_PER_RUN - filesToQueue.length));
  const retryToQueue = retryFiles.slice(0, Math.max(0, MAX_FILES_PER_RUN - filesToQueue.length - updatedToQueue.length));
  const baseUrl = getBaseUrl(request);
  const sb = getSupabase();
  const now = new Date().toISOString();

  const results: Array<{
    fileName: string;
    driveId: string;
    status: string;
    pipelineId?: string;
    projectId?: string;
    isUpdate?: boolean;
    error?: string;
  }> = [];

  tStep = Date.now();

  const payloadsToPublish: ProcessPayload[] = [];

  for (const { file, previousRecordId } of updatedToQueue) {
    try {
      console.log(`[scan-drive] Updated file detected: ${file.name} (drive_id=${file.id}, prev_record=${previousRecordId})`);

      await sb
        .from('pipeline_log')
        .update({ is_latest_version: false })
        .eq('id', previousRecordId);

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
          ai_model: 'haiku-classify+opus-extract',
          drive_file_id: file.id,
          drive_modified_time: file.modifiedTime,
          drive_web_view_link: file.webViewLink,
          drive_folder_path: file.folderPath,
          is_latest_version: true,
        })
        .select('id')
        .single();

      if (createError) throw new Error(`DB insert failed: ${createError.message}`);

      const recordId = String(createData.id);
      payloadsToPublish.push({
        recordId,
        orgId,
        projectId: projectId || null,
        fileName: file.name,
        mimeType: file.mimeType,
        storagePath: '',
        driveFileId: file.id,
        driveModifiedTime: file.modifiedTime,
        driveWebViewLink: file.webViewLink,
        driveFolderPath: file.folderPath,
      });

      results.push({
        fileName: file.name,
        driveId: file.id,
        status: 'queued',
        pipelineId,
        projectId: projectId || '(unmatched)',
        isUpdate: true,
      });
    } catch (err) {
      console.error(`[scan-drive] Failed to queue update for ${file.name}:`, err);
      results.push({
        fileName: file.name,
        driveId: file.id,
        status: 'error',
        isUpdate: true,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  for (const file of filesToQueue) {
    try {
      let projectId = '';
      // Use pre-assigned source project ID if available, otherwise fuzzy-match
      const sourceProjectId = (file as typeof file & { _sourceProjectId?: string })._sourceProjectId;
      if (sourceProjectId) {
        projectId = sourceProjectId;
      } else if (file.parentFolderName && file.parentFolderName !== '_Root') {
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
          ai_model: 'haiku-classify+opus-extract',
          drive_file_id: file.id,
          drive_modified_time: file.modifiedTime,
          drive_web_view_link: file.webViewLink,
          drive_folder_path: file.folderPath,
          is_latest_version: true,
        })
        .select('id')
        .single();

      if (createError) {
        throw new Error(`DB insert failed: ${createError.message}`);
      }

      const recordId = String(createData.id);

      payloadsToPublish.push({
        recordId,
        orgId,
        projectId: projectId || null,
        fileName: file.name,
        mimeType: file.mimeType,
        storagePath: '',
        driveFileId: file.id,
        driveModifiedTime: file.modifiedTime,
        driveWebViewLink: file.webViewLink,
        driveFolderPath: file.folderPath,
      });

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

  // ── Retry failed files by updating existing records ─────────────
  for (const { file, existingRecordId, retryCount } of retryToQueue) {
    try {
      console.log(`[scan-drive] Retrying failed file: ${file.name} (drive_id=${file.id}, record=${existingRecordId}, attempt=${retryCount + 1})`);

      // Conditional UPDATE: only reset if still failed (prevents race with concurrent scans/QStash retries)
      const { data: updatedRows, error: updateError } = await sb
        .from('pipeline_log')
        .update({
          status: 'queued',
          retry_count: retryCount + 1,
          validation_flags: null,
        })
        .eq('id', existingRecordId)
        .eq('status', 'failed')
        .select('id')

      if (updateError) throw new Error(`DB conditional update failed: ${updateError.message}`);

      if (!updatedRows || updatedRows.length === 0) {
        console.log(`[scan-drive] Skip retry for ${file.name}: record already claimed by another process`);
        results.push({
          fileName: file.name,
          driveId: file.id,
          status: 'skipped',
          error: 'Already claimed by another process',
        });
        continue;
      }

      payloadsToPublish.push({
        recordId: existingRecordId,
        orgId,
        projectId: null,
        fileName: file.name,
        mimeType: file.mimeType,
        storagePath: '',
        driveFileId: file.id,
        driveModifiedTime: file.modifiedTime,
        driveWebViewLink: file.webViewLink,
        driveFolderPath: file.folderPath,
      });

      results.push({
        fileName: file.name,
        driveId: file.id,
        status: 'queued',
        pipelineId: `retry-${retryCount + 1}`,
        projectId: '(retry)',
      });
    } catch (err) {
      console.error(`[scan-drive] Failed to retry ${file.name}:`, err);
      results.push({
        fileName: file.name,
        driveId: file.id,
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  if (payloadsToPublish.length > 0) {
    try {
      await publishProcessBatch(payloadsToPublish, baseUrl);
    } catch (err) {
      console.error(`[scan-drive] Batch publish failed:`, err);
      for (const r of results) {
        if (r.status === 'queued') r.status = 'error';
      }
    }
  }

  timing.queue_files = Date.now() - tStep;

  // Update last_synced_at for per-project sources that were scanned
  if (scannedSourceIds.length > 0) {
    for (const sid of scannedSourceIds) {
      await updateSourceLastSynced(sid).catch((err) =>
        console.error(`[scan-drive] Failed to update last_synced_at for source ${sid}:`, err)
      );
    }
  }

  timing.total = Date.now() - t0;

  const queuedCount = results.filter((r) => r.status === 'queued').length;
  const updateCount = results.filter((r) => r.isUpdate && r.status === 'queued').length;
  const retriedCount = results.filter((r) => r.projectId === '(retry)' && r.status === 'queued').length;
  const remainingNew = Math.max(0, newFiles.length - MAX_FILES_PER_RUN);
  const remainingUpdated = Math.max(0, updatedFiles.length - Math.max(0, MAX_FILES_PER_RUN - filesToQueue.length));
  const remainingRetries = Math.max(0, retryFiles.length - retryToQueue.length);
  const totalRemaining = remainingNew + remainingUpdated + remainingRetries;

  console.log(`[scan-drive] Queued ${queuedCount} files (${updateCount} updates, ${retriedCount} retries), ${totalRemaining} remaining — ${fmtTiming(timing)}`);

  if (totalRemaining > 0) {
    try {
      await publishScanContinuation(baseUrl, orgId, driveFolderId, 5);
      console.log(`[scan-drive] Scheduled continuation for ${totalRemaining} remaining files (org=${orgId} folder=${driveFolderId})`);
    } catch (err) {
      console.error(`[scan-drive] Failed to schedule continuation:`, err);
    }
  }

  return Response.json({
    message: `Queued ${queuedCount} file(s) for processing${updateCount > 0 ? ` (${updateCount} update${updateCount > 1 ? 's' : ''})` : ''}${retriedCount > 0 ? ` (${retriedCount} retr${retriedCount > 1 ? 'ies' : 'y'})` : ''}`,
    totalDriveFiles: allDriveFiles.length,
    supportedFiles: supportedFiles.length,
    newFilesFound: newFiles.length,
    updatedFilesFound: updatedFiles.length,
    retriedFiles: retryFiles.length,
    skippedMaxRetries,
    queued: results,
    remainingFiles: totalRemaining,
    autoContScheduled: totalRemaining > 0,
    timing,
  });
}

// ─── POST: QStash continuation callback ──────────────────────────
// When a scan batch has remaining files, a continuation is scheduled via QStash.
// QStash sends POST to this endpoint with { continuation, orgId, driveFolderId }.

export async function POST(request: NextRequest) {
  const body = await request.text();

  const isVercel = !!process.env.VERCEL;
  if (isVercel) {
    const signature = request.headers.get('upstash-signature');
    if (!signature) {
      return Response.json({ error: 'Missing signature' }, { status: 401 });
    }
    try {
      const receiver = getQStashReceiver();
      await receiver.verify({ signature, body, url: `${getBaseUrl(request)}/api/pipeline/scan-drive` });
    } catch (err) {
      console.error('[scan-drive:POST] QStash signature verification failed:', err);
      return Response.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  let payload: ScanContinuationPayload;
  try {
    payload = JSON.parse(body);
    if (!payload.continuation || !payload.orgId || !payload.driveFolderId) {
      return Response.json({ error: 'Invalid continuation payload' }, { status: 400 });
    }
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  console.log(`[scan-drive:POST] Continuation received: org=${payload.orgId} folder=${payload.driveFolderId}`);

  try {
    return await runScan(request, payload.orgId, payload.driveFolderId);
  } catch (err) {
    console.error('[scan-drive:POST] Continuation scan failed:', err);
    return Response.json({ error: 'Continuation scan failed', detail: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
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

interface DriveFileStatus {
  status: string;
  recordId: string;
  retryCount: number;
  modifiedTime: string;
  isLatestVersion: boolean;
}

async function getProcessedDriveFiles(orgId: string): Promise<{
  urls: Set<string>;
  nameKeys: Set<string>;
  driveStatusMap: Map<string, DriveFileStatus>;
}> {
  const urls = new Set<string>();
  const nameKeys = new Set<string>();
  const driveStatusMap = new Map<string, DriveFileStatus>();
  const createdAtTracker = new Map<string, string>();
  const sb = getSupabase();
  const BATCH_SIZE = 1000;

  try {
    let offset = 0;
    while (true) {
      let query = sb
        .from('pipeline_log')
        .select('id, file_url, file_name, project_id, drive_file_id, drive_modified_time, is_latest_version, status, retry_count, created_at')
        .range(offset, offset + BATCH_SIZE - 1);

      if (orgId) {
        query = query.eq('org_id', orgId);
      }

      const { data } = await query;
      const rows = data || [];
      if (rows.length === 0) break;

      for (const row of rows) {
        const isDeleted = row.status === 'deleted';

        if (!isDeleted) {
          if (row.file_url) urls.add(String(row.file_url));
          if (row.file_name) {
            nameKeys.add(`${String(row.file_name).toLowerCase()}|${String(row.project_id || '').toLowerCase()}`);
          }
        }

        if (row.drive_file_id) {
          const driveId = String(row.drive_file_id);
          const rowCreatedAt = row.created_at || '';
          const existingCreatedAt = createdAtTracker.get(driveId) || '';

          if (!existingCreatedAt || rowCreatedAt > existingCreatedAt) {
            createdAtTracker.set(driveId, rowCreatedAt);
            driveStatusMap.set(driveId, {
              status: row.status,
              recordId: String(row.id),
              retryCount: row.retry_count ?? 0,
              modifiedTime: row.drive_modified_time || '',
              isLatestVersion: !!row.is_latest_version,
            });
          }
        }
      }

      if (rows.length < BATCH_SIZE) break;
      offset += BATCH_SIZE;
    }
  } catch (err) {
    console.error('[scan-drive] Failed to fetch processed file IDs:', err);
  }

  return { urls, nameKeys, driveStatusMap };
}

function isDriveFileNewer(driveTime: string, storedTime: string): boolean {
  const driveMs = new Date(driveTime).getTime();
  const storedMs = new Date(storedTime).getTime();
  if (isNaN(driveMs) || isNaN(storedMs)) return false;
  return driveMs > storedMs;
}

function fmtTiming(t: Record<string, number>): string {
  return Object.entries(t).map(([k, v]) => `${k}=${v}ms`).join(' ');
}
