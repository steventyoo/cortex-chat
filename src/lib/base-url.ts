import { NextRequest } from 'next/server';

/**
 * Returns the callback URL that QStash (or other async workers) should use.
 *
 * Priority:
 *  1. QSTASH_CALLBACK_URL — explicit override (recommended for production)
 *  2. NEXT_PUBLIC_BASE_URL — general-purpose app URL
 *  3. Derived from the incoming request host (fallback)
 *
 * Using the request host is dangerous on Vercel because preview deployments
 * produce per-commit URLs that are protected by Vercel Authentication —
 * QStash callbacks to those URLs get 401s and retry-storm.
 */
export function getBaseUrl(request?: NextRequest): string {
  if (process.env.QSTASH_CALLBACK_URL) {
    return process.env.QSTASH_CALLBACK_URL.replace(/\/$/, '');
  }
  if (process.env.NEXT_PUBLIC_BASE_URL) {
    return process.env.NEXT_PUBLIC_BASE_URL.replace(/\/$/, '');
  }

  if (!request) {
    const vercelUrl = process.env.VERCEL_URL;
    if (vercelUrl) return `https://${vercelUrl}`;
    return 'http://localhost:3000';
  }

  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;

  const host = request.headers.get('host') || 'localhost:3000';
  const proto = host.includes('localhost') ? 'http' : 'https';
  return `${proto}://${host}`;
}
