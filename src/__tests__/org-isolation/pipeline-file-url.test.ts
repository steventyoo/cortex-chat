import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const validateUserSession = vi.fn();
  const getSignedUrl = vi.fn();
  return { validateUserSession, getSignedUrl };
});

vi.mock('@/lib/auth-v2', () => ({
  validateUserSession: mocks.validateUserSession,
  SESSION_COOKIE: 'cortex-session',
}));

vi.mock('@/lib/supabase', () => ({
  getSignedUrl: mocks.getSignedUrl,
}));

import { makeSession, makeRequest, ORG_A, ORG_B } from '../helpers';
import { GET } from '@/app/api/pipeline/file-url/route';

describe('GET /api/pipeline/file-url — org isolation', () => {
  beforeEach(() => {
    mocks.validateUserSession.mockReset();
    mocks.getSignedUrl.mockReset();
    mocks.validateUserSession.mockResolvedValue(makeSession());
    mocks.getSignedUrl.mockResolvedValue('https://signed.example.com/file.pdf');
  });

  it('returns 401 without session cookie', async () => {
    const res = await GET(makeRequest('/api/pipeline/file-url?path=org_test_A/doc.pdf', { cookie: false }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when path is missing', async () => {
    const res = await GET(makeRequest('/api/pipeline/file-url'));
    expect(res.status).toBe(400);
  });

  it('returns 200 when path belongs to own org', async () => {
    const res = await GET(makeRequest(`/api/pipeline/file-url?path=${ORG_A}/doc.pdf`));
    expect(res.status).toBe(200);
    expect(mocks.getSignedUrl).toHaveBeenCalledWith(`${ORG_A}/doc.pdf`);
  });

  it('returns 403 when path belongs to another org', async () => {
    const res = await GET(makeRequest(`/api/pipeline/file-url?path=${ORG_B}/doc.pdf`));
    expect(res.status).toBe(403);
  });

  it('returns 403 for path traversal attempts', async () => {
    const res = await GET(makeRequest(`/api/pipeline/file-url?path=../${ORG_B}/doc.pdf`));
    expect(res.status).toBe(403);
  });
});
