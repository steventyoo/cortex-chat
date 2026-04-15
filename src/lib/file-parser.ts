/**
 * Shared file parsing utilities for extracting text from various document formats.
 * Used by both the direct upload endpoint and the Google Drive scanner.
 *
 * Supports: PDF, images (via Claude), XLSX, DOCX, PPTX, email, plain text.
 */

import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
import { extractText as pdfExtractText } from 'unpdf';
import { PDFDocument } from 'pdf-lib';

export const CLAUDE_MAX_BASE64_BYTES = 28 * 1024 * 1024; // ~28MB base64 → ~21MB raw (safe under Claude's 32MB request limit)

export async function getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  return doc.getPageCount();
}

// ── MIME type groups ────────────────────────────────────────────

export const TEXT_TYPES = [
  'text/plain',
  'text/csv',
  'text/html',
  'text/markdown',
  'application/json',
  'application/xml',
  'text/xml',
];

export const PDF_TYPES = ['application/pdf'];

export const IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/tiff',
];

export const EXCEL_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.oasis.opendocument.spreadsheet',
];

export const WORD_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.oasis.opendocument.text',
  'application/rtf',
];

export const PPT_TYPES = [
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument.presentation',
];

export const EMAIL_TYPES = [
  'message/rfc822',
  'application/vnd.ms-outlook',
];

// ── Result type ─────────────────────────────────────────────────

export interface ParseResult {
  text: string;
  method: 'text' | 'pdf-ocr' | 'image-ocr' | 'excel' | 'word' | 'pptx' | 'email';
}

// ── Main entry point ────────────────────────────────────────────

/**
 * Parse a file buffer into text, routing to the appropriate parser based on MIME type.
 * For PDFs and images, uses Claude's document/vision API for OCR.
 */
export interface ParseOptions {
  forceClaudeOcr?: boolean;
}

