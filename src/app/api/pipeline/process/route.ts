import { NextRequest } from 'next/server';
import { getQStashReceiver, ProcessPayload } from '@/lib/qstash';
import { processDocument } from '@/lib/process-document';
import { getBaseUrl } from '@/lib/base-url';
import { getSupabase } from '@/lib/supabase';

export const maxDuration = 300;

const SKIP_STATUSES = new Set([
  'extracted', 'pending_review', 'approved', 'tier2_validated', 'tier2_flagged',
]);

export async function POST(request: NextRequest) {
  const body = await request.text();

  const isVercel = !!process.env.VERCEL;
  if (isVercel) {
    const signature = request.headers.get('upstash-signature');
    if (!signature) {
      return Response.json({ error: 'Missing signature' }, { status: 401 });
    }
    try {
      const receiver = getQStashReceiver();
      await receiver.verify({ signature, body, url: `${getBaseUrl(request)}/api/pipeline/process` });
    } catch (err) {
      console.error('[process] QStash signature verification failed:', err);
      return Response.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  const payload: ProcessPayload = JSON.parse(body);

  const sb = getSupabase();
  const { data: record } = await sb
    .from('pipeline_log')
    .select('status')
    .eq('id', payload.recordId)
    .single();

  if (record && SKIP_STATUSES.has(record.status)) {
    console.log(`[process] SKIP duplicate: record=${payload.recordId} already status=${record.status}`);
    return Response.json({ skipped: true, status: record.status });
  }

  const result = await processDocument(payload);

  if (!result.success) {
    return Response.json({ error: result.error || 'Processing failed' }, { status: 500 });
  }

  return Response.json(result);
}
