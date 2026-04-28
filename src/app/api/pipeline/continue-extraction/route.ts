import { NextRequest, NextResponse } from 'next/server';
import { getQStashReceiver } from '@/lib/qstash';
import type { ExtractionContinuationPayload } from '@/lib/qstash';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // Verify QStash signature
  const receiver = getQStashReceiver();
  const body = await req.text();
  const signature = req.headers.get('upstash-signature') ?? '';

  try {
    await receiver.verify({ body, signature });
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload: ExtractionContinuationPayload = JSON.parse(body);
  if (!payload.continuation || !payload.parserCacheId) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  console.log(
    `[continue-extraction] Resuming extraction: cache=${payload.parserCacheId} skill=${payload.skillId}`,
  );

  // TODO: Load saved agent state from parser_cache.meta, re-create the
  // SandboxSession with the stored source text, and resume the Opus loop.
  // This requires storing the full conversation history and source text
  // in parser_cache.meta during the timeout save in extraction-agent.ts.
  //
  // For now, this endpoint is a placeholder that will be fully implemented
  // when the initial agent loop proves out on real documents.

  return NextResponse.json({
    status: 'continuation_received',
    parserCacheId: payload.parserCacheId,
    message: 'Continuation endpoint ready — full implementation pending initial agent validation',
  });
}
