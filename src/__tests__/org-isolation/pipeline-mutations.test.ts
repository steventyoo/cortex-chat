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
    self.then = (res: (v: unknown) => void) => Promise.resolve({ data: null, error: null }).then(res);
    return self;
  }

  const sbMock = {
    from: (table: string) => {
      current = { table, filters: [] };
      logs.push(current);
      return chain();
    },
  };

  const pushRecordsToTable = vi.fn().mockResolvedValue([]);
  const pushToExtractedRecords = vi.fn().mockResolvedValue(null);
  const checkDuplicatePipeline = vi.fn().mockResolvedValue(false);
  const getSkill = vi.fn().mockResolvedValue(null);
  const recordCorrection = vi.fn().mockResolvedValue(undefined);
  const embedAndStoreForRecord = vi.fn().mockResolvedValue(undefined);

  return {
    validateUserSession, logs, sbMock,
    pushRecordsToTable, pushToExtractedRecords, checkDuplicatePipeline,
    getSkill, recordCorrection, embedAndStoreForRecord,
  };
});

vi.mock('@/lib/auth-v2', () => ({
  validateUserSession: mocks.validateUserSession,
  SESSION_COOKIE: 'cortex-session',
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => mocks.sbMock,
  pushRecordsToTable: mocks.pushRecordsToTable,
  pushToExtractedRecords: mocks.pushToExtractedRecords,
  checkDuplicatePipeline: mocks.checkDuplicatePipeline,
}));

vi.mock('@/lib/pipeline', () => ({}));

vi.mock('@/lib/skills', () => ({
  getSkill: mocks.getSkill,
  recordCorrection: mocks.recordCorrection,
}));

vi.mock('@/lib/embeddings', () => ({
  embedAndStoreForRecord: mocks.embedAndStoreForRecord,
}));

import { makeSession, makeRequest, ORG_A } from '../helpers';

describe('Pipeline mutations — org isolation', () => {
  beforeEach(() => {
    mocks.logs.length = 0;
    mocks.validateUserSession.mockReset();
    mocks.validateUserSession.mockResolvedValue(makeSession());
  });

  function hasOrgFilter(table: string, orgId: string) {
    return mocks.logs
      .filter((l) => l.table === table)
      .flatMap((l) => l.filters)
      .some((f) => f.method === 'eq' && f.args[0] === 'org_id' && f.args[1] === orgId);
  }

  describe('POST /api/pipeline/review', () => {
    it('returns 401 without session', async () => {
      const { POST } = await import('@/app/api/pipeline/review/route');
      const res = await POST(makeRequest('/api/pipeline/review', {
        method: 'POST', body: { recordId: 'r1', action: 'approved' }, cookie: false,
      }));
      expect(res.status).toBe(401);
    });

    it('scopes pipeline_log fetch to session orgId', async () => {
      const { POST } = await import('@/app/api/pipeline/review/route');
      await POST(makeRequest('/api/pipeline/review', {
        method: 'POST', body: { recordId: 'r1', action: 'approved', testMode: true },
      }));
      expect(hasOrgFilter('pipeline_log', ORG_A)).toBe(true);
    });
  });

  describe('POST /api/pipeline/mark-pushed', () => {
    it('returns 401 without session', async () => {
      const { POST } = await import('@/app/api/pipeline/mark-pushed/route');
      const res = await POST(makeRequest('/api/pipeline/mark-pushed', {
        method: 'POST', body: { recordId: 'r1' }, cookie: false,
      }));
      expect(res.status).toBe(401);
    });

    it('scopes update to session orgId', async () => {
      const { POST } = await import('@/app/api/pipeline/mark-pushed/route');
      await POST(makeRequest('/api/pipeline/mark-pushed', {
        method: 'POST', body: { recordId: 'r1' },
      }));
      expect(hasOrgFilter('pipeline_log', ORG_A)).toBe(true);
    });
  });

  describe('POST /api/pipeline/delete', () => {
    it('returns 401 without session', async () => {
      const { POST } = await import('@/app/api/pipeline/delete/route');
      const res = await POST(makeRequest('/api/pipeline/delete', {
        method: 'POST', body: { recordId: 'r1' }, cookie: false,
      }));
      expect(res.status).toBe(401);
    });

    it('scopes soft-delete to session orgId', async () => {
      const { POST } = await import('@/app/api/pipeline/delete/route');
      await POST(makeRequest('/api/pipeline/delete', {
        method: 'POST', body: { recordId: 'r1' },
      }));
      expect(hasOrgFilter('pipeline_log', ORG_A)).toBe(true);
    });
  });
});
