import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const validateUserSession = vi.fn();
  const verifyProjectAccess = vi.fn();
  const fetchAllProjectData = vi.fn();
  const fetchProjectList = vi.fn();
  const fetchProjectHealthData = vi.fn();
  const computeDriftMetrics = vi.fn();

  return {
    validateUserSession, verifyProjectAccess,
    fetchAllProjectData, fetchProjectList, fetchProjectHealthData,
    computeDriftMetrics,
  };
});

vi.mock('@/lib/auth-v2', () => ({
  validateUserSession: mocks.validateUserSession,
  SESSION_COOKIE: 'cortex-session',
}));

vi.mock('@/lib/supabase', () => ({
  verifyProjectAccess: mocks.verifyProjectAccess,
  fetchAllProjectData: mocks.fetchAllProjectData,
  fetchProjectList: mocks.fetchProjectList,
  fetchProjectHealthData: mocks.fetchProjectHealthData,
}));

vi.mock('@/lib/drift-engine', () => ({
  computeDriftMetrics: mocks.computeDriftMetrics,
}));

import { makeSession, makeRequest, ORG_A, ORG_B } from '../helpers';
import { GET } from '@/app/api/intelligence/route';

describe('GET /api/intelligence — org isolation', () => {
  beforeEach(() => {
    mocks.validateUserSession.mockReset();
    mocks.verifyProjectAccess.mockReset();
    mocks.fetchAllProjectData.mockReset();
    mocks.fetchProjectHealthData.mockReset();
    mocks.computeDriftMetrics.mockReset();

    mocks.validateUserSession.mockResolvedValue(makeSession());
    mocks.verifyProjectAccess.mockResolvedValue(true);
    mocks.fetchAllProjectData.mockResolvedValue({
      project: { 'Project Name': 'Test', 'Contract Value': 1000000, 'Revised Budget': 1000000, 'Job to Date': 500000, 'Percent Complete Cost': 50 },
      changeOrders: [],
      production: [],
      jobCosts: [],
      designChanges: [],
      staffing: [],
      documentLinks: [],
    });
    mocks.fetchProjectHealthData.mockResolvedValue([]);
    mocks.computeDriftMetrics.mockReturnValue({
      productivityDrift: 0, productivitySignal: 'stable',
      burnGap: 0, burnGapSignal: 'stable',
      costBurn: 0, progressPercent: 50,
      rateDrift: 0, rateDriftSignal: 'stable',
      actualLaborRate: 0, estimatedLaborRate: 0,
      riskScore: 0, riskLevel: 'low',
      projectedMarginImpact: 0, projectedLaborOverrun: 0,
      drivers: [], recommendations: [],
    });
  });

  it('returns 401 without session cookie', async () => {
    const res = await GET(makeRequest('/api/intelligence?projectId=p1', { cookie: false }));
    expect(res.status).toBe(401);
  });

  describe('single project mode', () => {
    it('returns 404 when project belongs to another org', async () => {
      mocks.verifyProjectAccess.mockResolvedValueOnce(false);
      const res = await GET(makeRequest('/api/intelligence?projectId=proj_1'));
      expect(res.status).toBe(404);
    });

    it('calls verifyProjectAccess with session orgId', async () => {
      await GET(makeRequest('/api/intelligence?projectId=proj_1'));
      expect(mocks.verifyProjectAccess).toHaveBeenCalledWith('proj_1', ORG_A);
      expect(mocks.verifyProjectAccess).not.toHaveBeenCalledWith('proj_1', ORG_B);
    });
  });

  describe('portfolio mode', () => {
    it('calls fetchProjectHealthData with session orgId', async () => {
      await GET(makeRequest('/api/intelligence'));
      expect(mocks.fetchProjectHealthData).toHaveBeenCalledWith(ORG_A);
      expect(mocks.fetchProjectHealthData).not.toHaveBeenCalledWith(ORG_B);
    });
  });
});
