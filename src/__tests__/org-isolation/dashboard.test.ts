import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const validateUserSession = vi.fn();
  const verifyProjectAccess = vi.fn();
  const fetchAllProjectData = vi.fn();
  return { validateUserSession, verifyProjectAccess, fetchAllProjectData };
});

vi.mock('@/lib/auth-v2', () => ({
  validateUserSession: mocks.validateUserSession,
  SESSION_COOKIE: 'cortex-session',
}));

vi.mock('@/lib/supabase', () => ({
  verifyProjectAccess: mocks.verifyProjectAccess,
  fetchAllProjectData: mocks.fetchAllProjectData,
}));

import { makeSession, makeRequest, ORG_A, ORG_B } from '../helpers';
import { GET } from '@/app/api/dashboard/route';

describe('GET /api/dashboard — org isolation', () => {
  beforeEach(() => {
    mocks.validateUserSession.mockReset();
    mocks.verifyProjectAccess.mockReset();
    mocks.fetchAllProjectData.mockReset();
    mocks.validateUserSession.mockResolvedValue(makeSession());
    mocks.verifyProjectAccess.mockResolvedValue(true);
    mocks.fetchAllProjectData.mockResolvedValue({
      project: { project_name: 'Test' },
      changeOrders: [],
      production: [],
      jobCosts: [],
      designChanges: [],
      staffing: [],
      documentLinks: [],
    });
  });

  it('returns 401 without session cookie', async () => {
    const res = await GET(makeRequest('/api/dashboard?projectId=p1', { cookie: false }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when projectId is missing', async () => {
    const res = await GET(makeRequest('/api/dashboard'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when project belongs to another org', async () => {
    mocks.verifyProjectAccess.mockResolvedValueOnce(false);
    const res = await GET(makeRequest('/api/dashboard?projectId=p1'));
    expect(res.status).toBe(404);
  });

  it('calls verifyProjectAccess with session orgId', async () => {
    await GET(makeRequest('/api/dashboard?projectId=proj_1'));
    expect(mocks.verifyProjectAccess).toHaveBeenCalledWith('proj_1', ORG_A);
    expect(mocks.verifyProjectAccess).not.toHaveBeenCalledWith('proj_1', ORG_B);
  });
});
