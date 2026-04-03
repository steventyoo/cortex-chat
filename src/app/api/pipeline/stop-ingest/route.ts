import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getQStashClient } from '@/lib/qstash';
import { getSupabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const client = getQStashClient();

    // Cancel all queued QStash messages for the pipeline flow control key
    const cancelled = await client.messages.deleteAll();
    console.log(`[stop-ingest] Cancelled QStash messages:`, cancelled);

    // Mark all 'queued' and 'processing' records for this org as 'failed' with a note
    const sb = getSupabase();
    const { data: updated, error } = await sb
      .from('pipeline_log')
      .update({
        status: 'failed',
        validation_flags: JSON.stringify([{
          field: '_system',
          issue: 'Ingestion stopped by user',
          severity: 'info',
        }]),
      })
      .eq('org_id', session.orgId)
      .in('status', ['queued', 'processing', 'tier1_extracting'])
      .select('id');

    if (error) {
      console.error('[stop-ingest] DB update error:', error.message);
    }

    const stoppedCount = updated?.length || 0;
    console.log(`[stop-ingest] Marked ${stoppedCount} records as failed for org=${session.orgId}`);

    return Response.json({
      message: `Ingestion stopped. ${stoppedCount} document(s) cancelled.`,
      stoppedCount,
    });
  } catch (err) {
    console.error('[stop-ingest] Error:', err);
    return Response.json({ error: 'Failed to stop ingestion' }, { status: 500 });
  }
}
