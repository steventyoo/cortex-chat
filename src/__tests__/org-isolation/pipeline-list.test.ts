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

  return { validateUserSession, logs, sbMock };
});

vi.mock('@/lib/auth-v2', () => ({
  validateUserSession: mocks.validateUserSession,
  SESSION_COOKIE: 'cortex-session',
}));

vi.mock('@/lib/pipeline', () => ({
  parsePipelineItem: vi.fn((rec: { id: string; fields: Record<string, unknown> }) => ({
    id: rec.id, status: rec.fields['Status'] || 'unknown', ...rec.fields,
  })),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => mocks.sbMock,
}));

import { makeSession, makeRequest, ORG_A } from '../helpers';
import { GET } from '@/app/api/pipeline/list/route';

describe('GET /api/pipeline/list — org isolation', () => {
  beforeEach(() => {
    mocks.logs.length = 0;
    mocks.validateUserSession.mockReset();
    mocks.validateUserSession.mockResolvedValue(makeSession());
  });

  it('returns 401 when no session cookie', async () => {
    const res = await GET(makeRequest('/api/pipeline/list', { cookie: false }));
    expect(res.status).toBe(401);
  });

  it('filters pipeline_log by session orgId', async () => {
    const res = await GET(makeRequest('/api/pipeline/list'));
    expect(res.status).toBe(200);
    const orgFilters = mocks.logs
      .filter((l) => l.table === 'pipeline_log')
      .flatMap((l) => l.filters)
      .filter((f) => f.method === 'eq' && f.args[0] === 'org_id');
    expect(orgFilters).toHaveLength(1);
    expect(orgFilters[0].args[1]).toBe(ORG_A);
  });
});
