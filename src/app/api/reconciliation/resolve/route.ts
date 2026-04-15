import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { userId } = session as SessionPayload;
  const { resultIds, note } = await request.json();

  if (!Array.isArray(resultIds) || resultIds.length === 0) {
    return Response.json({ error: 'resultIds array is required' }, { status: 400 });
  }

  const sb = getSupabase();
  const { error } = await sb
    .from('reconciliation_results')
    .update({
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
      resolution_note: note || null,
    })
    .in('id', resultIds);

  if (error) {
    console.error('[reconciliation] Resolve failed:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ resolved: resultIds.length });
}
