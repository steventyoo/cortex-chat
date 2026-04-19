import { Langfuse } from 'langfuse';
import type { LangfuseTraceClient, LangfuseSpanClient } from 'langfuse';

export type LangfuseParent = LangfuseTraceClient | LangfuseSpanClient;

let _langfuse: Langfuse | null = null;

export function getLangfuse(): Langfuse {
  if (_langfuse) return _langfuse;

  _langfuse = new Langfuse({
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    baseUrl: process.env.LANGFUSE_BASEURL || 'https://cloud.langfuse.com',
    flushAt: 1,
    flushInterval: 1000,
  });

  return _langfuse;
}

export async function shutdownLangfuse(): Promise<void> {
  if (_langfuse) {
    await _langfuse.shutdownAsync();
    _langfuse = null;
  }
}

/* ── Eval scoring helpers ─────────────────────────────────── */

export interface EvalScores {
  correctness: number;
  tool_routing: 'correct' | 'wrong' | 'partial';
  answer_match: boolean;
}

export async function scoreChatTrace(
  traceId: string,
  scores: EvalScores
): Promise<void> {
  const lf = getLangfuse();

  lf.score({
    traceId,
    name: 'correctness',
    value: scores.correctness,
    comment: `Numeric correctness score (0-1)`,
  });

  lf.score({
    traceId,
    name: 'tool_routing',
    value: scores.tool_routing === 'correct' ? 1 : scores.tool_routing === 'partial' ? 0.5 : 0,
    comment: `Tool routing: ${scores.tool_routing}`,
  });

  lf.score({
    traceId,
    name: 'answer_match',
    value: scores.answer_match ? 1 : 0,
    comment: `Answer matched expected output: ${scores.answer_match}`,
  });

  await lf.flushAsync();
}
