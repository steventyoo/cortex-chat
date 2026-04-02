import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { extractWithSkill } from '@/lib/skills';
import { parseFileBuffer, extractTextWithClaude } from '@/lib/file-parser';
import { ValidationFlag } from '@/lib/pipeline';
import { getQStashReceiver, ProcessPayload } from '@/lib/qstash';
import { downloadFileContent } from '@/lib/google-drive';
import { extractText as pdfExtractText } from 'unpdf';

export const maxDuration = 300;

const DOCUMENTS_BUCKET = 'documents';

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
      await receiver.verify({ signature, body, url: `${getBaseUrl(request)}/api/pipeline/process` });
    } catch (err) {
      console.error('QStash signature verification failed:', err);
      return Response.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  const payload: ProcessPayload = JSON.parse(body);
  const { recordId, orgId, projectId, fileName, mimeType, storagePath, driveFileId } = payload;
  const t0 = Date.now();
  const timing: Record<string, number> = {};

  const sb = getSupabase();

  await sb.from('pipeline_log').update({ status: 'processing' }).eq('id', recordId);

  let tStep = Date.now();
  let sourceText: string;

  if (driveFileId) {
    try {
      const content = await downloadFileContent(driveFileId, mimeType);
      timing.drive_download = Date.now() - tStep;

      tStep = Date.now();
      if (content.text) {
        sourceText = content.text;
      } else if (content.base64 && content.method === 'pdf') {
        const pdfBuffer = Buffer.from(content.base64, 'base64');
        try {
          const { text: localText } = await pdfExtractText(new Uint8Array(pdfBuffer), { mergePages: true });
          const trimmed = (localText as string).trim();
          if (trimmed.length > 100) {
            sourceText = trimmed;
          } else {
            sourceText = await extractTextWithClaude(content.base64, content.mimeType, content.method);
          }
        } catch {
          sourceText = await extractTextWithClaude(content.base64, content.mimeType, content.method);
        }
      } else if (content.base64 && content.method === 'image') {
        sourceText = await extractTextWithClaude(content.base64, content.mimeType, content.method);
      } else {
        throw new Error(`Could not extract text from Drive file (method=${content.method})`);
      }
      timing.text_extraction = Date.now() - tStep;
    } catch (err) {
      console.error(`[process] Drive download/parse failed for ${recordId}:`, err);
      await markFailed(sb, recordId, 'drive_download', err);
      return Response.json({ error: 'Failed to download from Drive' }, { status: 500 });
    }
  } else {
    let fileBuffer: Buffer;
    try {
      const { data, error } = await sb.storage
        .from(DOCUMENTS_BUCKET)
        .download(storagePath);
      if (error || !data) {
        throw new Error(error?.message || 'No data returned from storage');
      }
      fileBuffer = Buffer.from(await data.arrayBuffer());
    } catch (err) {
      console.error(`[process] Failed to download file for ${recordId}:`, err);
      await markFailed(sb, recordId, 'storage_download', err);
      return Response.json({ error: 'Failed to download file' }, { status: 500 });
    }
    timing.storage_download = Date.now() - tStep;

    tStep = Date.now();
    try {
      const result = await parseFileBuffer(fileBuffer, mimeType, fileName);
      sourceText = result.text;
    } catch (err) {
      console.error(`[process] File parsing failed for ${recordId}:`, err);
      await markFailed(sb, recordId, 'text_extraction', err);
      return Response.json({ error: 'Failed to extract text' }, { status: 500 });
    }
    timing.text_extraction = Date.now() - tStep;
  }

  tStep = Date.now();
  await sb.from('pipeline_log').update({
    source_text: sourceText.substring(0, 500000),
  }).eq('id', recordId);
  timing.save_source_text = Date.now() - tStep;

  tStep = Date.now();
  let extraction;
  let overallConfidence: number;
  let flags: ValidationFlag[];

  try {
    const result = await extractWithSkill(sourceText, projectId || '', orgId);
    extraction = result.extraction;
    overallConfidence = result.overallConfidence;
    flags = result.flags;
  } catch (err) {
    console.error(`[process] AI extraction failed for ${recordId}:`, err);
    await markFailed(sb, recordId, 'ai_extraction', err);
    return Response.json({ error: 'AI extraction failed' }, { status: 500 });
  }
  timing.ai_extraction = Date.now() - tStep;

  const hasErrors = flags.some((f) => f.severity === 'error');
  const hasWarnings = flags.some((f) => f.severity === 'warning');
  const autoApproveEligible = overallConfidence >= 0.95 && !hasErrors && !hasWarnings;
  const finalStatus = autoApproveEligible ? 'tier2_validated' : hasErrors ? 'tier2_flagged' : 'pending_review';

  tStep = Date.now();
  try {
    await sb.from('pipeline_log').update({
      document_type: extraction.skillId || null,
      status: finalStatus,
      overall_confidence: overallConfidence,
      extracted_data: extraction,
      validation_flags: flags.length > 0 ? flags : null,
      ai_model: 'haiku-classify+sonnet-extract',
      tier1_completed_at: new Date().toISOString(),
      tier2_completed_at: new Date().toISOString(),
    }).eq('id', recordId);
  } catch (err) {
    console.error(`[process] Failed to update pipeline record ${recordId}:`, err);
  }
  timing.db_final_update = Date.now() - tStep;
  timing.total = Date.now() - t0;

  console.log(`[process] ${fileName} (${recordId}) → ${finalStatus} — ` +
    Object.entries(timing).map(([k, v]) => `${k}=${v}ms`).join(' '));

  return Response.json({ success: true, recordId, status: finalStatus, timing });
}

async function markFailed(
  sb: ReturnType<typeof getSupabase>,
  recordId: string,
  stage: string,
  err: unknown
) {
  await sb.from('pipeline_log').update({
    status: 'failed',
    validation_flags: [{
      field: stage,
      issue: `Processing failed at ${stage}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      severity: 'error',
    }],
  }).eq('id', recordId);
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
