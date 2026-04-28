import { getSupabase, lookupCategoryId } from '@/lib/supabase';
import { extractWithSkill, getSkillFieldDefinitions, getSkillFieldDefinitionsScoped, listActiveSkills, classifyDocument, getSkill } from '@/lib/skills';
import { extractWithCodegen, type CodegenExtractionResult } from '@/lib/codegen-extractor';
import { extractWithVision, type VisionExtractionResult } from '@/lib/vision-extractor';
import { getContextCardFieldsForSkill } from '@/lib/stores/context-cards.store';
import type { PatternParserMeta } from '@/lib/pattern-extractor';
import { parseFileBuffer, extractTextWithClaude, extractTextFromLargePdf, CLAUDE_MAX_BASE64_BYTES, getPdfPageCount } from '@/lib/file-parser';
import { ValidationFlag, ExtractionResult, resolveCategoryKey, generateCanonicalName, computeOverallConfidence } from '@/lib/pipeline';
import { ProcessPayload } from '@/lib/qstash';
import { downloadFileContent, downloadFileRaw } from '@/lib/google-drive';
import { runJcrModel } from '@/lib/jcr-model';
import { runPostExtractionValidation } from '@/lib/post-extraction-validator';
import { getLangfuse } from '@/lib/langfuse';
import { extractText as pdfExtractText } from 'unpdf';
import { countPdfPagesSync } from 'pdf-pages-count';

const DOCUMENTS_BUCKET = 'documents';
const LARGE_PDF_PAGE_THRESHOLD = 100;
const LARGE_PDF_SAMPLE_PAGES = 20;

const JCR_SKILL_ID = 'job_cost_report';

const ALWAYS_PROCESS_PATTERNS = [
  /job\s*(cost|detail)\s*report/i,
  /\bjcr\b/i,
  /\bjob\s*detail\b/i,
  /cost\s*report/i,
];

const VISION_EXTS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp']);

function shouldAlwaysProcess(fileName: string, folderPath?: string): boolean {
  const haystack = `${fileName} ${folderPath || ''}`;
  return ALWAYS_PROCESS_PATTERNS.some(p => p.test(haystack));
}

/**
 * Size-safe wrapper: if the base64 exceeds Claude's limit, fall back to
 * page-by-page extraction using pdf-lib to split the PDF.
 */
const CLAUDE_MAX_PDF_PAGES = 100;

