import { getSupabase, lookupCategoryId } from '@/lib/supabase';
import { extractWithSkill, getSkillFieldDefinitions, listActiveSkills, classifyDocument, getSkill } from '@/lib/skills';
import { extractWithCodegen, type CodegenExtractionResult } from '@/lib/codegen-extractor';
import { getContextCardFieldsForSkill } from '@/lib/stores/context-cards.store';
import { parseFileBuffer, extractTextWithClaude } from '@/lib/file-parser';
import { ValidationFlag, resolveCategoryKey, generateCanonicalName, computeOverallConfidence } from '@/lib/pipeline';
import { ProcessPayload } from '@/lib/qstash';
import { downloadFileContent, downloadFileRaw } from '@/lib/google-drive';
import { extractText as pdfExtractText } from 'unpdf';
import { countPdfPagesSync } from 'pdf-pages-count';

const DOCUMENTS_BUCKET = 'documents';
const LARGE_PDF_PAGE_THRESHOLD = 100;

const ALWAYS_PROCESS_PATTERNS = [
  /job\s*(cost|detail)\s*report/i,
  /\bjcr\b/i,
  /\bjob\s*detail\b/i,
  /cost\s*report/i,
];

function shouldAlwaysProcess(fileName: string, folderPath?: string): boolean {
  const haystack = `${fileName} ${folderPath || ''}`;
  return ALWAYS_PROCESS_PATTERNS.some(p => p.test(haystack));
}

function isJobCostReport(fileName: string, folderPath?: string): boolean {
  const haystack = `${fileName} ${folderPath || ''}`;
  return ALWAYS_PROCESS_PATTERNS.some(p => p.test(haystack));
}

function isPdf(mimeType: string, fileName: string): boolean {
  return mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
}

