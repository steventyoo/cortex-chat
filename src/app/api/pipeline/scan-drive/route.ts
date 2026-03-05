// Cron-triggered endpoint that scans Google Drive for new documents
// and feeds them into the extraction pipeline.
//
// Called by Vercel Cron every 5 minutes. Also callable manually (admin only).
//
// Flow:
//   1. List all files across project folders in Drive
//   2. Check PIPELINE_LOG for already-processed files (by Drive file ID)
//   3. For new files (up to 3 per run):
//      a. Download content
//      b. Extract text (text files) or prepare base64 (PDF/images)
//      c. Run AI extraction + validation via Claude
//      d. Create PIPELINE_LOG entry
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
import {
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionPrompt,
  generatePipelineId,
  computeOverallConfidence,
  ExtractionResult,
  ValidationFlag,
  DOCUMENT_TYPE_FIELDS,
} from '@/lib/pipeline';
import { fetchProjectList } from '@/lib/airtable';

const BASE_URL = 'https://api.airtable.com/v0';
const MAX_FILES_PER_RUN = 3; // Stay within 60s timeout

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_PAT}`,
    'Content-Type': 'application/json',
  };
}

function getBaseId() {
  return process.env.AIRTABLE_BASE_ID || '';
}

export const maxDuration = 60;

/**
 * GET handler — triggered by Vercel Cron or manual admin call.
 * Vercel Cron sends an Authorization header with CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  // Auth: accept either CRON_SECRET or admin cookie
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  const isCronCall = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isAdminCall = request.cookies.get('cortex-admin')?.value === 'true';

  if (!isCronCall && !isAdminCall) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check if Google Drive is configured
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !process.env.GOOGLE_DRIVE_FOLDER_ID) {
    return Response.json({
      error: 'Google Drive not configured',
      hint: 'Set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, and GOOGLE_DRIVE_FOLDER_ID',
    }, { status: 503 });
  }

  try {
    // 1. List all files in Drive
    const allDriveFiles = await listAllDriveFiles();
    const supportedFiles = allDriveFiles.filter((f) => isSupportedFileType(f.mimeType));

    // 2. Get already-processed file IDs from PIPELINE_LOG
    const processedFileUrls = await getProcessedDriveFileIds();

    // 3. Find new files (not yet in pipeline)
    const newFiles = supportedFiles.filter(
      (f) => !processedFileUrls.has(buildDriveFileUrl(f.id))
    );

    if (newFiles.length === 0) {
      return Response.json({
        message: 'No new files found',
        totalDriveFiles: allDriveFiles.length,
        supportedFiles: supportedFiles.length,
        alreadyProcessed: processedFileUrls.size,
      });
    }

    // 4. Map Drive folder names to project IDs
    const projects = await fetchProjectList();
    const projectNameToId = new Map<string, string>();
    for (const p of projects) {
      projectNameToId.set(p.projectName.toLowerCase(), p.projectId);
      // Also try common abbreviations
      const words = p.projectName.toLowerCase().split(/\s+/);
      if (words.length > 1) {
        projectNameToId.set(words.join(' '), p.projectId);
      }
    }

    // 5. Process up to MAX_FILES_PER_RUN new files
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
        const result = await processFile(file, projectNameToId);
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
    return Response.json(
      { error: 'Drive scan failed', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 }
    );
  }
}

// ─── Helper Functions ────────────────────────────────────────────

/**
 * Get all Drive file URLs already in PIPELINE_LOG to avoid reprocessing.
 */
async function getProcessedDriveFileIds(): Promise<Set<string>> {
  const urls = new Set<string>();

  try {
    // Fetch all PIPELINE_LOG records that have a File URL starting with "gdrive://"
    const res = await fetch(
      `${BASE_URL}/${getBaseId()}/PIPELINE_LOG?` +
        new URLSearchParams({
          filterByFormula: `SEARCH("gdrive://", {File URL}) > 0`,
          fields: JSON.stringify(['File URL']),
          pageSize: '100',
        }),
      { headers: getHeaders() }
    );

    if (res.ok) {
      const data = await res.json();
      for (const record of data.records || []) {
        const fileUrl = record.fields['File URL'];
        if (fileUrl) urls.add(String(fileUrl));
      }

      // Handle pagination
      let offset = data.offset;
      while (offset) {
        const nextRes = await fetch(
          `${BASE_URL}/${getBaseId()}/PIPELINE_LOG?` +
            new URLSearchParams({
              filterByFormula: `SEARCH("gdrive://", {File URL}) > 0`,
              fields: JSON.stringify(['File URL']),
              pageSize: '100',
              offset,
            }),
          { headers: getHeaders() }
        );
        if (nextRes.ok) {
          const nextData = await nextRes.json();
          for (const record of nextData.records || []) {
            const fileUrl = record.fields['File URL'];
            if (fileUrl) urls.add(String(fileUrl));
          }
          offset = nextData.offset;
        } else {
          break;
        }
      }
    }
  } catch (err) {
    console.error('Failed to fetch processed file IDs:', err);
  }

  return urls;
}

/**
 * Process a single Drive file through the extraction pipeline.
 */
async function processFile(
  file: DriveFile,
  projectNameToId: Map<string, string>
): Promise<{
  fileName: string;
  driveId: string;
  status: string;
  pipelineId?: string;
  error?: string;
}> {
  const pipelineId = generatePipelineId();
  const driveFileUrl = buildDriveFileUrl(file.id);
  const now = new Date().toISOString();

  // Resolve project ID from folder name
  let projectId = '';
  if (file.parentFolderName && file.parentFolderName !== '_Root') {
    const folderLower = file.parentFolderName.toLowerCase();
    projectId = projectNameToId.get(folderLower) || '';

    // Fuzzy match: check if any project name is contained in folder name or vice versa
    if (!projectId) {
      for (const [name, id] of projectNameToId) {
        if (folderLower.includes(name) || name.includes(folderLower)) {
          projectId = id;
          break;
        }
      }
    }
  }

  // 1. Create initial PIPELINE_LOG record
  const createRes = await fetch(`${BASE_URL}/${getBaseId()}/PIPELINE_LOG`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      records: [{
        fields: {
          'Pipeline ID': pipelineId,
          'Project ID': projectId,
          'File Name': file.name,
          'File URL': driveFileUrl,
          'Status': 'tier1_extracting',
          'Created At': now,
          'AI Model': 'claude-sonnet-4-20250514',
        },
      }],
    }),
  });

  if (!createRes.ok) {
    throw new Error(`Failed to create pipeline record: ${createRes.status}`);
  }

  const createData = await createRes.json();
  const recordId = createData.records?.[0]?.id;

  // 2. Download file content from Drive
  const content = await downloadFileContent(file.id, file.mimeType);

  if (content.method === 'unsupported') {
    // Update record with error
    if (recordId) {
      await updatePipelineRecord(recordId, {
        'Status': 'intake',
        'Validation Flags': JSON.stringify([{
          field: 'file_type',
          issue: `Unsupported file type: ${file.mimeType}`,
          severity: 'error',
        }]),
      });
    }
    return { fileName: file.name, driveId: file.id, status: 'unsupported_type', pipelineId };
  }

  // 3. Extract text from the file
  let sourceText: string;

  if (content.text) {
    // Already have text (text files, Google Docs)
    sourceText = content.text;
  } else if (content.base64 && (content.method === 'pdf' || content.method === 'image')) {
    // Use Claude to OCR/read the document
    sourceText = await extractTextWithClaude(content.base64, content.mimeType, content.method);
  } else {
    // No usable content
    if (recordId) {
      await updatePipelineRecord(recordId, {
        'Status': 'intake',
        'Validation Flags': JSON.stringify([{
          field: 'extraction',
          issue: 'Could not extract text from file',
          severity: 'error',
        }]),
      });
    }
    return { fileName: file.name, driveId: file.id, status: 'extraction_failed', pipelineId };
  }

  // Store source text
  if (recordId) {
    await updatePipelineRecord(recordId, {
      'Source Text': sourceText.substring(0, 99000),
    });
  }

  // 4. Run AI extraction (same logic as extract/route.ts)
  let extraction: ExtractionResult;

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const extractionPrompt = buildExtractionPrompt(sourceText, projectId || undefined);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: extractionPrompt }],
    });

    const responseText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');

    let jsonStr = responseText.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();

    extraction = JSON.parse(jsonStr) as ExtractionResult;
  } catch (err) {
    console.error('AI extraction failed for Drive file:', file.name, err);
    if (recordId) {
      await updatePipelineRecord(recordId, {
        'Status': 'intake',
        'Validation Flags': JSON.stringify([{
          field: 'extraction',
          issue: `AI extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          severity: 'error',
        }]),
      });
    }
    return { fileName: file.name, driveId: file.id, status: 'ai_extraction_failed', pipelineId };
  }

  // 5. Validation (Tier 2)
  const overallConfidence = computeOverallConfidence(extraction);
  const flags: ValidationFlag[] = [];

  for (const [fieldName, fieldData] of Object.entries(extraction.fields)) {
    if (fieldData.value !== null && fieldData.confidence < 0.7) {
      flags.push({
        field: fieldName,
        issue: `Low confidence (${Math.round(fieldData.confidence * 100)}%)`,
        severity: 'warning',
      });
    }
    if (fieldData.value === null) {
      const expectedFields = DOCUMENT_TYPE_FIELDS[extraction.documentType] || [];
      if (expectedFields.includes(fieldName)) {
        flags.push({
          field: fieldName,
          issue: 'Missing — not detected in document',
          severity: 'info',
        });
      }
    }
  }

  if (extraction.documentTypeConfidence < 0.8) {
    flags.push({
      field: 'Document Type',
      issue: `Document type classification has low confidence (${Math.round(extraction.documentTypeConfidence * 100)}%)`,
      severity: 'warning',
    });
  }

  const hasErrors = flags.some((f) => f.severity === 'error');
  const hasWarnings = flags.some((f) => f.severity === 'warning');
  const finalStatus = hasErrors
    ? 'tier2_flagged'
    : hasWarnings
    ? 'pending_review'
    : 'pending_review'; // Always queue for human review from Drive intake

  // 6. Update pipeline record
  if (recordId) {
    await updatePipelineRecord(recordId, {
      'Document Type': extraction.documentType,
      'Status': finalStatus,
      'Overall Confidence': overallConfidence,
      'Extracted Data': JSON.stringify(extraction),
      'Validation Flags': flags.length > 0 ? JSON.stringify(flags) : undefined,
      'Tier1 Completed At': new Date().toISOString(),
      'Tier2 Completed At': new Date().toISOString(),
    });
  }

  return {
    fileName: file.name,
    driveId: file.id,
    status: finalStatus,
    pipelineId,
  };
}

/**
 * Use Claude to read text from a PDF or image.
 */
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

/**
 * Update a PIPELINE_LOG record in Airtable.
 */
async function updatePipelineRecord(
  recordId: string,
  fields: Record<string, unknown>
): Promise<void> {
  await fetch(`${BASE_URL}/${getBaseId()}/PIPELINE_LOG/${recordId}`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify({ fields }),
  });
}
