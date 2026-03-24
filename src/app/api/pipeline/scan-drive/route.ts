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
import Anthropic from '@anthropic-ai/sdk';
import {
  listAllDriveFiles,
  downloadFileContent,
  buildDriveFileUrl,
  isSupportedFileType,
  DriveFile,
} from '@/lib/google-drive';
import { generatePipelineId } from '@/lib/pipeline';
import { fetchProjectList, getSupabase } from '@/lib/supabase';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { extractWithSkill } from '@/lib/skills';

const MAX_FILES_PER_RUN = 3;

export const maxDuration = 60;

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

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !process.env.GOOGLE_DRIVE_FOLDER_ID) {
    return Response.json({
      error: 'Google Drive not configured',
      hint: 'Set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, and GOOGLE_DRIVE_FOLDER_ID',
    }, { status: 503 });
  }

  try {
    const allDriveFiles = await listAllDriveFiles();
    const supportedFiles = allDriveFiles.filter((f) => isSupportedFileType(f.mimeType));

    const { urls: processedFileUrls, nameKeys: processedNameKeys } = await getProcessedDriveFiles();

    const newFiles = supportedFiles.filter((f) => {
      if (processedFileUrls.has(buildDriveFileUrl(f.id))) return false;
      const nameKey = `${f.name.toLowerCase()}|${f.parentFolderName?.toLowerCase() || ''}`;
      if (processedNameKeys.has(nameKey)) return false;
      return true;
    });

    if (newFiles.length === 0) {
      return Response.json({
        message: 'No new files found',
        totalDriveFiles: allDriveFiles.length,
        supportedFiles: supportedFiles.length,
        alreadyProcessed: processedFileUrls.size,
      });
    }

    const projects = await fetchProjectList();
    const folderLookup = new Map<string, string>();
    for (const p of projects) {
      folderLookup.set(p.projectName.toLowerCase(), p.projectId);
      folderLookup.set(p.projectId.toLowerCase(), p.projectId);
      folderLookup.set(p.projectId.toLowerCase().replace(/[-_]/g, ' '), p.projectId);
      folderLookup.set(p.projectName.toLowerCase().replace(/\s+/g, '-'), p.projectId);
    }

    const filesToProcess = newFiles.slice(0, MAX_FILES_PER_RUN);
    const results: Array<{
      fileName: string;
      driveId: string;
      status: string;
      pipelineId?: string;
      error?: string;
    }> = [];

    for (const file of filesToProcess) {
      try {
        const result = await processFile(file, folderLookup);
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

    return Response.json({
      message: `Processed ${results.length} new file(s)`,
      totalDriveFiles: allDriveFiles.length,
      supportedFiles: supportedFiles.length,
      newFilesFound: newFiles.length,
      processed: results,
      remainingNewFiles: Math.max(0, newFiles.length - MAX_FILES_PER_RUN),
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
      .select('file_url, file_name, project_id');

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
  folderLookup: Map<string, string>
): Promise<{
  fileName: string;
  driveId: string;
  status: string;
  pipelineId?: string;
  projectId?: string;
  error?: string;
}> {
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

  const { count: dupCount } = await sb
    .from('pipeline_log')
    .select('id', { count: 'exact', head: true })
    .eq('file_url', driveFileUrl);

  if ((dupCount || 0) > 0) {
    return {
      fileName: file.name,
      driveId: file.id,
      status: 'already_exists',
      pipelineId,
    };
  }

  const { data: createData, error: createError } = await sb
    .from('pipeline_log')
    .insert({
      pipeline_id: pipelineId,
      project_id: projectId,
      file_name: file.name,
      file_url: driveFileUrl,
      status: 'tier1_extracting',
      created_at: now,
      ai_model: 'sonnet-classify+sonnet-extract',
    })
    .select('id')
    .single();

  if (createError) {
    throw new Error(`Failed to create pipeline record: ${createError.message}`);
  }

  const recordId = createData?.id ? String(createData.id) : null;

  const content = await downloadFileContent(file.id, file.mimeType);

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
    return { fileName: file.name, driveId: file.id, status: 'unsupported_type', pipelineId };
  }

  let sourceText: string;

  if (content.text) {
    sourceText = content.text;
  } else if (content.base64 && (content.method === 'pdf' || content.method === 'image')) {
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
    return { fileName: file.name, driveId: file.id, status: 'extraction_failed', pipelineId };
  }

  if (recordId) {
    await sb.from('pipeline_log').update({
      source_text: sourceText.substring(0, 500000),
    }).eq('id', recordId);
  }

  // Skill-based extraction (classify → extract → validate)
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
    return { fileName: file.name, driveId: file.id, status: 'ai_extraction_failed', pipelineId };
  }

  const hasErrors = flags.some((f) => f.severity === 'error');
  const finalStatus = hasErrors ? 'tier2_flagged' : 'pending_review';

  if (recordId) {
    await sb.from('pipeline_log').update({
      document_type: extraction.documentType,
      status: finalStatus,
      overall_confidence: overallConfidence,
      extracted_data: extraction,
      validation_flags: flags.length > 0 ? flags : null,
      tier1_completed_at: new Date().toISOString(),
      tier2_completed_at: new Date().toISOString(),
    }).eq('id', recordId);
  }

  return {
    fileName: file.name,
    driveId: file.id,
    status: finalStatus,
    pipelineId,
    projectId: projectId || '(unmatched)',
  };
}

async function extractTextWithClaude(
  base64Data: string,
  mimeType: string,
  method: 'pdf' | 'image'
): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = 'Extract ALL text from this construction document. Return the complete text content exactly as it appears, preserving formatting, tables, numbers, and structure. Do not summarize — output every word.';

  let content: Anthropic.MessageCreateParams['messages'][0]['content'];

  if (method === 'pdf') {
    content = [
      {
        type: 'document' as const,
        source: {
          type: 'base64' as const,
          media_type: 'application/pdf' as const,
          data: base64Data,
        },
      },
      { type: 'text' as const, text: prompt },
    ];
  } else {
    const imgType = mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
    content = [
      {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: imgType,
          data: base64Data,
        },
      },
      { type: 'text' as const, text: prompt },
    ];
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    messages: [{ role: 'user', content }],
  });

  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}
