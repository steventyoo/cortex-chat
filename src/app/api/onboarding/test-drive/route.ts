import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { google } from 'googleapis';

export const maxDuration = 15;

function getDriveClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')?.trim();
  if (!email || !key) throw new Error('Google Drive credentials not configured');

  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { folderId } = await req.json();
  if (!folderId || typeof folderId !== 'string') {
    return Response.json({ error: 'folderId required' }, { status: 400 });
  }

  try {
    const drive = getDriveClient();

    // Test access to the folder
    const folderMeta = await drive.files.get({
      fileId: folderId.trim(),
      fields: 'id, name, mimeType',
    });

    if (folderMeta.data.mimeType !== 'application/vnd.google-apps.folder') {
      return Response.json({ error: 'The ID provided is not a folder' }, { status: 400 });
    }

    // List subfolders (these are the project folders)
    const res = await drive.files.list({
      q: `'${folderId.trim()}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
      orderBy: 'name',
      pageSize: 100,
    });

    const subfolders = (res.data.files || []).map((f) => ({
      id: f.id!,
      name: f.name!,
    }));

    return Response.json({
      success: true,
      folderName: folderMeta.data.name,
      subfolders,
    });
  } catch (err) {
    console.error('Drive test error:', err);
    const message =
      err instanceof Error && err.message.includes('not found')
        ? 'Folder not found. Make sure you shared it with the service account.'
        : 'Could not access folder. Share it with: ' +
          (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'the service account');
    return Response.json({ error: message }, { status: 400 });
  }
}
