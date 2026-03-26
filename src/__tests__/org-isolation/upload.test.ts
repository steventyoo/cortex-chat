import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const validateUserSession = vi.fn();
  const logs: Array<{ table: string; filters: Array<{ method: string; args: unknown[] }> }> = [];
  let current: { table: string; filters: Array<{ method: string; args: unknown[] }> } | null = null;

  function chain() {
    const self: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'single', 'insert', 'update', 'delete']) {
      self[m] = (...args: unknown[]) => {
        if (current) current.filters.push({ method: m, args });
        if (m === 'single') return Promise.resolve({ data: null, error: null });
        return self;
      };
    }
    self.then = (res: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(res);
    return self;
  }

  const sbMock = {
    from: (table: string) => {
      current = { table, filters: [] };
      logs.push(current);
      return chain();
    },
  };

  const parseJobCostReport = vi.fn().mockReturnValue({
    lineItems: [{ costCode: 'C1', description: 'Test', revisedBudget: 100, jobToDate: 50, changeOrders: 0, overUnder: 0, percentOfBudget: 50, category: 'L' }],
    summary: { totalBudget: 100, totalActual: 50, totalChangeOrders: 0, percentComplete: 50 },
    format: 'standard',
    projectInfo: { jobNumber: 'J-001', projectName: 'Test Project' },
    warnings: [],
  });
  const computeFingerprint = vi.fn().mockReturnValue('fp_unique');

  return { validateUserSession, logs, sbMock, parseJobCostReport, computeFingerprint };
});

vi.mock('@/lib/auth-v2', () => ({
  validateUserSession: mocks.validateUserSession,
  SESSION_COOKIE: 'cortex-session',
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => mocks.sbMock,
}));

vi.mock('@/lib/job-cost-parser', () => ({
  parseJobCostReport: mocks.parseJobCostReport,
  computeFingerprint: mocks.computeFingerprint,
}));

import { makeSession, makeRequest, ORG_A, ORG_B } from '../helpers';
import { POST } from '@/app/api/upload/route';

describe('POST /api/upload — org isolation', () => {
  beforeEach(() => {
    mocks.logs.length = 0;
    mocks.validateUserSession.mockReset();
    mocks.validateUserSession.mockResolvedValue(makeSession());
  });

  it('returns 401 without session cookie', async () => {
    const res = await POST(makeRequest('/api/upload', {
      method: 'POST', body: { text: 'csv data', action: 'preview' }, cookie: false,
    }));
    expect(res.status).toBe(401);
  });

  it('uses session.orgId for project fetch, not body.orgId', async () => {
    const res = await POST(makeRequest('/api/upload', {
      method: 'POST',
      body: { text: 'csv data', action: 'preview', orgId: ORG_B },
    }));

    const projectQueries = mocks.logs.filter((l) => l.table === 'projects');
    expect(projectQueries.length).toBeGreaterThan(0);
    const orgFilters = projectQueries
      .flatMap((l) => l.filters)
      .filter((f) => f.method === 'eq' && f.args[0] === 'org_id');
    expect(orgFilters.every((f) => f.args[1] === ORG_A)).toBe(true);
    expect(orgFilters.some((f) => f.args[1] === ORG_B)).toBe(false);
  });
});
