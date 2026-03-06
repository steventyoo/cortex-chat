// Google Drive integration for document pipeline
// Watches a Drive folder structure and surfaces new files for processing

import { google, drive_v3 } from 'googleapis';
import * as XLSX from 'xlsx';

// ─── Types ──────────────────────────────────────────────────────

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  modifiedTime: string;
  webViewLink: string;
  size: number;
  parentFolderId: string;
  parentFolderName: string; // project folder name
}

export interface DriveFolder {
  id: string;
  name: string;
}

export interface DriveFileContent {
  text: string | null; // Extracted text (for text-based files)
  base64: string | null; // Base64 data (for PDFs/images to send to Claude)
  mimeType: string;
  method: 'text' | 'pdf' | 'image' | 'google-doc' | 'excel' | 'word' | 'email' | 'unsupported';
}

// ─── Auth & Client ──────────────────────────────────────────────

function getDriveClient(): drive_v3.Drive {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')?.trim();

  if (!email || !key) {
    throw new Error('Google Drive credentials not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in env.');
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key: key,
    },
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  return google.drive({ version: 'v3', auth });
}

function getRootFolderId(): string {
  const id = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  if (!id) {
    throw new Error('GOOGLE_DRIVE_FOLDER_ID not set. Set it to the root "Project Cortex" folder ID.');
  }
  return id;
}

// ─── Folder Operations ─────────────────────────────────────────

/**
 * List all project sub-folders inside the root Drive folder.
 * Each sub-folder represents a project (e.g., "Compass Northgate M2").
 * Also includes a virtual "_Inbox" if it exists for unassigned docs.
 */
