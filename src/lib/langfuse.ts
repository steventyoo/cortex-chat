import { Langfuse } from 'langfuse';

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
