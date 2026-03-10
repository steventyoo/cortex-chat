import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { recordId } = await request.json();
    if (!recordId) {
      return Response.json({ error: 'recordId is required' }, { status: 400 });
    }

    const sb = getSupabase();
    const now = new Date().toISOString();
    const { error } = await sb.from('pipeline_log').update({
      status: 'pushed',
      review_action: 'approved',
      reviewer: 'Admin',
      reviewed_at: now,
      pushed_at: now,
      review_notes: 'Marked as already pushed — data was manually entered prior to pipeline setup.',
    }).eq('id', recordId);

    if (error) {
      console.error('Supabase update error:', error.message);
      return Response.json({ error: 'Failed to update record' }, { status: 500 });
    }

    return Response.json({ success: true, recordId, status: 'pushed' });
  } catch (err) {
    console.error('Mark pushed error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