async function safePdfOcr(base64Data: string, rawBuffer: Buffer | null): Promise<string> {
  const buf = rawBuffer ?? Buffer.from(base64Data, 'base64');
  const pageCount = await getPdfPageCount(buf).catch(() => 0);

  if (base64Data.length <= CLAUDE_MAX_BASE64_BYTES && pageCount <= CLAUDE_MAX_PDF_PAGES) {
    return extractTextWithClaude(base64Data, 'application/pdf', 'pdf');
  }

  const reason = pageCount > CLAUDE_MAX_PDF_PAGES
    ? `${pageCount} pages (limit ${CLAUDE_MAX_PDF_PAGES})`
    : `${(base64Data.length / 1024 / 1024).toFixed(1)}MB base64`;
  console.log(`[safePdfOcr] PDF too large for single request (${reason}). Using page-by-page OCR.`);
  return extractTextFromLargePdf(buf);
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

/**
 * Fast path for large PDFs (>100 pages): routes directly to vision chunked
 * extraction, bypassing the text OCR step entirely.
 *
 * For JCRs (detected by filename), skips classification too.
 * For unknown document types, OCRs a small sample for classification,
 * then uses vision chunked extraction for the actual field extraction.
 */
async function processLargePdfVision(opts: {
  rawBuffer: Buffer;
  pageCount: number;
  recordId: string;
  orgId: string;
  projectId: string | null;
  fileName: string;
  mimeType: string;
  finalStoragePath?: string | null;
  driveFileId?: string;
  driveModifiedTime?: string;
  driveWebViewLink?: string;
  driveFolderPath?: string;
  trace: ReturnType<ReturnType<typeof getLangfuse>['trace']>;
  sb: ReturnType<typeof getSupabase>;
  timing: Record<string, number>;
  t0: number;
}): Promise<ProcessResult> {
  const {
    rawBuffer, pageCount, recordId, orgId, projectId, fileName,
    finalStoragePath, driveFileId, driveModifiedTime, driveWebViewLink, driveFolderPath,
    trace, sb, timing, t0,
  } = opts;
  const langfuse = getLangfuse();

  let tStep = Date.now();
  const isJcr = isJobCostReport(fileName, driveFolderPath);
  let skill;
  let classifierConfidence: number;

  if (isJcr) {
    console.log(`[process:large-pdf] JCR pattern detected — skipping classification, using skill=${JCR_SKILL_ID}`);
    skill = await getSkill(JCR_SKILL_ID);
    classifierConfidence = 0.95;
    if (!skill) {
      console.error(`[process:large-pdf] JCR skill ${JCR_SKILL_ID} not found — falling back to stored_only`);
      await markFailed(sb, recordId, 'large_pdf_vision', new Error('JCR skill not found'));
      return { success: false, recordId, status: 'failed', timing, error: 'JCR skill not found' };
    }
  } else {
    console.log(`[process:large-pdf] Unknown type — sampling first ${LARGE_PDF_SAMPLE_PAGES} pages for classification`);
    const sampleSpan = trace.span({ name: 'large-pdf-sample-ocr', input: { pageCount, samplePages: LARGE_PDF_SAMPLE_PAGES } });
    try {
      const sampleText = await extractTextFromLargePdf(rawBuffer, LARGE_PDF_SAMPLE_PAGES);
      sampleSpan.end({ output: { sampleChars: sampleText.length } });

      await sb.from('pipeline_log').update({
        source_text: sampleText.substring(0, 500000),
      }).eq('id', recordId);

      const classifySpan = trace.span({ name: 'classify', input: { textLength: sampleText.length } });
      const skills = await listActiveSkills();
      const classification = await classifyDocument(sampleText, skills, orgId, { langfuseParent: classifySpan });
      skill = classification.skillId ? await getSkill(classification.skillId) : null;
      classifierConfidence = classification.confidence;
      classifySpan.end({ output: { skillId: classification.skillId, confidence: classification.confidence } });
      console.log(`[process:large-pdf] Classification: skill=${classification.skillId || 'none'} confidence=${classification.confidence}`);
    } catch (err) {
      sampleSpan.end({ level: 'ERROR', statusMessage: err instanceof Error ? err.message : String(err) });
      console.error(`[process:large-pdf] Sample OCR / classification failed:`, err);
      await markFailed(sb, recordId, 'large_pdf_classification', err);
      return { success: false, recordId, status: 'failed', timing, error: 'Large PDF classification failed' };
    }
  }
  timing.classification = Date.now() - tStep;

  if (!skill || skill.extractionMethod === 'llm') {
    console.log(`[process:large-pdf] No vision/codegen skill matched — falling back to stored_only`);
    await sb.from('pipeline_log').update({
      status: 'stored_only',
      validation_flags: [{
        field: 'page_count',
        issue: `Large document (${pageCount} pages). No vision skill matched; stored for manual review.`,
        severity: 'info',
      }],
    }).eq('id', recordId);
    timing.total = Date.now() - t0;
    return { success: true, recordId, status: 'stored_only', pageCount, timing };
  }

  tStep = Date.now();
  const scopedFields = await getSkillFieldDefinitionsScoped(skill.skillId);
  const catalogFields = scopedFields.get('doc') || [];

  let extraction: ExtractionResult;
  let discoveredFields: Record<string, unknown> = {};
  let overallConfidence: number;
  let flags: ValidationFlag[];
  let usedExtractionMethod = 'vision-chunked';
  let codegenMeta: { generatedCode?: string; formatFingerprint?: string; usedCachedParserId?: string; sourceText?: string; patternMeta?: PatternParserMeta; agentMeta?: CodegenExtractionResult['metadata']['agentMeta'] } = {};

  if (skill.extractionMethod === 'codegen') {
    const codegenSpan = trace.span({
      name: 'large-pdf-codegen-extraction',
      input: { skillId: skill.skillId, pageCount, fileSizeBytes: rawBuffer.length },
    });

    try {
      console.log(`[process:large-pdf] Starting codegen extraction: skill=${skill.skillId} pages=${pageCount}`);
      const contextCardFields = await getContextCardFieldsForSkill(skill.skillId, orgId);

      // Use unpdf (local, fast) for the codegen document preview instead of Claude OCR.
      // unpdf extracts all pages in ~1s vs ~120s for Claude OCR on a subset.
      // IMPORTANT: use mergePages=false to preserve per-page newlines, then rejoin
      // with page markers. mergePages=true strips all newlines, producing a flat
      // string whose format doesn't match pdfplumber output — causing regex mismatches.
      let sourceText: string;
      let sourcePages: string[] | undefined;
      try {
        const unpdfResult = await pdfExtractText(new Uint8Array(rawBuffer), { mergePages: false });
        const pages = unpdfResult.text as string[];
        const unpdfText = pages.map((p, i) => `=== Page ${i + 1} ===\n${p}`).join('\n\n');
        if (unpdfText.length > 500) {
          sourceText = unpdfText;
          sourcePages = pages;
          console.log(`[process:large-pdf] unpdf preview: ${sourceText.length} chars (all ${pageCount} pages, local)`);
        } else {
          console.log(`[process:large-pdf] unpdf sparse (${unpdfText.length} chars) — falling back to Claude OCR`);
          const tailPages = isJcr ? 5 : 0;
          sourceText = await extractTextFromLargePdf(rawBuffer, LARGE_PDF_SAMPLE_PAGES, tailPages || undefined);
        }
      } catch {
        console.log(`[process:large-pdf] unpdf failed — falling back to Claude OCR`);
        const tailPages = isJcr ? 5 : 0;
        sourceText = await extractTextFromLargePdf(rawBuffer, LARGE_PDF_SAMPLE_PAGES, tailPages || undefined);
      }

      const codegenResult: CodegenExtractionResult = await extractWithCodegen(
        rawBuffer, sourceText, skill, catalogFields, contextCardFields,
        classifierConfidence, 'pdf',
        { langfuseParent: codegenSpan, scopedFields, pages: sourcePages, pipelineLogId: recordId },
      );
      extraction = codegenResult.extraction;
      discoveredFields = codegenResult.discoveredFields;
      overallConfidence = computeOverallConfidence(extraction);
      flags = [];
      codegenMeta = {
        generatedCode: codegenResult.metadata.generatedCode,
        formatFingerprint: codegenResult.metadata.formatFingerprint,
        usedCachedParserId: codegenResult.metadata.usedCachedParserId,
        sourceText,
        patternMeta: codegenResult.metadata.patternMeta,
        agentMeta: codegenResult.metadata.agentMeta,
      };

      for (const [fieldName, fieldData] of Object.entries(extraction.fields)) {
        if (fieldData.value !== null && fieldData.confidence < 0.7) {
          flags.push({ field: fieldName, issue: `Low confidence (${Math.round(fieldData.confidence * 100)}%)`, severity: 'warning' });
        }
      }
      usedExtractionMethod = 'codegen';
      codegenSpan.end({
        output: {
          fieldCount: Object.keys(extraction.fields).length,
          recordCount: extraction.records?.length ?? 0,
          targetTableCount: extraction.targetTables?.reduce((sum, t) => sum + t.records.length, 0) ?? 0,
          discoveredCount: Object.keys(discoveredFields).length,
          overallConfidence,
        },
        metadata: {
          generatedCode: codegenResult.metadata.generatedCode,
          formatFingerprint: codegenResult.metadata.formatFingerprint,
          usedCachedParserId: codegenResult.metadata.usedCachedParserId,
          codegenInputTokens: codegenResult.metadata.codegenInputTokens,
          codegenOutputTokens: codegenResult.metadata.codegenOutputTokens,
          sandboxElapsedMs: codegenResult.metadata.sandboxElapsedMs,
          retries: codegenResult.metadata.retries,
          parserMethod: codegenResult.metadata.parserMethod,
        },
      });
      console.log(`[process:large-pdf] Codegen extraction complete: fields=${Object.keys(extraction.fields).length} records=${extraction.records?.length ?? 0} targetTableRows=${extraction.targetTables?.reduce((sum, t) => sum + t.records.length, 0) ?? 0} confidence=${overallConfidence}`);
    } catch (err) {
      codegenSpan.end({ level: 'ERROR', statusMessage: err instanceof Error ? err.message : String(err) });
      console.error(`[process:large-pdf] Codegen extraction failed:`, err);
      await markFailed(sb, recordId, 'large_pdf_codegen', err);
      return { success: false, recordId, status: 'failed', timing, error: 'Large PDF codegen extraction failed' };
    }
  } else {
    const visionSpan = trace.span({
      name: 'large-pdf-vision-extraction',
      input: { skillId: skill.skillId, pageCount, fileSizeBytes: rawBuffer.length },
    });

    try {
      console.log(`[process:large-pdf] Starting vision chunked extraction: skill=${skill.skillId} pages=${pageCount}`);
      const visionResult: VisionExtractionResult = await extractWithVision(
        rawBuffer, skill, catalogFields, classifierConfidence, 'pdf',
        { langfuseParent: visionSpan },
      );
      extraction = visionResult.extraction;
      discoveredFields = visionResult.discoveredFields;
      overallConfidence = visionResult.overallConfidence;
      flags = visionResult.flags;
      visionSpan.end({
        output: {
          fieldCount: Object.keys(extraction.fields).length,
          recordCount: extraction.records?.length ?? 0,
          discoveredCount: Object.keys(discoveredFields).length,
          overallConfidence,
        },
        metadata: {
          inputTokens: visionResult.metadata.inputTokens,
          outputTokens: visionResult.metadata.outputTokens,
          elapsedMs: visionResult.metadata.elapsedMs,
        },
      });
      console.log(`[process:large-pdf] Vision extraction complete: fields=${Object.keys(extraction.fields).length} records=${extraction.records?.length ?? 0} confidence=${overallConfidence}`);
    } catch (err) {
      visionSpan.end({ level: 'ERROR', statusMessage: err instanceof Error ? err.message : String(err) });
      console.error(`[process:large-pdf] Vision extraction failed:`, err);
      await markFailed(sb, recordId, 'large_pdf_vision', err);
      return { success: false, recordId, status: 'failed', timing, error: 'Large PDF vision extraction failed' };
    }
  }
  timing.ai_extraction = Date.now() - tStep;

  const hasErrors = flags.some(f => f.severity === 'error');
  const hasWarnings = flags.some(f => f.severity === 'warning');
  const autoApproveEligible = overallConfidence >= 0.95 && !hasErrors && !hasWarnings;
  const finalStatus = autoApproveEligible ? 'tier2_validated' : hasErrors ? 'tier2_flagged' : 'pending_review';

  tStep = Date.now();
  let categoryId: string | null = null;
  let canonicalName: string | null = null;
  try {
    const folderName = driveFolderPath?.split(' / ').pop() || null;
    const categoryKey = resolveCategoryKey(extraction.skillId || null, folderName);
    categoryId = await lookupCategoryId(orgId, categoryKey);
    if (!categoryId) categoryId = await lookupCategoryId(orgId, '17_misc');
    canonicalName = generateCanonicalName('ORG', extraction.skillId || '_general', null, fileName);
  } catch (err) {
    console.warn(`[process:large-pdf] Category resolution failed (non-fatal):`, err);
  }
  timing.category_resolve = Date.now() - tStep;

  tStep = Date.now();
  try {
    const extractionWithDiscovered = Object.keys(discoveredFields).length > 0
      ? { ...extraction, discovered_fields: discoveredFields }
      : extraction;

    await sb.from('pipeline_log').update({
      document_type: extraction.skillId || null,
      status: finalStatus,
      overall_confidence: overallConfidence,
      extracted_data: extractionWithDiscovered,
      validation_flags: flags.length > 0 ? flags : null,
      ai_model: usedExtractionMethod === 'codegen' ? 'opus-codegen' : 'opus-vision-chunked',
      tier1_completed_at: new Date().toISOString(),
      tier2_completed_at: new Date().toISOString(),
      page_count: pageCount,
      ...(categoryId ? { category_id: categoryId } : {}),
      ...(canonicalName ? { canonical_name: canonicalName } : {}),
      ...(finalStoragePath ? { storage_path: finalStoragePath } : {}),
      ...(driveModifiedTime ? { drive_modified_time: driveModifiedTime } : {}),
      ...(driveWebViewLink ? { drive_web_view_link: driveWebViewLink } : {}),
      ...(driveFolderPath ? { drive_folder_path: driveFolderPath } : {}),
      ...(driveFileId ? { drive_file_id: driveFileId } : {}),
    }).eq('id', recordId);
    console.log(`[process:large-pdf] Final status saved: ${finalStatus}`);
  } catch (err) {
    console.error(`[process:large-pdf] Failed to update pipeline record:`, err);
  }
  timing.db_final_update = Date.now() - tStep;

  // Post-extraction validation for non-JCR skills
  if (extraction.skillId && extraction.skillId !== JCR_SKILL_ID) {
    try {
      const valT = Date.now();
      let tailText: string | undefined;
      try {
        tailText = await extractTextFromLargePdf(rawBuffer, 0, 5);
      } catch { /* non-fatal */ }

      const fields = extraction.fields as Record<string, { value: string | number | null; confidence: number }>;
      const collections: Record<string, Array<Record<string, { value: string | number | null; confidence: number }>>> = {};
      if (extraction.records?.length) {
        collections.records = extraction.records as Array<Record<string, { value: string | number | null; confidence: number }>>;
      }
      for (const tt of extraction.targetTables ?? []) {
        if (tt.table && tt.records?.length) {
          collections[tt.table] = tt.records as Array<Record<string, { value: string | number | null; confidence: number }>>;
        }
      }

      const valResult = await runPostExtractionValidation({
        pipelineLogId: recordId,
        skillId: extraction.skillId,
        fields,
        collections,
        tailText,
        ...codegenMeta,
      });
      timing.validation = Date.now() - valT;
      console.log(
        `[process:large-pdf] Validation complete for skill=${extraction.skillId}: ` +
        `identity=${valResult.identityScore}% quality=${valResult.qualityScore}% elapsed=${timing.validation}ms`
      );
    } catch (err) {
      console.warn(`[process:large-pdf] Post-extraction validation failed (non-fatal):`, err);
    }
  }

  if (extraction.skillId === JCR_SKILL_ID && extraction.records?.length) {
    try {
      const jcrT = Date.now();
      const workerRecords = extraction.targetTables
        ?.find(t => t.table === 'payroll_transactions' || t.table === 'worker_transactions')?.records;

      // Extract tail pages for targeted re-extraction if consistency checks fail
      let jcrTailText: string | undefined;
      try {
        jcrTailText = await extractTextFromLargePdf(rawBuffer, 0, 5);
      } catch { /* non-fatal */ }

      const jcrResult = await runJcrModel(recordId, projectId || '', orgId, {
        fields: extraction.fields as Record<string, { value: string | number | null; confidence: number }>,
        records: extraction.records as Array<Record<string, { value: string | number | null; confidence: number }>>,
        skillId: extraction.skillId,
        workerRecords: workerRecords as Array<Record<string, { value: string | number | null; confidence: number }>> | undefined,
      }, {}, { tailText: jcrTailText, ...codegenMeta });
      timing.jcr_model = Date.now() - jcrT;
      console.log(`[process:large-pdf] JCR model complete: rows=${jcrResult.rowCount} identity=${jcrResult.identityScore}% quality=${jcrResult.qualityScore}% workers=${workerRecords?.length ?? 0} elapsed=${timing.jcr_model}ms`);
    } catch (err) {
      console.warn(`[process:large-pdf] JCR model failed (non-fatal):`, err);
    }
  }

  timing.total = Date.now() - t0;

  console.log(`[process:large-pdf] DONE record=${recordId} file="${fileName}" status=${finalStatus} pages=${pageCount} — ` +
    Object.entries(timing).map(([k, v]) => `${k}=${v}ms`).join(' '));

  trace.update({
    output: {
      status: finalStatus,
      extractionMethod: usedExtractionMethod,
      skillId: extraction.skillId,
      overallConfidence,
      fieldCount: Object.keys(extraction.fields).length,
      recordCount: extraction.records?.length ?? 0,
      targetTableRows: extraction.targetTables?.reduce((sum, t) => sum + t.records.length, 0) ?? 0,
      flagCount: flags.length,
      pageCount,
    },
    metadata: { ...timing, extractionMethod: usedExtractionMethod },
  });
  langfuse.flushAsync().catch(() => {});

  return { success: true, recordId, status: finalStatus, pageCount, timing };
}

export async function processDocument(payload: ProcessPayload): Promise<ProcessResult> {
  const {
    recordId, orgId, projectId, fileName, mimeType, storagePath,
    driveFileId, driveModifiedTime, driveWebViewLink, driveFolderPath,
    forceProcess,
  } = payload;
  const t0 = Date.now();
  const timing: Record<string, number> = {};
  const fileExt = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() || '' : '';

  const langfuse = getLangfuse();
  const trace = langfuse.trace({
    name: 'document-extraction',
    userId: orgId,
    sessionId: recordId,
    input: { fileName, mimeType, fileExt, driveFileId, driveFolderPath },
    metadata: { orgId, projectId, recordId },
  });

  console.log(`[process] START record=${recordId} file="${fileName}" mime=${mimeType} drive=${driveFileId || 'n/a'}`);

  const sb = getSupabase();

  await sb.from('pipeline_log').update({ status: 'processing' }).eq('id', recordId);

  let tStep = Date.now();
  let sourceText: string;
  let sourcePages: string[] | undefined;
  let finalStoragePath = storagePath;
  let pdfBuffer: Buffer | null = null;

  if (driveFileId) {
    let rawBuffer: Buffer | null = null;

    try {
      console.log(`[process] Downloading raw file from Drive: drive_id=${driveFileId}`);
      const { buffer, effectiveMimeType } = await downloadFileRaw(driveFileId, mimeType);
      rawBuffer = buffer;
      if (isPdf(mimeType, fileName)) pdfBuffer = buffer;
      timing.drive_raw_download = Date.now() - tStep;
      console.log(`[process] Drive raw download complete: ${buffer.length} bytes, effectiveMime=${effectiveMimeType}`);

      const MAX_FILE_BYTES = 200 * 1024 * 1024; // 200 MB
      if (buffer.length > MAX_FILE_BYTES) {
        console.warn(`[process] File too large (${(buffer.length / 1024 / 1024).toFixed(0)} MB) — marking stored_only: ${recordId}`);
        await sb.from('pipeline_log').update({
          status: 'stored_only',
          storage_path: finalStoragePath || undefined,
          validation_flags: [{ field: '_system', issue: `File too large for processing (${(buffer.length / 1024 / 1024).toFixed(0)} MB, limit 200 MB)`, severity: 'info' }],
        }).eq('id', recordId);
        return { success: true, recordId, status: 'stored_only', timing };
      }

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
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.startsWith('FILE_TOO_LARGE:')) {
        console.warn(`[process] ${errMsg} — marking stored_only: ${recordId}`);
        await sb.from('pipeline_log').update({
          status: 'stored_only',
          validation_flags: [{ field: '_system', issue: errMsg, severity: 'info' }],
        }).eq('id', recordId);
        return { success: true, recordId, status: 'stored_only', timing };
      }
      console.error(`[process] Drive raw download failed for ${recordId}:`, err);
    }

    if (rawBuffer && isPdf(mimeType, fileName)) {
      try {
        const pageCount = countPdfPagesSync(new Uint8Array(rawBuffer));
        console.log(`[process] PDF page count: ${pageCount} pages (threshold=${LARGE_PDF_PAGE_THRESHOLD}) forceProcess=${!!forceProcess}`);

        await sb.from('pipeline_log').update({ page_count: pageCount }).eq('id', recordId);

        if (pageCount > LARGE_PDF_PAGE_THRESHOLD && !forceProcess) {
          console.log(`[process] Large PDF (${pageCount} pages) — routing to vision chunked extraction (zero data loss)`);
          return processLargePdfVision({
            rawBuffer: rawBuffer!, pageCount, recordId, orgId, projectId, fileName, mimeType,
            finalStoragePath, driveFileId, driveModifiedTime, driveWebViewLink, driveFolderPath,
            trace, sb, timing, t0,
          });
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
          sourceText = await safePdfOcr(content.base64, rawBuffer);
        } else {
          const pdfBuffer = rawBuffer || Buffer.from(content.base64, 'base64');
          try {
            const unpdfResult = await pdfExtractText(new Uint8Array(pdfBuffer), { mergePages: false });
            const pdfPages = unpdfResult.text as string[];
            const trimmed = pdfPages.join('\n').trim();
            if (trimmed.length > 100) {
              sourceText = trimmed;
              sourcePages = pdfPages;
              console.log(`[process] PDF text via unpdf: ${sourceText.length} chars, ${pdfPages.length} pages`);
            } else {
              console.log(`[process] unpdf returned sparse text (${trimmed.length} chars), falling back to Claude OCR`);
              sourceText = await safePdfOcr(content.base64, rawBuffer);
            }
          } catch {
            console.log(`[process] unpdf failed, falling back to Claude OCR`);
            sourceText = await safePdfOcr(content.base64, rawBuffer);
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
      if (isPdf(mimeType, fileName)) pdfBuffer = fileBuffer;
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

        if (pageCount > LARGE_PDF_PAGE_THRESHOLD && !forceProcess) {
          console.log(`[process] Large PDF (${pageCount} pages) — routing to vision chunked extraction (zero data loss)`);
          return processLargePdfVision({
            rawBuffer: fileBuffer, pageCount, recordId, orgId, projectId, fileName, mimeType,
            finalStoragePath: storagePath, trace, sb, timing, t0,
          });
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
      // Extract per-page text for PDFs to enable the extraction agent
      if (isPdf(mimeType, fileName) && !forceOcr) {
        try {
          const unpdfResult = await pdfExtractText(new Uint8Array(fileBuffer), { mergePages: false });
          sourcePages = unpdfResult.text as string[];
          console.log(`[process] Extracted ${sourcePages.length} pages for agent`);
        } catch {
          console.log(`[process] Per-page extraction failed (non-fatal), agent will be skipped`);
        }
      }
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
  let usedExtractionMethod = 'llm';
  let codegenMeta: { generatedCode?: string; formatFingerprint?: string; usedCachedParserId?: string; sourceText?: string; patternMeta?: PatternParserMeta; agentMeta?: CodegenExtractionResult['metadata']['agentMeta'] } = {};

  try {
    console.log(`[process] Starting AI extraction: project=${projectId || 'none'} org=${orgId}`);

    const classifySpan = trace.span({ name: 'classify', input: { textLength: sourceText.length } });
    const skills = await listActiveSkills();
    const classification = await classifyDocument(sourceText, skills, orgId, { langfuseParent: classifySpan });
    const skill = classification.skillId ? await getSkill(classification.skillId) : null;
    classifySpan.end({
      output: {
        skillId: classification.skillId,
        confidence: classification.confidence,
        reasoning: classification.reasoning,
        extractionMethod: skill?.extractionMethod || 'llm',
      },
    });

    if (skill?.extractionMethod === 'vision') {
      const scopedFields = await getSkillFieldDefinitionsScoped(skill.skillId);
      const catalogFields = scopedFields.get('doc') || [];
      const fileExt = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() || '' : '';

      let docBuffer: Buffer;
      if (driveFileId) {
        const { buffer } = await downloadFileRaw(driveFileId, mimeType);
        docBuffer = buffer;
      } else {
        const { data: dlData } = await sb.storage.from(DOCUMENTS_BUCKET).download(storagePath);
        docBuffer = Buffer.from(await dlData!.arrayBuffer());
      }

      if (VISION_EXTS.has(fileExt)) {
        console.log(`[process] Using VISION extraction for skill=${skill.skillId} ext=${fileExt}`);
        const visionSpan = trace.span({ name: 'vision-extraction', input: { skillId: skill.skillId, fileExt, fileSize: docBuffer.length } });
        try {
          const visionResult: VisionExtractionResult = await extractWithVision(
            docBuffer, skill, catalogFields, classification.confidence, fileExt,
            { langfuseParent: visionSpan },
          );
          extraction = visionResult.extraction;
          discoveredFields = visionResult.discoveredFields;
          overallConfidence = visionResult.overallConfidence;
          flags = visionResult.flags;
          usedExtractionMethod = 'vision';
          visionSpan.end({
            output: {
              fieldCount: Object.keys(extraction.fields).length,
              recordCount: extraction.records?.length ?? 0,
              discoveredCount: Object.keys(discoveredFields).length,
              overallConfidence,
              fields: extraction.fields,
              discoveredFields,
            },
            metadata: {
              inputTokens: visionResult.metadata.inputTokens,
              outputTokens: visionResult.metadata.outputTokens,
              elapsedMs: visionResult.metadata.elapsedMs,
            },
          });
          console.log(`[process] Vision extraction complete: skill=${extraction.skillId} confidence=${overallConfidence} discovered=${Object.keys(discoveredFields).length}`);
        } catch (visionErr) {
          visionSpan.end({ level: 'ERROR', statusMessage: visionErr instanceof Error ? visionErr.message : String(visionErr) });
          console.warn(`[process] Vision extraction failed, falling back to LLM: ${visionErr instanceof Error ? visionErr.message : visionErr}`);
          const fallbackSpan = trace.span({ name: 'llm-fallback', input: { reason: 'vision-failed' } });
          const result = await extractWithSkill(sourceText, projectId || '', orgId, { langfuseParent: fallbackSpan });
          extraction = result.extraction;
          overallConfidence = result.overallConfidence;
          flags = result.flags;
          fallbackSpan.end({ output: { fields: extraction.fields, overallConfidence } });
        }
      } else {
        console.log(`[process] Using CODEGEN extraction for skill=${skill.skillId} ext=${fileExt} (non-PDF/image)`);
        const contextCardFields = await getContextCardFieldsForSkill(skill.skillId, orgId);
        const codegenSpan = trace.span({ name: 'codegen-extraction', input: { skillId: skill.skillId, fileExt, fileSize: docBuffer.length } });

        try {
          const codegenResult: CodegenExtractionResult = await extractWithCodegen(
            docBuffer, sourceText, skill, catalogFields, contextCardFields,
            classification.confidence, fileExt,
            { langfuseParent: codegenSpan, scopedFields, pages: sourcePages, pipelineLogId: recordId },
          );
          extraction = codegenResult.extraction;
          discoveredFields = codegenResult.discoveredFields;
          overallConfidence = computeOverallConfidence(extraction);
          flags = [];
          codegenMeta = {
            generatedCode: codegenResult.metadata.generatedCode,
            formatFingerprint: codegenResult.metadata.formatFingerprint,
            usedCachedParserId: codegenResult.metadata.usedCachedParserId,
            sourceText,
            patternMeta: codegenResult.metadata.patternMeta,
            agentMeta: codegenResult.metadata.agentMeta,
          };

          for (const [fieldName, fieldData] of Object.entries(extraction.fields)) {
            if (fieldData.value !== null && fieldData.confidence < 0.7) {
              flags.push({ field: fieldName, issue: `Low confidence (${Math.round(fieldData.confidence * 100)}%)`, severity: 'warning' });
            }
          }
          usedExtractionMethod = 'codegen';
          codegenSpan.end({
            output: {
              fieldCount: Object.keys(extraction.fields).length,
              recordCount: extraction.records?.length ?? 0,
              discoveredCount: Object.keys(discoveredFields).length,
              overallConfidence,
              fields: extraction.fields,
              discoveredFields,
              records: extraction.records?.slice(0, 5),
            },
            metadata: {
              generatedCode: codegenResult.metadata.generatedCode,
              codegenInputTokens: codegenResult.metadata.codegenInputTokens,
              codegenOutputTokens: codegenResult.metadata.codegenOutputTokens,
              sandboxElapsedMs: codegenResult.metadata.sandboxElapsedMs,
              retries: codegenResult.metadata.retries,
              parserMethod: codegenResult.metadata.parserMethod,
            },
          });
          console.log(`[process] Codegen extraction complete: skill=${extraction.skillId} confidence=${overallConfidence} discovered=${Object.keys(discoveredFields).length}`);
        } catch (codegenErr) {
          codegenSpan.end({ level: 'ERROR', statusMessage: codegenErr instanceof Error ? codegenErr.message : String(codegenErr) });
          console.warn(`[process] Codegen extraction failed, falling back to LLM: ${codegenErr instanceof Error ? codegenErr.message : codegenErr}`);
          const fallbackSpan2 = trace.span({ name: 'llm-fallback', input: { reason: 'codegen-failed' } });
          const result = await extractWithSkill(sourceText, projectId || '', orgId, { langfuseParent: fallbackSpan2 });
          extraction = result.extraction;
          overallConfidence = result.overallConfidence;
          flags = result.flags;
          fallbackSpan2.end({ output: { fields: extraction.fields, overallConfidence } });
        }
      }
    } else if (skill?.extractionMethod === 'codegen') {
      console.log(`[process] Using CODEGEN extraction for skill=${skill.skillId}`);
      const scopedFields2 = await getSkillFieldDefinitionsScoped(skill.skillId);
      const catalogFields = scopedFields2.get('doc') || [];
      const contextCardFields = await getContextCardFieldsForSkill(skill.skillId, orgId);
      const fileExt = fileName.includes('.') ? fileName.split('.').pop() || '' : '';

      let docBuffer: Buffer;
      if (driveFileId) {
        const { buffer } = await downloadFileRaw(driveFileId, mimeType);
        docBuffer = buffer;
      } else {
        const { data: dlData } = await sb.storage.from(DOCUMENTS_BUCKET).download(storagePath);
        docBuffer = Buffer.from(await dlData!.arrayBuffer());
      }

      const codegenSpan2 = trace.span({ name: 'codegen-extraction', input: { skillId: skill.skillId, fileExt, fileSize: docBuffer.length } });
      try {
        const codegenResult: CodegenExtractionResult = await extractWithCodegen(
          docBuffer, sourceText, skill, catalogFields, contextCardFields,
          classification.confidence, fileExt,
          { langfuseParent: codegenSpan2, scopedFields: scopedFields2, pages: sourcePages, pipelineLogId: recordId },
        );
        extraction = codegenResult.extraction;
        discoveredFields = codegenResult.discoveredFields;
        overallConfidence = computeOverallConfidence(extraction);
        flags = [];
        codegenMeta = {
          generatedCode: codegenResult.metadata.generatedCode,
          formatFingerprint: codegenResult.metadata.formatFingerprint,
          usedCachedParserId: codegenResult.metadata.usedCachedParserId,
          sourceText,
          patternMeta: codegenResult.metadata.patternMeta,
          agentMeta: codegenResult.metadata.agentMeta,
        };

        for (const [fieldName, fieldData] of Object.entries(extraction.fields)) {
          if (fieldData.value !== null && fieldData.confidence < 0.7) {
            flags.push({ field: fieldName, issue: `Low confidence (${Math.round(fieldData.confidence * 100)}%)`, severity: 'warning' });
          }
        }
        usedExtractionMethod = 'codegen';
        codegenSpan2.end({
          output: { fields: extraction.fields, discoveredFields, records: extraction.records?.slice(0, 5) },
          metadata: {
            generatedCode: codegenResult.metadata.generatedCode,
            formatFingerprint: codegenResult.metadata.formatFingerprint,
            codegenInputTokens: codegenResult.metadata.codegenInputTokens,
            codegenOutputTokens: codegenResult.metadata.codegenOutputTokens,
            sandboxElapsedMs: codegenResult.metadata.sandboxElapsedMs,
            retries: codegenResult.metadata.retries,
          },
        });
        console.log(`[process] Codegen extraction complete: skill=${extraction.skillId} confidence=${overallConfidence} discovered=${Object.keys(discoveredFields).length}`);
      } catch (codegenErr) {
        codegenSpan2.end({ level: 'ERROR', statusMessage: codegenErr instanceof Error ? codegenErr.message : String(codegenErr) });
        console.warn(`[process] Codegen extraction failed, falling back to LLM: ${codegenErr instanceof Error ? codegenErr.message : codegenErr}`);
        const legacyFallbackSpan = trace.span({ name: 'llm-fallback', input: { reason: 'codegen-failed' } });
        const result = await extractWithSkill(sourceText, projectId || '', orgId, { langfuseParent: legacyFallbackSpan });
        extraction = result.extraction;
        overallConfidence = result.overallConfidence;
        flags = result.flags;
        legacyFallbackSpan.end({ output: { fields: extraction.fields, overallConfidence } });
      }
    } else {
      const llmSpan = trace.span({ name: 'llm-extraction', input: { textLength: sourceText.length } });
      const result = await extractWithSkill(sourceText, projectId || '', orgId, { langfuseParent: llmSpan });
      extraction = result.extraction;
      overallConfidence = result.overallConfidence;
      flags = result.flags;
      llmSpan.end({ output: { fields: extraction.fields, overallConfidence } });
    }

    console.log(`[process] AI extraction complete: skill=${extraction.skillId} confidence=${overallConfidence} flags=${flags.length}`);
  } catch (err) {
    console.error(`[process] AI extraction failed for ${recordId}:`, err);
    trace.update({ output: { error: err instanceof Error ? err.message : 'Unknown error' } });
    langfuse.flushAsync().catch(() => {});
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
    const aiModel = usedExtractionMethod === 'vision'
      ? 'haiku-classify+opus-vision'
      : usedExtractionMethod === 'codegen'
        ? 'haiku-classify+opus-codegen'
        : 'haiku-classify+opus-extract';

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

  // ── Post-extraction validation (runs for ALL document skills) ──
  // For JCR, this is called internally by runJcrModel after its transforms.
  // For all other skills, run the generic validator directly here.
  if (extraction.skillId && extraction.skillId !== JCR_SKILL_ID) {
    try {
      const valT = Date.now();
      let tailText: string | undefined;
      if (pdfBuffer) {
        try {
          tailText = await extractTextFromLargePdf(pdfBuffer, 0, 5);
        } catch { /* non-fatal */ }
      }

      const fields = extraction.fields as Record<string, { value: string | number | null; confidence: number }>;
      const collections: Record<string, Array<Record<string, { value: string | number | null; confidence: number }>>> = {};
      if (extraction.records?.length) {
        collections.records = extraction.records as Array<Record<string, { value: string | number | null; confidence: number }>>;
      }
      for (const tt of extraction.targetTables ?? []) {
        if (tt.table && tt.records?.length) {
          collections[tt.table] = tt.records as Array<Record<string, { value: string | number | null; confidence: number }>>;
        }
      }

      const valResult = await runPostExtractionValidation({
        pipelineLogId: recordId,
        skillId: extraction.skillId,
        fields,
        collections,
        tailText,
        ...codegenMeta,
      });
      timing.validation = Date.now() - valT;
      console.log(
        `[process] Validation complete for skill=${extraction.skillId}: ` +
        `identity=${valResult.identityScore}% quality=${valResult.qualityScore}% elapsed=${timing.validation}ms`
      );
    } catch (err) {
      console.warn(`[process] Post-extraction validation failed (non-fatal):`, err);
    }
  }

  // Run JCR Model Engine if this is a job cost report with records
  if (extraction.skillId === JCR_SKILL_ID && extraction.records?.length) {
    try {
      const jcrT = Date.now();
      const workerRecords = extraction.targetTables
        ?.find(t => t.table === 'payroll_transactions' || t.table === 'worker_transactions')?.records;

      // Extract tail pages for targeted re-extraction if consistency checks fail
      let jcrTailText: string | undefined;
      if (pdfBuffer) {
        try {
          jcrTailText = await extractTextFromLargePdf(pdfBuffer, 0, 5);
        } catch { /* non-fatal */ }
      }

      const jcrResult = await runJcrModel(recordId, projectId || '', orgId, {
        fields: extraction.fields as Record<string, { value: string | number | null; confidence: number }>,
        records: extraction.records as Array<Record<string, { value: string | number | null; confidence: number }>>,
        skillId: extraction.skillId,
        workerRecords: workerRecords as Array<Record<string, { value: string | number | null; confidence: number }>> | undefined,
      }, {}, { tailText: jcrTailText, ...codegenMeta });
      timing.jcr_model = Date.now() - jcrT;
      console.log(`[process] JCR model complete: rows=${jcrResult.rowCount} identity=${jcrResult.identityScore}% quality=${jcrResult.qualityScore}% workers=${workerRecords?.length ?? 0} elapsed=${timing.jcr_model}ms`);
    } catch (err) {
      console.warn(`[process] JCR model failed (non-fatal):`, err);
    }
  }

  timing.total = Date.now() - t0;

  console.log(`[process] DONE record=${recordId} file="${fileName}" status=${finalStatus} — ` +
    Object.entries(timing).map(([k, v]) => `${k}=${v}ms`).join(' '));

  trace.update({
    output: {
      status: finalStatus,
      extractionMethod: usedExtractionMethod,
      skillId: extraction.skillId,
      overallConfidence,
      fieldCount: Object.keys(extraction.fields).length,
      recordCount: extraction.records?.length ?? 0,
      flagCount: flags.length,
    },
    metadata: { ...timing, extractionMethod: usedExtractionMethod },
  });
  langfuse.flushAsync().catch(() => {});

  return { success: true, recordId, status: finalStatus, timing };
}
