import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, isAdminRole } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

interface RouteParams {
  params: Promise<{ docId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { docId } = await params;
  const sb = getSupabase();

  const { data, error } = await sb
    .from('knowledge_documents')
    .select('*')
    .eq('id', docId)
    .eq('org_id', session.orgId)
    .single();

  if (error || !data) {
    return Response.json({ error: 'Document not found' }, { status: 404 });
  }

  return Response.json({ document: data });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session || !isAdminRole(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { docId } = await params;
  const sb = getSupabase();

  // Fetch for storage cleanup
  const { data: doc } = await sb
    .from('knowledge_documents')
    .select('storage_path')
    .eq('id', docId)
    .eq('org_id', session.orgId)
    .single();

  if (!doc) {
    return Response.json({ error: 'Document not found' }, { status: 404 });
  }

  // Delete from storage
  await sb.storage.from('documents').remove([doc.storage_path]);

  // Cascade deletes chunks via FK
  const { error } = await sb
    .from('knowledge_documents')
    .delete()
    .eq('id', docId);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
