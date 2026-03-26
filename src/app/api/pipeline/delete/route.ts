import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { recordId } = await request.json();
    if (!recordId) {
      return Response.json({ error: 'recordId is required' }, { status: 400 });
    }

    const sb = getSupabase();
    const { error } = await sb.from('pipeline_log').update({
      status: 'deleted',
      review_notes: `Soft-deleted by user at ${new Date().toISOString()}`,
    }).eq('id', recordId).eq('org_id', session.orgId);

    if (error) {
      console.error('Supabase soft-delete error:', error.message);
      return Response.json({ error: 'Failed to delete record' }, { status: 500 });
    }

    return Response.json({ success: true, deleted: recordId });
  } catch (err) {
    console.error('Pipeline delete error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
