// Edge-compatible auth (no Node.js crypto)
const SESSION_COOKIE = 'cortex-session';
const MAX_AGE = 7 * 24 * 60 * 60; // 7 days

function getSecret(): string {
  return process.env.SESSION_SECRET || 'fallback-secret-change-me';
}

async function hmacSign(payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(payload)
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function createSession(password: string): Promise<string | null> {
  if (password !== process.env.CORTEX_PASSWORD) {
    return null;
  }
  const timestamp = Date.now().toString();
  const signature = await hmacSign(`cortex-valid-${timestamp}`);
  return `${timestamp}.${signature}`;
}

export async function validateToken(token: string): Promise<boolean> {
  if (!token || !token.includes('.')) return false;
  const dotIndex = token.indexOf('.');
  const timestamp = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);

  const expected = await hmacSign(`cortex-valid-${timestamp}`);

  // Simple constant-time-ish comparison
  if (signature.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < signature.length; i++) {
    diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) return false;

  // Check expiry (7 days)
  const age = Date.now() - parseInt(timestamp, 10);
  return age < MAX_AGE * 1000;
}

export { SESSION_COOKIE, MAX_AGE };
