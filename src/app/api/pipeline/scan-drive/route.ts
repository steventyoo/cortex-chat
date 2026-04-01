// Cron-triggered endpoint that scans Google Drive for new documents
// and feeds them into the extraction pipeline.
//
// Called by Vercel Cron every 5 minutes. Also callable manually (admin only).
//
// Flow:
//   1. List all files across project folders in Drive
//   2. Check pipeline_log for already-processed files (by Drive file ID)
//   3. For new files (up to 3 per run):
//      a. Download content
//      b. Extract text (text files) or prepare base64 (PDF/images)
//      c. Run AI extraction + validation via skill-based pipeline
//      d. Create pipeline_log entry
//   4. Return summary

import { NextRequest } from 'next/server';
import {
  listAllDriveFiles,
  downloadFileContent,
  buildDriveFileUrl,
  isSupportedFileType,
  DriveFile,
} from '@/lib/google-drive';
import { generatePipelineId } from '@/lib/pipeline';
import { fetchProjectList, getSupabase, getOrganization } from '@/lib/supabase';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { extractWithSkill } from '@/lib/skills';
import { extractTextWithClaude } from '@/lib/file-parser';
import { extractText as pdfExtractText } from 'unpdf';

const MAX_FILES_PER_RUN = 3;

export const maxDuration = 300;

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

  // Resolve the Drive folder ID: prefer per-org value from DB, fall back to env var
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
    const { urls: processedFileUrls, nameKeys: processedNameKeys } = await getProcessedDriveFiles();
    timing.dedup_query = Date.now() - tStep;

    const newFiles = supportedFiles.filter((f) => {
      if (processedFileUrls.has(buildDriveFileUrl(f.id))) return false;
      const nameKey = `${f.name.toLowerCase()}|${f.parentFolderName?.toLowerCase() || ''}`;
      if (processedNameKeys.has(nameKey)) return false;
      return true;
    });

    if (newFiles.length === 0) {
      timing.total = Date.now() - t0;
      console.log(`[scan-drive] No new files — ${Object.entries(timing).map(([k, v]) => `${k}=${v}ms`).join(' ')}`);
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

    const filesToProcess = newFiles.slice(0, MAX_FILES_PER_RUN);

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

    const results: Array<{
      fileName: string;
      driveId: string;
      status: string;
      pipelineId?: string;
      error?: string;
      timing?: Record<string, number>;
    }> = [];

    for (const file of filesToProcess) {
      try {
        const result = await processFile(file, folderLookup, orgId);
        results.push(result);
      } catch (err) {
        results.push({
          fileName: file.name,
          driveId: file.id,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    timing.total = Date.now() - t0;
    console.log(`[scan-drive] ${results.length} files — ${Object.entries(timing).map(([k, v]) => `${k}=${v}ms`).join(' ')}`);

    return Response.json({
      message: `Processed ${results.length} new file(s)`,
      totalDriveFiles: allDriveFiles.length,
      supportedFiles: supportedFiles.length,
      newFilesFound: newFiles.length,
      processed: results,
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

async function getProcessedDriveFiles(): Promise<{ urls: Set<string>; nameKeys: Set<string> }> {
  const urls = new Set<string>();
  const nameKeys = new Set<string>();
  const sb = getSupabase();

  try {
    const { data } = await sb
      .from('pipeline_log')
      .select('file_url, file_name, project_id')
      .neq('status', 'deleted');

    for (const row of data || []) {
      if (row.file_url) urls.add(String(row.file_url));
      if (row.file_name) {
        nameKeys.add(`${String(row.file_name).toLowerCase()}|${String(row.project_id || '').toLowerCase()}`);
      }
    }
  } catch (err) {
    console.error('Failed to fetch processed file IDs:', err);
  }

  console.log(`Dedup loaded: ${urls.size} URLs, ${nameKeys.size} name keys`);
  return { urls, nameKeys };
}

async function processFile(
  file: DriveFile,
  folderLookup: Map<string, string>,
  orgId: string
): Promise<{
  fileName: string;
  driveId: string;
  status: string;
  pipelineId?: string;
  projectId?: string;
  error?: string;
  timing?: Record<string, number>;
}> {
  const t0 = Date.now();
  const timing: Record<string, number> = {};
  const pipelineId = generatePipelineId();
  const driveFileUrl = buildDriveFileUrl(file.id);
  const now = new Date().toISOString();
  const sb = getSupabase();

  let projectId = '';
  if (file.parentFolderName && file.parentFolderName !== '_Root') {
    const folderLower = file.parentFolderName.toLowerCase();
    projectId = folderLookup.get(folderLower) || '';
    if (!projectId) projectId = folderLookup.get(folderLower.replace(/[-_]/g, ' ')) || '';
    if (!projectId) projectId = folderLookup.get(folderLower.replace(/\s+/g, '-')) || '';
    if (!projectId) {
      for (const [key, id] of folderLookup) {
        if (folderLower.includes(key) || key.includes(folderLower)) {
          projectId = id;
          break;
        }
      }
    }
  }

  let tStep = Date.now();
  const { count: dupCount } = await sb
    .from('pipeline_log')
    .select('id', { count: 'exact', head: true })
    .eq('file_url', driveFileUrl)
    .neq('status', 'deleted');
  timing.dedup_check = Date.now() - tStep;

  if ((dupCount || 0) > 0) {
    timing.total = Date.now() - t0;
    return {
      fileName: file.name,
      driveId: file.id,
      status: 'already_exists',
      pipelineId,
      timing,
    };
  }

  tStep = Date.now();
  const { data: createData, error: createError } = await sb
    .from('pipeline_log')
    .insert({
      pipeline_id: pipelineId,
      ...(projectId ? { project_id: projectId } : {}),
      org_id: orgId,
      file_name: file.name,
      file_url: driveFileUrl,
      status: 'tier1_extracting',
      created_at: now,
      ai_model: 'sonnet-classify+sonnet-extract',
    })
    .select('id')
    .single();
  timing.db_insert = Date.now() - tStep;

  if (createError) {
    throw new Error(`Failed to create pipeline record: ${createError.message}`);
  }

  const recordId = createData?.id ? String(createData.id) : null;

  tStep = Date.now();
  const content = await downloadFileContent(file.id, file.mimeType);
  timing.drive_download = Date.now() - tStep;

  const MAX_BASE64_SIZE = 25 * 1024 * 1024;
  if (content.base64 && content.base64.length > MAX_BASE64_SIZE) {
    if (recordId) {
      await sb.from('pipeline_log').update({
        status: 'intake',
        validation_flags: [{
          field: 'file_size',
          issue: `File too large for AI processing (${Math.round(content.base64.length / 1024 / 1024)}MB). Max ~25MB.`,
          severity: 'error',
        }],
      }).eq('id', recordId);
    }
    timing.total = Date.now() - t0;
    return { fileName: file.name, driveId: file.id, status: 'too_large', pipelineId, timing };
  }

  if (content.method === 'unsupported') {
    if (recordId) {
      await sb.from('pipeline_log').update({
        status: 'intake',
        validation_flags: [{
          field: 'file_type',
          issue: `Unsupported file type: ${file.mimeType}`,
          severity: 'error',
        }],
      }).eq('id', recordId);
    }
    timing.total = Date.now() - t0;
    return { fileName: file.name, driveId: file.id, status: 'unsupported_type', pipelineId, timing };
  }

  tStep = Date.now();
  let sourceText: string;

  if (content.text) {
    sourceText = content.text;
  } else if (content.base64 && content.method === 'pdf') {
    const pdfBuffer = Buffer.from(content.base64, 'base64');
    try {
      const { text: localText } = await pdfExtractText(new Uint8Array(pdfBuffer), { mergePages: true });
      const trimmed = (localText as string).trim();
      if (trimmed.length > 100) {
        console.log(`[scan-drive:file] unpdf extracted ${trimmed.length} chars for ${file.name}`);
        sourceText = trimmed;
      } else {
        console.log(`[scan-drive:file] unpdf got only ${trimmed.length} chars for ${file.name} — falling back to Claude OCR`);
        sourceText = await extractTextWithClaude(content.base64, content.mimeType, content.method);
      }
    } catch (err) {
      console.log(`[scan-drive:file] unpdf failed for ${file.name} (${err instanceof Error ? err.message : 'unknown'}) — falling back to Claude OCR`);
      sourceText = await extractTextWithClaude(content.base64, content.mimeType, content.method);
    }
  } else if (content.base64 && content.method === 'image') {
    sourceText = await extractTextWithClaude(content.base64, content.mimeType, content.method);
  } else {
    if (recordId) {
      await sb.from('pipeline_log').update({
        status: 'intake',
        validation_flags: [{
          field: 'extraction',
          issue: 'Could not extract text from file',
          severity: 'error',
        }],
      }).eq('id', recordId);
    }
    timing.total = Date.now() - t0;
    return { fileName: file.name, driveId: file.id, status: 'extraction_failed', pipelineId, timing };
  }
  timing.text_extraction = Date.now() - tStep;

  tStep = Date.now();
  if (recordId) {
    const { error: srcErr } = await sb.from('pipeline_log').update({
      source_text: sourceText.substring(0, 500000),
    }).eq('id', recordId);
    if (srcErr) console.error('Failed to save source_text:', srcErr.message);
  }
  timing.save_source_text = Date.now() - tStep;

  tStep = Date.now();
  let extraction;
  let overallConfidence: number;
  let flags;

  try {
    const result = await extractWithSkill(sourceText, projectId);
    extraction = result.extraction;
    overallConfidence = result.overallConfidence;
    flags = result.flags;
  } catch (err) {
    console.error('AI extraction failed for Drive file:', file.name, err);
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
    timing.ai_extraction = Date.now() - tStep;
    timing.total = Date.now() - t0;
    console.log(`[scan-drive:file] ${file.name} FAILED — ${Object.entries(timing).map(([k, v]) => `${k}=${v}ms`).join(' ')}`);
    return { fileName: file.name, driveId: file.id, status: 'ai_extraction_failed', pipelineId, timing };
  }
  timing.ai_extraction = Date.now() - tStep;

  const hasErrors = flags.some((f) => f.severity === 'error');
  const hasWarnings = flags.some((f) => f.severity === 'warning');
  const autoApproveEligible = overallConfidence >= 0.95 && !hasErrors && !hasWarnings;
  const finalStatus = autoApproveEligible ? 'tier2_validated' : hasErrors ? 'tier2_flagged' : 'pending_review';

  tStep = Date.now();
  if (recordId) {
    const { error: updateErr } = await sb.from('pipeline_log').update({
      document_type: extraction.skillId || null,
      status: finalStatus,
      overall_confidence: overallConfidence,
      extracted_data: extraction,
      validation_flags: flags.length > 0 ? flags : null,
      tier1_completed_at: new Date().toISOString(),
      tier2_completed_at: new Date().toISOString(),
    }).eq('id', recordId);
    if (updateErr) console.error('Failed to update extraction results:', updateErr.message);
  }
  timing.db_final_update = Date.now() - tStep;
  timing.total = Date.now() - t0;

  console.log(`[scan-drive:file] ${file.name} → ${finalStatus} — ${Object.entries(timing).map(([k, v]) => `${k}=${v}ms`).join(' ')}`);

  return {
    fileName: file.name,
    driveId: file.id,
    status: finalStatus,
    pipelineId,
    projectId: projectId || '(unmatched)',
    timing,
  };
}