export async function parseFileBuffer(
  buffer: Buffer,
  mimeType: string,
  _fileName?: string,
  options?: ParseOptions
): Promise<ParseResult> {
  // Text files
  if (TEXT_TYPES.some((t) => mimeType.startsWith(t))) {
    return { text: buffer.toString('utf-8'), method: 'text' };
  }

  // PDF -> try unpdf first (local, fast), fall back to Claude for scanned docs
  if (PDF_TYPES.includes(mimeType)) {
    if (options?.forceClaudeOcr) {
      console.log(`[parseFileBuffer] forceClaudeOcr=true — skipping unpdf for better table fidelity`);
      const base64 = buffer.toString('base64');
      if (base64.length > CLAUDE_MAX_BASE64_BYTES) {
        const text = await extractTextFromLargePdf(buffer);
        return { text, method: 'pdf-ocr' };
      }
      const text = await extractTextWithClaude(base64, 'application/pdf', 'pdf');
      return { text, method: 'pdf-ocr' };
    }
    const t0 = Date.now();
    try {
      const { text } = await pdfExtractText(new Uint8Array(buffer), { mergePages: true });
      const trimmed = (text as string).trim();
      if (trimmed.length > 100) {
        console.log(`[parseFileBuffer] unpdf extracted ${trimmed.length} chars in ${Date.now() - t0}ms (skipping Claude OCR)`);
        return { text: trimmed, method: 'pdf-ocr' };
      }
      console.log(`[parseFileBuffer] unpdf got only ${trimmed.length} chars — falling back to Claude OCR for scanned PDF`);
    } catch (err) {
      console.log(`[parseFileBuffer] unpdf failed (${err instanceof Error ? err.message : 'unknown'}) — falling back to Claude OCR`);
    }
    const base64 = buffer.toString('base64');
    if (base64.length > CLAUDE_MAX_BASE64_BYTES) {
      const text = await extractTextFromLargePdf(buffer);
      return { text, method: 'pdf-ocr' };
    }
    const text = await extractTextWithClaude(base64, 'application/pdf', 'pdf');
    return { text, method: 'pdf-ocr' };
  }

  // Images -> Claude vision API
  if (IMAGE_TYPES.some((t) => mimeType.startsWith(t))) {
    const base64 = buffer.toString('base64');
    const claudeMime = mimeType.startsWith('image/tiff') ? 'image/png' : mimeType;
    const text = await extractTextWithClaude(base64, claudeMime, 'image');
    return { text, method: 'image-ocr' };
  }

  // Excel -> SheetJS
  if (EXCEL_TYPES.some((t) => mimeType === t)) {
    const text = parseExcel(buffer);
    return { text, method: 'excel' };
  }

  // Word -> ZIP XML extraction
  if (WORD_TYPES.some((t) => mimeType === t)) {
    const text = extractTextFromDocx(buffer);
    if (text) return { text, method: 'word' };
    throw new Error('Failed to extract text from Word document');
  }

  // PowerPoint -> ZIP XML extraction
  if (PPT_TYPES.some((t) => mimeType === t)) {
    const text = extractTextFromPptx(buffer);
    if (text) return { text, method: 'pptx' };
    throw new Error('Failed to extract text from PowerPoint');
  }

  // Email
  if (EMAIL_TYPES.some((t) => mimeType === t)) {
    const text = parseEmailText(buffer.toString('utf-8'));
    return { text, method: 'email' };
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}

/**
 * Check if a MIME type is supported for parsing.
 */
export function isSupportedMimeType(mimeType: string): boolean {
  return (
    TEXT_TYPES.some((t) => mimeType.startsWith(t)) ||
    PDF_TYPES.includes(mimeType) ||
    IMAGE_TYPES.some((t) => mimeType.startsWith(t)) ||
    EXCEL_TYPES.some((t) => mimeType === t) ||
    WORD_TYPES.some((t) => mimeType === t) ||
    PPT_TYPES.some((t) => mimeType === t) ||
    EMAIL_TYPES.some((t) => mimeType === t)
  );
}

// ── Claude OCR ──────────────────────────────────────────────────

/**
 * Send a base64-encoded PDF or image to Claude for full text extraction.
 */
export async function extractTextWithClaude(
  base64Data: string,
  mimeType: string,
  method: 'pdf' | 'image'
): Promise<string> {
  const t0 = Date.now();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt =
    'Extract ALL text from this construction document. Return the complete text content exactly as it appears, preserving formatting, tables, numbers, and structure. Do not summarize — output every word.';

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
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8192,
    messages: [{ role: 'user', content }],
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');

  console.log(`[extractTextWithClaude] method=${method} base64Size=${(base64Data.length / 1024).toFixed(0)}KB outputChars=${text.length} elapsed=${Date.now() - t0}ms`);

  return text;
}

/**
 * Split a large PDF into multi-page chunks and OCR them in parallel.
 * Each chunk contains up to CHUNK_PAGES pages (kept under Claude's size limit).
 * Chunks are processed with PARALLEL_CHUNKS concurrent Claude requests.
 */
export async function extractTextFromLargePdf(
  pdfBuffer: Buffer,
  maxPages?: number,
): Promise<string> {
  const t0 = Date.now();
  const CHUNK_PAGES = 10;
  const PARALLEL_CHUNKS = 3;

  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = pdfDoc.getPageCount();
  const pagesToProcess = maxPages ? Math.min(totalPages, maxPages) : totalPages;

  console.log(`[extractTextFromLargePdf] Splitting ${totalPages} pages (processing ${pagesToProcess}) into chunks of ${CHUNK_PAGES}, parallelism=${PARALLEL_CHUNKS}, buffer=${(pdfBuffer.length / 1024 / 1024).toFixed(1)}MB`);

  const chunks: { startPage: number; endPage: number }[] = [];
  for (let i = 0; i < pagesToProcess; i += CHUNK_PAGES) {
    chunks.push({ startPage: i, endPage: Math.min(i + CHUNK_PAGES, pagesToProcess) });
  }

  const chunkTexts: string[] = new Array(chunks.length).fill('');

  for (let batch = 0; batch < chunks.length; batch += PARALLEL_CHUNKS) {
    const batchSlice = chunks.slice(batch, batch + PARALLEL_CHUNKS);
    const batchT0 = Date.now();

    const results = await Promise.allSettled(
      batchSlice.map(async (chunk, batchIdx) => {
        const chunkIdx = batch + batchIdx;
        const pageCount = chunk.endPage - chunk.startPage;
        const chunkDoc = await PDFDocument.create();
        const pageIndices = Array.from({ length: pageCount }, (_, j) => chunk.startPage + j);
        const copiedPages = await chunkDoc.copyPages(pdfDoc, pageIndices);
        copiedPages.forEach(p => chunkDoc.addPage(p));
        const chunkBytes = await chunkDoc.save();
        const chunkBase64 = Buffer.from(chunkBytes).toString('base64');

        if (chunkBase64.length > CLAUDE_MAX_BASE64_BYTES) {
          console.warn(`[extractTextFromLargePdf] Chunk ${chunkIdx + 1} (pages ${chunk.startPage + 1}-${chunk.endPage}) is ${(chunkBase64.length / 1024 / 1024).toFixed(1)}MB — falling back to single-page OCR`);
          const singlePageTexts: string[] = [];
          for (let p = chunk.startPage; p < chunk.endPage; p++) {
            const singleDoc = await PDFDocument.create();
            const [cp] = await singleDoc.copyPages(pdfDoc, [p]);
            singleDoc.addPage(cp);
            const singleBytes = await singleDoc.save();
            const singleBase64 = Buffer.from(singleBytes).toString('base64');
            if (singleBase64.length > CLAUDE_MAX_BASE64_BYTES) {
              singlePageTexts.push(`[Page ${p + 1}: skipped — exceeds size limit]`);
              continue;
            }
            try {
              const text = await extractTextWithClaude(singleBase64, 'application/pdf', 'pdf');
              singlePageTexts.push(`=== Page ${p + 1} ===\n${text}`);
            } catch (err) {
              singlePageTexts.push(`[Page ${p + 1}: OCR failed — ${err instanceof Error ? err.message : String(err)}]`);
            }
          }
          return singlePageTexts.join('\n\n');
        }

        const text = await extractTextWithClaude(chunkBase64, 'application/pdf', 'pdf');
        console.log(`[extractTextFromLargePdf] Chunk ${chunkIdx + 1}/${chunks.length} (pages ${chunk.startPage + 1}-${chunk.endPage}): ${text.length} chars`);
        return `=== Pages ${chunk.startPage + 1}–${chunk.endPage} ===\n${text}`;
      })
    );

    results.forEach((result, batchIdx) => {
      const chunkIdx = batch + batchIdx;
      if (result.status === 'fulfilled') {
        chunkTexts[chunkIdx] = result.value;
      } else {
        const chunk = chunks[chunkIdx];
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        console.warn(`[extractTextFromLargePdf] Chunk ${chunkIdx + 1} (pages ${chunk.startPage + 1}-${chunk.endPage}) failed: ${msg}`);
        chunkTexts[chunkIdx] = `[Pages ${chunk.startPage + 1}–${chunk.endPage}: OCR failed — ${msg}]`;
      }
    });

    console.log(`[extractTextFromLargePdf] Batch ${Math.floor(batch / PARALLEL_CHUNKS) + 1}/${Math.ceil(chunks.length / PARALLEL_CHUNKS)} done in ${Date.now() - batchT0}ms`);
  }

  if (pagesToProcess < totalPages) {
    chunkTexts.push(`[${totalPages - pagesToProcess} additional pages not processed]`);
  }

  const combined = chunkTexts.join('\n\n');
  console.log(`[extractTextFromLargePdf] Done: ${pagesToProcess} pages in ${chunks.length} chunks, ${combined.length} chars, elapsed=${Date.now() - t0}ms`);
  return combined;
}

// ── Excel parser ────────────────────────────────────────────────

function parseExcel(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetTexts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    sheetTexts.push(`=== Sheet: ${sheetName} ===\n${csv}`);
  }
  return sheetTexts.join('\n\n');
}