export interface ProcessResult {
  success: boolean;
  recordId: string;
  status: string;
  pageCount?: number;
  timing: Record<string, number>;
  error?: string;
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

export async function processDocument(payload: ProcessPayload): Promise<ProcessResult> {
  const {
    recordId, orgId, projectId, fileName, mimeType, storagePath,
    driveFileId, driveModifiedTime, driveWebViewLink, driveFolderPath,
    forceProcess,
  } = payload;
  const t0 = Date.now();
  const timing: Record<string, number> = {};

  console.log(`[process] START record=${recordId} file="${fileName}" mime=${mimeType} drive=${driveFileId || 'n/a'}`);

  const sb = getSupabase();

  await sb.from('pipeline_log').update({ status: 'processing' }).eq('id', recordId);

  let tStep = Date.now();
  let sourceText: string;
  let finalStoragePath = storagePath;

  if (driveFileId) {
    let rawBuffer: Buffer | null = null;

    try {
      console.log(`[process] Downloading raw file from Drive: drive_id=${driveFileId}`);
      const { buffer, effectiveMimeType } = await downloadFileRaw(driveFileId, mimeType);
      rawBuffer = buffer;
      timing.drive_raw_download = Date.now() - tStep;
      console.log(`[process] Drive raw download complete: ${buffer.length} bytes, effectiveMime=${effectiveMimeType}`);

      tStep = Date.now();
      const ext = fileName.includes('.') ? fileName.split('.').pop() : 'bin';
      const storageDest = `${orgId}/drive/${driveFileId}/${Date.now()}.${ext}`;
      console.log(`[process] Uploading to Supabase Storage: bucket=${DOCUMENTS_BUCKET} path=${storageDest}`);
      const { error: uploadErr } = await sb.storage
        .from(DOCUMENTS_BUCKET)
        .upload(storageDest, buffer, {
          contentType: effectiveMimeType,
          upsert: true,
        });
      if (uploadErr) {
        console.warn(`[process] Storage upload failed (non-fatal): ${uploadErr.message}`);
      } else {
        finalStoragePath = storageDest;
        console.log(`[process] Storage upload OK: path=${storageDest}`);
      }
      timing.storage_upload = Date.now() - tStep;
    } catch (err) {
      console.error(`[process] Drive raw download failed for ${recordId}:`, err);
    }

    if (rawBuffer && isPdf(mimeType, fileName)) {
      try {
        const pageCount = countPdfPagesSync(new Uint8Array(rawBuffer));
        console.log(`[process] PDF page count: ${pageCount} pages (threshold=${LARGE_PDF_PAGE_THRESHOLD}) forceProcess=${!!forceProcess}`);

        await sb.from('pipeline_log').update({ page_count: pageCount }).eq('id', recordId);

        if (pageCount > LARGE_PDF_PAGE_THRESHOLD && !forceProcess && !shouldAlwaysProcess(fileName, driveFolderPath)) {
          console.log(`[process] Large PDF detected (${pageCount} pages > ${LARGE_PDF_PAGE_THRESHOLD}). Storing only, skipping AI extraction.`);
          await sb.from('pipeline_log').update({
            status: 'stored_only',
            storage_path: finalStoragePath || null,
            validation_flags: [{
              field: 'page_count',
              issue: `Large document (${pageCount} pages). Stored for manual processing.`,
              severity: 'info',
            }],
            ...(driveModifiedTime ? { drive_modified_time: driveModifiedTime } : {}),
            ...(driveWebViewLink ? { drive_web_view_link: driveWebViewLink } : {}),
            ...(driveFolderPath ? { drive_folder_path: driveFolderPath } : {}),
            ...(driveFileId ? { drive_file_id: driveFileId } : {}),
          }).eq('id', recordId);
          timing.total = Date.now() - t0;
          console.log(`[process] DONE record=${recordId} file="${fileName}" status=stored_only pages=${pageCount} — ` +
            Object.entries(timing).map(([k, v]) => `${k}=${v}ms`).join(' '));
          return { success: true, recordId, status: 'stored_only', pageCount, timing };
        }

        if (pageCount > LARGE_PDF_PAGE_THRESHOLD) {
          console.log(`[process] Large PDF (${pageCount} pages) but matches always-process pattern — proceeding with extraction`);
        }
      } catch (err) {
        console.warn(`[process] PDF page count failed (non-fatal):`, err);
      }
    }

    tStep = Date.now();
    try {
      console.log(`[process] Extracting text from Drive file: method=downloadFileContent`);
      const content = await downloadFileContent(driveFileId, mimeType);
      timing.drive_content_download = Date.now() - tStep;

      tStep = Date.now();
      if (content.text) {
        sourceText = content.text;
        console.log(`[process] Text extracted directly: ${sourceText.length} chars`);
      } else if (content.base64 && content.method === 'pdf') {
        const forceClaudeOcr = isJobCostReport(fileName, driveFolderPath);
        if (forceClaudeOcr) {
          console.log(`[process] JCR-pattern detected — using Claude OCR for better table fidelity`);
          sourceText = await extractTextWithClaude(content.base64, content.mimeType, content.method);
        } else {
          const pdfBuffer = rawBuffer || Buffer.from(content.base64, 'base64');
          try {
            const { text: localText } = await pdfExtractText(new Uint8Array(pdfBuffer), { mergePages: true });
            const trimmed = (localText as string).trim();
            if (trimmed.length > 100) {
              sourceText = trimmed;
              console.log(`[process] PDF text via unpdf: ${sourceText.length} chars`);
            } else {
              console.log(`[process] unpdf returned sparse text (${trimmed.length} chars), falling back to Claude OCR`);
              sourceText = await extractTextWithClaude(content.base64, content.mimeType, content.method);
            }
          } catch {
            console.log(`[process] unpdf failed, falling back to Claude OCR`);
            sourceText = await extractTextWithClaude(content.base64, content.mimeType, content.method);
          }
        }
      } else if (content.base64 && content.method === 'image') {
        console.log(`[process] Image OCR via Claude`);
        sourceText = await extractTextWithClaude(content.base64, content.mimeType, content.method);
      } else {
        throw new Error(`Could not extract text from Drive file (method=${content.method})`);
      }
      timing.text_extraction = Date.now() - tStep;
    } catch (err) {
      console.error(`[process] Drive text extraction failed for ${recordId}:`, err);
      await markFailed(sb, recordId, 'drive_download', err);
      return { success: false, recordId, status: 'failed', timing, error: 'Failed to extract text from Drive file' };
    }

    tStep = Date.now();
    const driveMetaUpdate: Record<string, unknown> = {};
    if (finalStoragePath) driveMetaUpdate.storage_path = finalStoragePath;
    if (driveModifiedTime) driveMetaUpdate.drive_modified_time = driveModifiedTime;
    if (driveWebViewLink) driveMetaUpdate.drive_web_view_link = driveWebViewLink;
    if (driveFolderPath) driveMetaUpdate.drive_folder_path = driveFolderPath;
    if (driveFileId) driveMetaUpdate.drive_file_id = driveFileId;

    if (Object.keys(driveMetaUpdate).length > 0) {
      const { error: metaErr } = await sb.from('pipeline_log').update(driveMetaUpdate).eq('id', recordId);
      if (metaErr) console.warn(`[process] Drive metadata update failed (non-fatal): ${metaErr.message}`);
      else console.log(`[process] Drive metadata saved: ${JSON.stringify(driveMetaUpdate)}`);
    }
    timing.drive_meta_save = Date.now() - tStep;
  } else {
    let fileBuffer: Buffer;
    try {
      console.log(`[process] Downloading from Supabase Storage: path=${storagePath}`);
      const { data, error } = await sb.storage
        .from(DOCUMENTS_BUCKET)
        .download(storagePath);
      if (error || !data) {
        throw new Error(error?.message || 'No data returned from storage');
      }
      fileBuffer = Buffer.from(await data.arrayBuffer());
      console.log(`[process] Storage download complete: ${fileBuffer.length} bytes`);
    } catch (err) {
      console.error(`[process] Failed to download file for ${recordId}:`, err);
      await markFailed(sb, recordId, 'storage_download', err);
      return { success: false, recordId, status: 'failed', timing, error: 'Failed to download file' };
    }
    timing.storage_download = Date.now() - tStep;

    if (isPdf(mimeType, fileName)) {
      try {
        const pageCount = countPdfPagesSync(new Uint8Array(fileBuffer));
        console.log(`[process] PDF page count: ${pageCount} pages (threshold=${LARGE_PDF_PAGE_THRESHOLD}) forceProcess=${!!forceProcess}`);

        await sb.from('pipeline_log').update({ page_count: pageCount }).eq('id', recordId);

        if (pageCount > LARGE_PDF_PAGE_THRESHOLD && !forceProcess && !shouldAlwaysProcess(fileName)) {
          console.log(`[process] Large PDF detected (${pageCount} pages > ${LARGE_PDF_PAGE_THRESHOLD}). Storing only, skipping AI extraction.`);
          await sb.from('pipeline_log').update({
            status: 'stored_only',
            validation_flags: [{
              field: 'page_count',
              issue: `Large document (${pageCount} pages). Stored for manual processing.`,
              severity: 'info',
            }],
          }).eq('id', recordId);
          timing.total = Date.now() - t0;
          console.log(`[process] DONE record=${recordId} file="${fileName}" status=stored_only pages=${pageCount} — ` +
            Object.entries(timing).map(([k, v]) => `${k}=${v}ms`).join(' '));
          return { success: true, recordId, status: 'stored_only', pageCount, timing };
        }
      } catch (err) {
        console.warn(`[process] PDF page count failed (non-fatal):`, err);
      }
    }

    tStep = Date.now();
    try {
      const forceOcr = isPdf(mimeType, fileName) && isJobCostReport(fileName);
      const result = await parseFileBuffer(fileBuffer, mimeType, fileName, { forceClaudeOcr: forceOcr });
      sourceText = result.text;
      console.log(`[process] File parsed: ${sourceText.length} chars${forceOcr ? ' (Claude OCR forced for JCR)' : ''}`);
    } catch (err) {
      console.error(`[process] File parsing failed for ${recordId}:`, err);
      await markFailed(sb, recordId, 'text_extraction', err);
      return { success: false, recordId, status: 'failed', timing, error: 'Failed to extract text' };
    }
    timing.text_extraction = Date.now() - tStep;
  }

  tStep = Date.now();
  await sb.from('pipeline_log').update({
    source_text: sourceText.substring(0, 500000),
  }).eq('id', recordId);
  timing.save_source_text = Date.now() - tStep;
  console.log(`[process] Source text saved: ${Math.min(sourceText.length, 500000)} chars`);

  tStep = Date.now();
  let extraction;
  let overallConfidence: number;
  let flags: ValidationFlag[];
  let discoveredFields: Record<string, unknown> = {};

  try {
    console.log(`[process] Starting AI extraction: project=${projectId || 'none'} org=${orgId}`);

    // Pre-classify to check if skill uses codegen extraction
    const skills = await listActiveSkills();
    const classification = await classifyDocument(sourceText, skills, orgId);
    const skill = classification.skillId ? await getSkill(classification.skillId) : null;

    if (skill?.extractionMethod === 'codegen') {
      console.log(`[process] Using CODEGEN extraction for skill=${skill.skillId}`);
      const catalogFields = await getSkillFieldDefinitions(skill.skillId);
      const contextCardFields = await getContextCardFieldsForSkill(skill.skillId, orgId);
      const fileExt = fileName.includes('.') ? fileName.split('.').pop() || '' : '';

      // Re-download raw buffer for the codegen sandbox
      let docBuffer: Buffer;
      if (driveFileId) {
        const { buffer } = await downloadFileRaw(driveFileId, mimeType);
        docBuffer = buffer;
      } else {
        const { data: dlData } = await sb.storage.from(DOCUMENTS_BUCKET).download(storagePath);
        docBuffer = Buffer.from(await dlData!.arrayBuffer());
      }

      try {
        const codegenResult: CodegenExtractionResult = await extractWithCodegen(
          docBuffer, sourceText, skill, catalogFields, contextCardFields,
          classification.confidence, fileExt,
        );
        extraction = codegenResult.extraction;
        discoveredFields = codegenResult.discoveredFields;
        overallConfidence = computeOverallConfidence(extraction);
        flags = [];

        for (const [fieldName, fieldData] of Object.entries(extraction.fields)) {
          if (fieldData.value !== null && fieldData.confidence < 0.7) {
            flags.push({ field: fieldName, issue: `Low confidence (${Math.round(fieldData.confidence * 100)}%)`, severity: 'warning' });
          }
        }
        console.log(`[process] Codegen extraction complete: skill=${extraction.skillId} confidence=${overallConfidence} discovered=${Object.keys(discoveredFields).length}`);
      } catch (codegenErr) {
        console.warn(`[process] Codegen extraction failed, falling back to LLM: ${codegenErr instanceof Error ? codegenErr.message : codegenErr}`);
        const result = await extractWithSkill(sourceText, projectId || '', orgId);
        extraction = result.extraction;
        overallConfidence = result.overallConfidence;
        flags = result.flags;
      }
    } else {
      const result = await extractWithSkill(sourceText, projectId || '', orgId);
      extraction = result.extraction;
      overallConfidence = result.overallConfidence;
      flags = result.flags;
    }

    console.log(`[process] AI extraction complete: skill=${extraction.skillId} confidence=${overallConfidence} flags=${flags.length}`);
  } catch (err) {
    console.error(`[process] AI extraction failed for ${recordId}:`, err);
    await markFailed(sb, recordId, 'ai_extraction', err);
    return { success: false, recordId, status: 'failed', timing, error: 'AI extraction failed' };
  }
  timing.ai_extraction = Date.now() - tStep;

  const hasErrors = flags.some((f) => f.severity === 'error');
  const hasWarnings = flags.some((f) => f.severity === 'warning');
  const autoApproveEligible = overallConfidence >= 0.95 && !hasErrors && !hasWarnings;
  const finalStatus = autoApproveEligible ? 'tier2_validated' : hasErrors ? 'tier2_flagged' : 'pending_review';

  tStep = Date.now();
  let categoryId: string | null = null;
  let canonicalName: string | null = null;
  try {
    const folderName = driveFolderPath?.split(' / ').pop() || null;
    const categoryKey = resolveCategoryKey(extraction.skillId || null, folderName);
    categoryId = await lookupCategoryId(orgId, categoryKey);
    if (!categoryId) {
      categoryId = await lookupCategoryId(orgId, '17_misc');
    }
    canonicalName = generateCanonicalName('ORG', extraction.skillId || '_general', null, fileName);
    console.log(`[process] Category resolved: key=${categoryKey} id=${categoryId} canonical=${canonicalName}`);
  } catch (err) {
    console.warn(`[process] Category resolution failed (non-fatal):`, err);
  }
  timing.category_resolve = Date.now() - tStep;

  tStep = Date.now();
  try {
    const extractionWithDiscovered = Object.keys(discoveredFields).length > 0
      ? { ...extraction, discovered_fields: discoveredFields }
      : extraction;
    const aiModel = Object.keys(discoveredFields).length > 0
      ? 'haiku-classify+sonnet-codegen'
      : 'haiku-classify+sonnet-extract';

    await sb.from('pipeline_log').update({
      document_type: extraction.skillId || null,
      status: finalStatus,
      overall_confidence: overallConfidence,
      extracted_data: extractionWithDiscovered,
      validation_flags: flags.length > 0 ? flags : null,
      ai_model: aiModel,
      tier1_completed_at: new Date().toISOString(),
      tier2_completed_at: new Date().toISOString(),
      ...(categoryId ? { category_id: categoryId } : {}),
      ...(canonicalName ? { canonical_name: canonicalName } : {}),
    }).eq('id', recordId);
    console.log(`[process] Final status saved: ${finalStatus}`);
  } catch (err) {
    console.error(`[process] Failed to update pipeline record ${recordId}:`, err);
  }
  timing.db_final_update = Date.now() - tStep;
  timing.total = Date.now() - t0;

  console.log(`[process] DONE record=${recordId} file="${fileName}" status=${finalStatus} — ` +
    Object.entries(timing).map(([k, v]) => `${k}=${v}ms`).join(' '));

  return { success: true, recordId, status: finalStatus, timing };
}
