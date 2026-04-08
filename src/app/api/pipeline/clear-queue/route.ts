import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (session as SessionPayload).orgId;
  const sb = getSupabase();

  // Reset "queued" records that never started → failed
  const { data: queuedRows, error: qErr } = await sb
    .from('pipeline_log')
    .update({ status: 'failed', validation_flags: [{ field: 'queue', issue: 'Queue cleared by operator', severity: 'info' }] })
    .eq('org_id', orgId)
    .eq('status', 'queued')
    .select('id');

  // Reset "processing" records that are stuck → failed
  const { data: processingRows, error: pErr } = await sb
    .from('pipeline_log')
    .update({ status: 'failed', validation_flags: [{ field: 'queue', issue: 'Queue cleared while processing', severity: 'info' }] })
    .eq('org_id', orgId)
    .eq('status', 'processing')
    .select('id');

  const cleared = (queuedRows?.length || 0) + (processingRows?.length || 0);

  console.log(`[clear-queue] Cleared ${cleared} records (${queuedRows?.length || 0} queued, ${processingRows?.length || 0} processing) for org=${orgId}`);

  if (qErr) console.error('[clear-queue] Error clearing queued:', qErr);
  if (pErr) console.error('[clear-queue] Error clearing processing:', pErr);

  return Response.json({
    success: true,
    cleared,
    queued: queuedRows?.length || 0,
    processing: processingRows?.length || 0,
  });
}
