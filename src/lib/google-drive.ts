// Google Drive integration for document pipeline
// Watches a Drive folder structure and surfaces new files for processing

import { google, drive_v3 } from 'googleapis';

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
  method: 'text' | 'pdf' | 'image' | 'google-doc' | 'unsupported';
}

// ─── Auth & Client ──────────────────────────────────────────────

function getDriveClient(): drive_v3.Drive {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

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
  const id = process.env.GOOGLE_DRIVE_FOLDER_ID;
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

// ─── File Content Download ──────────────────────────────────────

/** Supported MIME types for processing */
const TEXT_TYPES = [
  'text/plain',
  'text/csv',
  'text/html',
  'text/markdown',
  'application/json',
  'application/xml',
];

const PDF_TYPES = ['application/pdf'];

const IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/tiff',
];

const GOOGLE_DOC_TYPES = [
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
];

/**
 * Download and extract content from a Drive file.
 * - Text files: returns raw text
 * - PDFs: returns base64 for Claude document processing
 * - Images: returns base64 for Claude vision
 * - Google Docs: exports as plain text
 */
export async function downloadFileContent(
  fileId: string,
  mimeType: string
): Promise<DriveFileContent> {
  const drive = getDriveClient();

  // Google Docs/Sheets → export as plain text
  if (GOOGLE_DOC_TYPES.some((t) => mimeType.startsWith(t))) {
    try {
      const res = await drive.files.export(
        { fileId, mimeType: 'text/plain' },
        { responseType: 'arraybuffer' }
      );
      const text = Buffer.from(res.data as ArrayBuffer).toString('utf-8');
      return { text, base64: null, mimeType: 'text/plain', method: 'google-doc' };
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

  // Unsupported type
  return { text: null, base64: null, mimeType, method: 'unsupported' };
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
    GOOGLE_DOC_TYPES.some((t) => mimeType.startsWith(t))
  );
}