export async function listProjectFolders(): Promise<DriveFolder[]> {
  const drive = getDriveClient();
  const rootId = getRootFolderId();

  const res = await drive.files.list({
    q: `'${rootId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    orderBy: 'name',
  });

  return (res.data.files || []).map((f) => ({
    id: f.id!,
    name: f.name!,
  }));
}

// ─── File Operations ────────────────────────────────────────────

/**
 * List all files inside a specific folder (non-recursive).
 * Returns actual files only (not sub-folders).
 */
export async function listFilesInFolder(
  folderId: string,
  folderName: string
): Promise<DriveFile[]> {
  const drive = getDriveClient();

  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name, mimeType, createdTime, modifiedTime, webViewLink, size)',
    orderBy: 'createdTime desc',
    pageSize: 100,
  });

  return (res.data.files || []).map((f) => ({
    id: f.id!,
    name: f.name!,
    mimeType: f.mimeType!,
    createdTime: f.createdTime!,
    modifiedTime: f.modifiedTime!,
    webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
    size: Number(f.size || 0),
    parentFolderId: folderId,
    parentFolderName: folderName,
  }));
}

/**
 * List ALL files across all project folders + root.
 * Returns files tagged with their parent folder name (= project name).
 */
export async function listAllDriveFiles(): Promise<DriveFile[]> {
  const rootId = getRootFolderId();
  const folders = await listProjectFolders();

  // Fetch files from all folders + root in parallel
  const results = await Promise.allSettled([
    // Files directly in root folder (unassigned)
    listFilesInFolder(rootId, '_Root'),
    // Files in each project sub-folder
    ...folders.map((folder) => listFilesInFolder(folder.id, folder.name)),
  ]);

  const allFiles: DriveFile[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allFiles.push(...result.value);
    }
  }

  return allFiles;
}

// ─── Supported MIME Types ───────────────────────────────────────

/** Plain text and structured text formats */
const TEXT_TYPES = [
  'text/plain',
  'text/csv',
  'text/html',
  'text/markdown',
  'application/json',
  'application/xml',
  'text/xml',
];

/** PDF */
const PDF_TYPES = ['application/pdf'];

/** Images (for OCR via Claude vision) */
const IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/tiff',
];

/** Excel / spreadsheet files (parsed with SheetJS) */
const EXCEL_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'application/vnd.oasis.opendocument.spreadsheet', // .ods
];

/** Word / document files (sent to Claude as-is for extraction) */
const WORD_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
  'application/vnd.oasis.opendocument.text', // .odt
  'application/rtf', // .rtf
];

/** PowerPoint / presentation files */
const PPT_TYPES = [
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.ms-powerpoint', // .ppt
  'application/vnd.oasis.opendocument.presentation', // .odp
];

/** Email files */
const EMAIL_TYPES = [
  'message/rfc822', // .eml
  'application/vnd.ms-outlook', // .msg
];

/** Google Workspace types (exportable as text) */
const GOOGLE_DOC_TYPES = [
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
];

// ─── File Content Download ──────────────────────────────────────

/**
 * Download and extract content from a Drive file.
 * Handles all major document formats:
 * - Text files: returns raw text
 * - PDFs: returns base64 for Claude document processing
 * - Images: returns base64 for Claude vision OCR
 * - Excel/Spreadsheets: parsed to CSV text with SheetJS
 * - Word/DOCX: downloaded as binary, sent to Claude for text extraction
 * - PowerPoint/PPTX: downloaded as binary, sent to Claude for text extraction
 * - Emails (.eml/.msg): downloaded and parsed for text content
 * - Google Docs/Sheets/Slides: exported as plain text
 */
export async function downloadFileContent(
  fileId: string,
  mimeType: string
): Promise<DriveFileContent> {
  const drive = getDriveClient();

  // Google Docs/Sheets/Slides → export as plain text
  if (GOOGLE_DOC_TYPES.some((t) => mimeType.startsWith(t))) {
    try {
      // Sheets → export as CSV for better structure preservation
      const exportMime = mimeType.includes('spreadsheet') ? 'text/csv' : 'text/plain';
      const res = await drive.files.export(
        { fileId, mimeType: exportMime },
        { responseType: 'arraybuffer' }
      );
      const text = Buffer.from(res.data as ArrayBuffer).toString('utf-8');
      return { text, base64: null, mimeType: exportMime, method: 'google-doc' };
    } catch (err) {
      console.error('Failed to export Google Doc:', err);
      return { text: null, base64: null, mimeType, method: 'unsupported' };
    }
  }

  // Text files → download and read as string
  if (TEXT_TYPES.some((t) => mimeType.startsWith(t))) {
    try {
      const res = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' }
      );
      const text = Buffer.from(res.data as ArrayBuffer).toString('utf-8');
      return { text, base64: null, mimeType, method: 'text' };
    } catch (err) {
      console.error('Failed to download text file:', err);
      return { text: null, base64: null, mimeType, method: 'unsupported' };
    }
  }

  // PDFs → download binary, return as base64 for Claude
  if (PDF_TYPES.includes(mimeType)) {
    try {
      const res = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' }
      );
      const base64 = Buffer.from(res.data as ArrayBuffer).toString('base64');
      return { text: null, base64, mimeType: 'application/pdf', method: 'pdf' };
    } catch (err) {
      console.error('Failed to download PDF:', err);
      return { text: null, base64: null, mimeType, method: 'unsupported' };
    }
  }

  // Images → download binary, return as base64 for Claude vision
  if (IMAGE_TYPES.some((t) => mimeType.startsWith(t))) {
    try {
      const res = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' }
      );
      const base64 = Buffer.from(res.data as ArrayBuffer).toString('base64');
      // Normalize mime type for Claude (it needs exact types)
      const claudeMime = mimeType.startsWith('image/tiff') ? 'image/png' : mimeType;
      return { text: null, base64, mimeType: claudeMime, method: 'image' };
    } catch (err) {
      console.error('Failed to download image:', err);
      return { text: null, base64: null, mimeType, method: 'unsupported' };
    }
  }

  // Excel / Spreadsheets → parse with SheetJS, return as CSV text
  if (EXCEL_TYPES.some((t) => mimeType === t)) {
    try {
      const res = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' }
      );
      const buffer = Buffer.from(res.data as ArrayBuffer);
      const workbook = XLSX.read(buffer, { type: 'buffer' });

      // Convert all sheets to text
      const sheetTexts: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        sheetTexts.push(`=== Sheet: ${sheetName} ===\n${csv}`);
      }
      const text = sheetTexts.join('\n\n');
      return { text, base64: null, mimeType, method: 'excel' };
    } catch (err) {
      console.error('Failed to parse Excel file:', err);
      return { text: null, base64: null, mimeType, method: 'unsupported' };
    }
  }

  // Word docs (.docx/.doc) → extract text from XML inside the ZIP
  if (WORD_TYPES.some((t) => mimeType === t)) {
    try {
      const res = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' }
      );
      const buffer = Buffer.from(res.data as ArrayBuffer);
      const text = extractTextFromDocx(buffer);
      if (text) {
        return { text, base64: null, mimeType, method: 'word' };
      }
      // Fallback: if we can't parse it, return as unsupported
      return { text: null, base64: null, mimeType, method: 'unsupported' };
    } catch (err) {
      console.error('Failed to download Word file:', err);
      return { text: null, base64: null, mimeType, method: 'unsupported' };
    }
  }

  // PowerPoint (.pptx/.ppt) → extract text from XML inside the ZIP
  if (PPT_TYPES.some((t) => mimeType === t)) {
    try {
      const res = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' }
      );
      const buffer = Buffer.from(res.data as ArrayBuffer);
      const text = extractTextFromPptx(buffer);
      if (text) {
        return { text, base64: null, mimeType, method: 'word' };
      }
      return { text: null, base64: null, mimeType, method: 'unsupported' };
    } catch (err) {
      console.error('Failed to download PowerPoint file:', err);
      return { text: null, base64: null, mimeType, method: 'unsupported' };
    }
  }

  // Email files (.eml) → download and extract text content
  if (EMAIL_TYPES.some((t) => mimeType === t)) {
    try {
      const res = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' }
      );
      const buffer = Buffer.from(res.data as ArrayBuffer);
      const rawEmail = buffer.toString('utf-8');

      // Basic email text extraction — pull out headers + body
      const text = parseEmailText(rawEmail);
      return { text, base64: null, mimeType, method: 'email' };
    } catch (err) {
      console.error('Failed to download email file:', err);
      return { text: null, base64: null, mimeType, method: 'unsupported' };
    }
  }

  // Unsupported type
  return { text: null, base64: null, mimeType, method: 'unsupported' };
}

/**
 * Extract text from .docx files.
 * DOCX = ZIP containing word/document.xml with the text content.
 * Uses the xlsx library's CFB/ZIP utilities to read the archive.
 */
function extractTextFromDocx(buffer: Buffer): string | null {
  try {
    // Use XLSX's internal ZIP reader (CFB = Compound File Binary)
    const zip = XLSX.read(buffer, { type: 'buffer', bookSheets: true });
    // XLSX reads it as a workbook but docx isn't a workbook — need different approach
    // Fall back to direct ZIP extraction using AdmZip-style parsing
    return extractXmlTextFromZip(buffer, 'word/document.xml');
  } catch {
    // Try direct XML extraction
    return extractXmlTextFromZip(buffer, 'word/document.xml');
  }
}

/**
 * Extract text from .pptx files.
 * PPTX = ZIP containing ppt/slides/slide*.xml files with text content.
 */
function extractTextFromPptx(buffer: Buffer): string | null {
  try {
    // PPTX has slides at ppt/slides/slide1.xml, slide2.xml, etc.
    // Try to extract from all slides
    const texts: string[] = [];
    for (let i = 1; i <= 100; i++) {
      const text = extractXmlTextFromZip(buffer, `ppt/slides/slide${i}.xml`);
      if (text) {
        texts.push(`=== Slide ${i} ===\n${text}`);
      } else {
        break; // No more slides
      }
    }
    return texts.length > 0 ? texts.join('\n\n') : null;
  } catch {
    return null;
  }
}

/**
 * Extract text from XML content inside a ZIP file (used for .docx and .pptx).
 * Strips XML tags and returns plain text.
 */
function extractXmlTextFromZip(buffer: Buffer, xmlPath: string): string | null {
  try {
    // Use Node.js zlib to decompress the ZIP
    // ZIP files have a specific format — find the file entry and extract it
    const zip = findFileInZip(buffer, xmlPath);
    if (!zip) return null;

    // Strip XML tags, keeping text content
    const text = zip
      .replace(/<\/w:p>/g, '\n')      // Word paragraph breaks
      .replace(/<\/a:p>/g, '\n')       // PowerPoint paragraph breaks
      .replace(/<[^>]+>/g, '')         // Strip all XML tags
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\n{3,}/g, '\n\n')     // Collapse multiple newlines
      .trim();

    return text || null;
  } catch {
    return null;
  }
}

/**
 * Simple ZIP file reader — finds and extracts a single file from a ZIP archive.
 * Handles both STORE and DEFLATE compression methods.
 */
function findFileInZip(zipBuffer: Buffer, targetPath: string): string | null {
  try {
    const { inflateRawSync } = require('zlib');
    let offset = 0;

    while (offset < zipBuffer.length - 4) {
      // Look for local file header signature (PK\x03\x04)
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
            // STORE — no compression
            return zipBuffer.toString('utf-8', dataOffset, dataOffset + uncompressedSize);
          } else if (compressionMethod === 8) {
            // DEFLATE
            const compressed = zipBuffer.subarray(dataOffset, dataOffset + compressedSize);
            const decompressed = inflateRawSync(compressed);
            return decompressed.toString('utf-8');
          }
        }

        // Move to next file
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

/**
 * Basic email (.eml) text parser.
 * Extracts From, To, Subject, Date, and body text.
 */
function parseEmailText(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const headers: string[] = [];
  let bodyStart = 0;

  // Parse headers (up to first blank line)
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

  // Get body — try to extract plain text part
  let body = lines.slice(bodyStart).join('\n');

  // If it's a multipart email, try to find the text/plain section
  if (body.includes('Content-Type: text/plain')) {
    const textMatch = body.match(/Content-Type: text\/plain[^\n]*\n(?:Content-Transfer-Encoding:[^\n]*\n)?\n([\s\S]*?)(?:\n--|\n\n--)/);
    if (textMatch) {
      body = textMatch[1];
    }
  }

  // Strip HTML tags if the body is HTML
  body = body.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

  return `EMAIL\n${headers.join('\n')}\n\n${body}`.substring(0, 50000);
}

/**
 * Build a unique Drive file identifier for deduplication in PIPELINE_LOG.
 * Uses format: `gdrive://<fileId>` stored in the File URL field.
 */
export function buildDriveFileUrl(fileId: string): string {
  return `gdrive://${fileId}`;
}

/**
 * Check if a file type is supported for processing.
 */
export function isSupportedFileType(mimeType: string): boolean {
  return (
    TEXT_TYPES.some((t) => mimeType.startsWith(t)) ||
    PDF_TYPES.includes(mimeType) ||
    IMAGE_TYPES.some((t) => mimeType.startsWith(t)) ||
    EXCEL_TYPES.some((t) => mimeType === t) ||
    WORD_TYPES.some((t) => mimeType === t) ||
    PPT_TYPES.some((t) => mimeType === t) ||
    EMAIL_TYPES.some((t) => mimeType === t) ||
    GOOGLE_DOC_TYPES.some((t) => mimeType.startsWith(t))
  );
}