// ── DOCX parser ─────────────────────────────────────────────────

export function extractTextFromDocx(buffer: Buffer): string | null {
  try {
    return extractXmlTextFromZip(buffer, 'word/document.xml');
  } catch {
    return null;
  }
}

// ── PPTX parser ─────────────────────────────────────────────────

export function extractTextFromPptx(buffer: Buffer): string | null {
  try {
    const texts: string[] = [];
    for (let i = 1; i <= 100; i++) {
      const text = extractXmlTextFromZip(buffer, `ppt/slides/slide${i}.xml`);
      if (text) {
        texts.push(`=== Slide ${i} ===\n${text}`);
      } else {
        break;
      }
    }
    return texts.length > 0 ? texts.join('\n\n') : null;
  } catch {
    return null;
  }
}

// ── Email parser ────────────────────────────────────────────────

export function parseEmailText(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const headers: string[] = [];
  let bodyStart = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') {
      bodyStart = i + 1;
      break;
    }
    const match = lines[i].match(/^(From|To|Cc|Subject|Date):\s*(.+)/i);
    if (match) {
      headers.push(`${match[1]}: ${match[2]}`);
    }
  }

  let body = lines.slice(bodyStart).join('\n');

  if (body.includes('Content-Type: text/plain')) {
    const textMatch = body.match(
      /Content-Type: text\/plain[^\n]*\n(?:Content-Transfer-Encoding:[^\n]*\n)?\n([\s\S]*?)(?:\n--|\n\n--)/
    );
    if (textMatch) {
      body = textMatch[1];
    }
  }

  body = body.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

  return `EMAIL\n${headers.join('\n')}\n\n${body}`.substring(0, 50000);
}

