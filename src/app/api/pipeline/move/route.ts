import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { recordId: string; categoryId: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.recordId || !body.categoryId) {
    return Response.json({ error: 'recordId and categoryId are required' }, { status: 400 });
  }

  const sb = getSupabase();

  const { data: row, error: fetchErr } = await sb
    .from('pipeline_log')
    .select('id, category_id, org_id')
    .eq('id', body.recordId)
    .eq('org_id', session.orgId)
    .single();

  if (fetchErr || !row) {
    return Response.json({ error: 'Document not found' }, { status: 404 });
  }

  const fromCategoryId = row.category_id as string | null;

  if (fromCategoryId === body.categoryId) {
    return Response.json({ message: 'Already in this category' });
  }

  const { error: updateErr } = await sb
    .from('pipeline_log')
    .update({ category_id: body.categoryId })
    .eq('id', body.recordId);

  if (updateErr) {
    console.error('[move] Failed to update category:', updateErr.message);
    return Response.json({ error: 'Failed to move document' }, { status: 500 });
  }

  const { error: auditErr } = await sb
    .from('document_moves')
    .insert({
      pipeline_log_id: body.recordId,
      from_category_id: fromCategoryId,
      to_category_id: body.categoryId,
      moved_by: session.userId,
    });

  if (auditErr) {
    console.error('[move] Audit log insert failed:', auditErr.message);
  }

  return Response.json({ success: true });
}
