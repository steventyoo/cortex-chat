import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, isAdminRole } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';
import { parseFileBuffer, isSupportedMimeType } from '@/lib/file-parser';
import { chunkAndEmbedDocument } from '@/lib/knowledge';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session || !isAdminRole(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const title = formData.get('title') as string || '';

  if (!file) {
    return Response.json({ error: 'No file provided' }, { status: 400 });
  }

  if (!isSupportedMimeType(file.type, file.name)) {
    return Response.json({ error: `Unsupported file type: ${file.type}` }, { status: 400 });
  }

  const sb = getSupabase();
  const buffer = Buffer.from(await file.arrayBuffer());
  const storagePath = `knowledge/${session.orgId}/${Date.now()}_${file.name}`;

  // Upload to Supabase Storage
  const { error: uploadErr } = await sb.storage
    .from('documents')
    .upload(storagePath, buffer, { contentType: file.type });

  if (uploadErr) {
    console.error('[knowledge/upload] Storage upload failed:', uploadErr.message);
    return Response.json({ error: 'Failed to upload file' }, { status: 500 });
  }

  // Create knowledge_documents record
  const { data: doc, error: insertErr } = await sb
    .from('knowledge_documents')
    .insert({
      org_id: session.orgId,
      title: title || file.name.replace(/\.[^.]+$/, ''),
      file_name: file.name,
      storage_path: storagePath,
      mime_type: file.type,
      uploaded_by: session.userId,
    })
    .select()
    .single();

  if (insertErr || !doc) {
    console.error('[knowledge/upload] DB insert failed:', insertErr?.message);
    return Response.json({ error: 'Failed to create document record' }, { status: 500 });
  }

  // Parse text and chunk/embed in background-ish (still within same request for now)
  try {
    const parsed = await parseFileBuffer(buffer, file.type, file.name);
    const chunkCount = await chunkAndEmbedDocument(doc.id, parsed.text);

    return Response.json({
      document: {
        id: doc.id,
        title: doc.title,
        fileName: doc.file_name,
        chunkCount,
      },
    }, { status: 201 });
  } catch (err) {
    console.error('[knowledge/upload] Parse/embed failed:', err);
    // Still return success since the file was uploaded, just without embeddings
    return Response.json({
      document: {
        id: doc.id,
        title: doc.title,
        fileName: doc.file_name,
        chunkCount: 0,
        warning: 'File uploaded but text extraction failed',
      },
    }, { status: 201 });
  }
}
