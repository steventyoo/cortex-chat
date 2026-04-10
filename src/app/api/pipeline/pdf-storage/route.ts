// PDF proxy — serves PDFs from Supabase Storage for in-browser viewing
// GET /api/pipeline/pdf-storage?path=xxx

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

const DOCUMENTS_BUCKET = 'documents';

export async function GET(req: NextRequest) {
  const storagePath = req.nextUrl.searchParams.get('path');
  if (!storagePath) {
    return NextResponse.json({ error: 'path required' }, { status: 400 });
  }

  try {
    const sb = getSupabase();
    const { data, error } = await sb.storage
      .from(DOCUMENTS_BUCKET)
      .download(storagePath);

    if (error || !data) {
      console.error('Supabase storage download error:', error);
      return NextResponse.json(
        { error: error?.message || 'Failed to download file' },
        { status: 404 },
      );
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    const fileName = storagePath.split('/').pop() || 'document.pdf';

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err: unknown) {
    console.error('PDF storage proxy error:', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch file';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
