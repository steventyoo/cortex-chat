import { NextRequest } from 'next/server';
import { getQStashReceiver, ProcessPayload } from '@/lib/qstash';
import { processDocument } from '@/lib/process-document';

export const maxDuration = 300;

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
  const result = await processDocument(payload);

  if (!result.success) {
    return Response.json({ error: result.error || 'Processing failed' }, { status: 500 });
  }

  return Response.json(result);
}

function getBaseUrl(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  const host = request.headers.get('host') || 'localhost:3000';
  const proto = host.includes('localhost') ? 'http' : 'https';
  return `${proto}://${host}`;
}
