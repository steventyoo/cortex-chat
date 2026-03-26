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
        if (m === 'single') return Promise.resolve({ data: { id: 'note_1' }, error: null });
        return self;
      };
    }
    self.then = (res: (v: unknown) => void) =>
      Promise.resolve({ data: [], error: null }).then(res);
    return self;
  }

  const sbMock = {
    from: (table: string) => {
      current = { table, filters: [] };
      logs.push(current);
      return chain();
    },
  };

  const fetchWeather = vi.fn().mockResolvedValue(null);

  return { validateUserSession, logs, sbMock, fetchWeather };
});

vi.mock('@/lib/auth-v2', () => ({
  validateUserSession: mocks.validateUserSession,
  SESSION_COOKIE: 'cortex-session',
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => mocks.sbMock,
}));

vi.mock('@/lib/weather', () => ({
  fetchWeather: mocks.fetchWeather,
}));

import { makeSession, makeRequest, ORG_A } from '../helpers';
import { GET, POST, DELETE } from '@/app/api/daily-note/route';

function hasOrgFilter(table: string, orgId: string) {
  return mocks.logs
    .filter((l) => l.table === table)
    .flatMap((l) => l.filters)
    .some((f) => f.method === 'eq' && f.args[0] === 'org_id' && f.args[1] === orgId);
}

describe('/api/daily-note — org isolation', () => {
  beforeEach(() => {
    mocks.logs.length = 0;
    mocks.validateUserSession.mockReset();
    mocks.validateUserSession.mockResolvedValue(makeSession());
  });

  describe('GET', () => {
    it('returns 401 without session cookie', async () => {
      const res = await GET(makeRequest('/api/daily-note?projectId=proj_1', { cookie: false }));
      expect(res.status).toBe(401);
    });

    it('filters daily_notes by session orgId', async () => {
      await GET(makeRequest('/api/daily-note?projectId=proj_1'));
      expect(hasOrgFilter('daily_notes', ORG_A)).toBe(true);
    });
  });

  describe('POST (create)', () => {
    it('returns 401 without session cookie', async () => {
      const res = await POST(makeRequest('/api/daily-note', {
        method: 'POST', body: { projectId: 'proj_1', content: 'test' }, cookie: false,
      }));
      expect(res.status).toBe(401);
    });

    it('inserts with session orgId', async () => {
      await POST(makeRequest('/api/daily-note', {
        method: 'POST', body: { projectId: 'proj_1', content: 'test note' },
      }));
      const insertCalls = mocks.logs
        .filter((l) => l.table === 'daily_notes')
        .flatMap((l) => l.filters)
        .filter((f) => f.method === 'insert');
      expect(insertCalls.length).toBeGreaterThan(0);
      const row = insertCalls[0].args[0] as Record<string, unknown>;
      expect(row.org_id).toBe(ORG_A);
    });
  });

  describe('POST (update)', () => {
    it('scopes update to session orgId', async () => {
      await POST(makeRequest('/api/daily-note', {
        method: 'POST', body: { projectId: 'proj_1', content: 'updated', noteId: 'note_1' },
      }));
      expect(hasOrgFilter('daily_notes', ORG_A)).toBe(true);
    });
  });

  describe('DELETE', () => {
    it('returns 401 without session cookie', async () => {
      const res = await DELETE(makeRequest('/api/daily-note', {
        method: 'DELETE', body: { noteId: 'note_1' }, cookie: false,
      }));
      expect(res.status).toBe(401);
    });

    it('scopes soft-delete to session orgId', async () => {
      await DELETE(makeRequest('/api/daily-note', {
        method: 'DELETE', body: { noteId: 'note_1' },
      }));
      expect(hasOrgFilter('daily_notes', ORG_A)).toBe(true);
    });
  });
});
