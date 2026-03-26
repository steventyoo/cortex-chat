import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const validateUserSession = vi.fn();
  const isAdminRole = vi.fn((role: string) => role === 'owner' || role === 'admin');
  const hashPassword = vi.fn().mockResolvedValue('hashed_pw');
  const getUsersByOrg = vi.fn().mockResolvedValue([]);
  const getUserByEmail = vi.fn().mockResolvedValue(null);
  const createUser = vi.fn().mockResolvedValue({
    userId: 'usr_new', orgId: 'org_test_A', email: 'new@test.com', name: 'New User', role: 'member',
  });

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

  return {
    validateUserSession, isAdminRole, hashPassword,
    getUsersByOrg, getUserByEmail, createUser,
    logs, sbMock,
  };
});

vi.mock('@/lib/auth-v2', () => ({
  validateUserSession: mocks.validateUserSession,
  SESSION_COOKIE: 'cortex-session',
  isAdminRole: mocks.isAdminRole,
  hashPassword: mocks.hashPassword,
}));

vi.mock('@/lib/supabase', () => ({
  getUsersByOrg: mocks.getUsersByOrg,
  getUserByEmail: mocks.getUserByEmail,
  createUser: mocks.createUser,
  getSupabase: () => mocks.sbMock,
}));

import { makeSession, makeRequest, ORG_A, ORG_B } from '../helpers';
import { GET, POST, DELETE, PATCH } from '@/app/api/org/members/route';

function hasOrgFilter(table: string, orgId: string) {
  return mocks.logs
    .filter((l) => l.table === table)
    .flatMap((l) => l.filters)
    .some((f) => f.method === 'eq' && f.args[0] === 'org_id' && f.args[1] === orgId);
}

describe('/api/org/members — org isolation', () => {
  beforeEach(() => {
    mocks.logs.length = 0;
    mocks.validateUserSession.mockReset();
    mocks.isAdminRole.mockReset();
    mocks.getUsersByOrg.mockReset();
    mocks.getUserByEmail.mockReset();
    mocks.createUser.mockReset();

    mocks.validateUserSession.mockResolvedValue(makeSession());
    mocks.isAdminRole.mockImplementation((role: string) => role === 'owner' || role === 'admin');
    mocks.getUsersByOrg.mockResolvedValue([]);
    mocks.getUserByEmail.mockResolvedValue(null);
    mocks.createUser.mockResolvedValue({
      userId: 'usr_new', orgId: ORG_A, email: 'new@test.com', name: 'New User', role: 'member',
    });
  });

  describe('GET', () => {
    it('returns 401 without session cookie', async () => {
      const res = await GET(makeRequest('/api/org/members', { cookie: false }));
      expect(res.status).toBe(401);
    });

    it('calls getUsersByOrg with session orgId', async () => {
      await GET(makeRequest('/api/org/members'));
      expect(mocks.getUsersByOrg).toHaveBeenCalledWith(ORG_A);
      expect(mocks.getUsersByOrg).not.toHaveBeenCalledWith(ORG_B);
    });
  });

  describe('POST (invite)', () => {
    it('returns 403 for non-admin', async () => {
      mocks.validateUserSession.mockResolvedValueOnce(makeSession({ role: 'viewer' }));
      mocks.isAdminRole.mockReturnValueOnce(false);
      const res = await POST(makeRequest('/api/org/members', {
        method: 'POST', body: { email: 'a@b.com', name: 'A', password: 'pass' },
      }));
      expect(res.status).toBe(403);
    });

    it('returns 409 for duplicate email', async () => {
      mocks.getUserByEmail.mockResolvedValueOnce({ userId: 'usr_existing' });
      const res = await POST(makeRequest('/api/org/members', {
        method: 'POST', body: { email: 'dup@b.com', name: 'Dup', password: 'pass' },
      }));
      expect(res.status).toBe(409);
    });

    it('creates user with session orgId', async () => {
      await POST(makeRequest('/api/org/members', {
        method: 'POST', body: { email: 'new@b.com', name: 'New', password: 'pass' },
      }));
      expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG_A }));
    });
  });

  describe('DELETE', () => {
    it('returns 403 for non-admin', async () => {
      mocks.validateUserSession.mockResolvedValueOnce(makeSession({ role: 'member' }));
      mocks.isAdminRole.mockReturnValueOnce(false);
      const res = await DELETE(makeRequest('/api/org/members', {
        method: 'DELETE', body: { userId: 'usr_other' },
      }));
      expect(res.status).toBe(403);
    });

    it('cannot remove yourself', async () => {
      const res = await DELETE(makeRequest('/api/org/members', {
        method: 'DELETE', body: { userId: 'usr_testuser1' },
      }));
      expect(res.status).toBe(400);
    });

    it('scopes deactivation to session orgId', async () => {
      await DELETE(makeRequest('/api/org/members', {
        method: 'DELETE', body: { userId: 'usr_other' },
      }));
      expect(hasOrgFilter('users', ORG_A)).toBe(true);
    });
  });

  describe('PATCH', () => {
    it('returns 403 for non-admin', async () => {
      mocks.validateUserSession.mockResolvedValueOnce(makeSession({ role: 'viewer' }));
      mocks.isAdminRole.mockReturnValueOnce(false);
      const res = await PATCH(makeRequest('/api/org/members', {
        method: 'PATCH', body: { userId: 'usr_other', role: 'admin' },
      }));
      expect(res.status).toBe(403);
    });

    it('cannot change your own role', async () => {
      const res = await PATCH(makeRequest('/api/org/members', {
        method: 'PATCH', body: { userId: 'usr_testuser1', role: 'viewer' },
      }));
      expect(res.status).toBe(400);
    });

    it('scopes role update to session orgId', async () => {
      await PATCH(makeRequest('/api/org/members', {
        method: 'PATCH', body: { userId: 'usr_other', role: 'admin' },
      }));
      expect(hasOrgFilter('users', ORG_A)).toBe(true);
    });
  });
});