// ── ZIP utilities ───────────────────────────────────────────────

function extractXmlTextFromZip(buffer: Buffer, xmlPath: string): string | null {
  try {
    const zip = findFileInZip(buffer, xmlPath);
    if (!zip) return null;

    const text = zip
      .replace(/<\/w:p>/g, '\n')
      .replace(/<\/a:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return text || null;
  } catch {
    return null;
  }
}

function findFileInZip(zipBuffer: Buffer, targetPath: string): string | null {
  try {
    const { inflateRawSync } = require('zlib');
    let offset = 0;

    while (offset < zipBuffer.length - 4) {
      if (
        zipBuffer[offset] === 0x50 &&
        zipBuffer[offset + 1] === 0x4b &&
        zipBuffer[offset + 2] === 0x03 &&
        zipBuffer[offset + 3] === 0x04
      ) {
        const compressionMethod = zipBuffer.readUInt16LE(offset + 8);
        const compressedSize = zipBuffer.readUInt32LE(offset + 18);
        const uncompressedSize = zipBuffer.readUInt32LE(offset + 22);
        const fileNameLen = zipBuffer.readUInt16LE(offset + 26);
        const extraLen = zipBuffer.readUInt16LE(offset + 28);
        const fileName = zipBuffer.toString('utf-8', offset + 30, offset + 30 + fileNameLen);
        const dataOffset = offset + 30 + fileNameLen + extraLen;

        if (fileName === targetPath) {
          if (compressionMethod === 0) {
            return zipBuffer.toString('utf-8', dataOffset, dataOffset + uncompressedSize);
          } else if (compressionMethod === 8) {
            const compressed = zipBuffer.subarray(dataOffset, dataOffset + compressedSize);
            const decompressed = inflateRawSync(compressed);
            return decompressed.toString('utf-8');
          }
        }

        offset = dataOffset + compressedSize;
      } else {
        offset++;
      }
    }

    return null;
  } catch {
    return null;
  }
}
