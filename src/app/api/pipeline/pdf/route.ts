// PDF proxy — serves PDFs from Google Drive for in-browser viewing
// GET /api/pipeline/pdf?fileId=xxx

import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';

function getDriveClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')?.trim();
  if (!email || !key) {
    throw new Error('Google Drive credentials not configured');
  }
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

export async function GET(req: NextRequest) {
  const fileId = req.nextUrl.searchParams.get('fileId');
  if (!fileId) {
    return NextResponse.json({ error: 'fileId required' }, { status: 400 });
  }

  try {
    const drive = getDriveClient();

    // Get file metadata to verify it exists and check mime type
    const meta = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,size',
    });

    const mimeType = meta.data.mimeType || 'application/pdf';

    // Download the file as binary
    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );

    const buffer = Buffer.from(res.data as ArrayBuffer);

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `inline; filename="${meta.data.name || 'document.pdf'}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err: unknown) {
    console.error('PDF proxy error:', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch file';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
