import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const validateUserSession = vi.fn();
  const isAdminRole = vi.fn((role: string) => role === 'owner' || role === 'admin');
  const getOrganization = vi.fn();
  const updateOrganization = vi.fn();
  return { validateUserSession, isAdminRole, getOrganization, updateOrganization };
});

vi.mock('@/lib/auth-v2', () => ({
  validateUserSession: mocks.validateUserSession,
  SESSION_COOKIE: 'cortex-session',
  isAdminRole: mocks.isAdminRole,
}));

vi.mock('@/lib/supabase', () => ({
  getOrganization: mocks.getOrganization,
  updateOrganization: mocks.updateOrganization,
}));

import { makeSession, makeRequest, ORG_A, ORG_B } from '../helpers';
import { GET, PATCH } from '@/app/api/org/settings/route';

describe('/api/org/settings — org isolation', () => {
  beforeEach(() => {
    mocks.validateUserSession.mockReset();
    mocks.isAdminRole.mockReset();
    mocks.getOrganization.mockReset();
    mocks.updateOrganization.mockReset();

    mocks.validateUserSession.mockResolvedValue(makeSession());
    mocks.isAdminRole.mockImplementation((role: string) => role === 'owner' || role === 'admin');
    mocks.getOrganization.mockResolvedValue({
      orgId: ORG_A, orgName: 'Org A', ownerEmail: 'owner@a.com', plan: 'pro',
      driveFolderId: null, alertEmailEnabled: true, weeklyReportEnabled: false,
      logoUrl: null, onboardingComplete: true,
    });
    mocks.updateOrganization.mockResolvedValue(undefined);
  });

  describe('GET', () => {
    it('returns 401 without session cookie', async () => {
      const res = await GET(makeRequest('/api/org/settings', { cookie: false }));
      expect(res.status).toBe(401);
    });

    it('calls getOrganization with session orgId', async () => {
      await GET(makeRequest('/api/org/settings'));
      expect(mocks.getOrganization).toHaveBeenCalledWith(ORG_A);
      expect(mocks.getOrganization).not.toHaveBeenCalledWith(ORG_B);
    });

    it('returns org settings', async () => {
      const res = await GET(makeRequest('/api/org/settings'));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.orgId).toBe(ORG_A);
    });
  });

  describe('PATCH', () => {
    it('returns 401 without session cookie', async () => {
      const res = await PATCH(makeRequest('/api/org/settings', {
        method: 'PATCH', body: { orgName: 'New' }, cookie: false,
      }));
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      mocks.validateUserSession.mockResolvedValueOnce(makeSession({ role: 'viewer' }));
      mocks.isAdminRole.mockReturnValueOnce(false);
      const res = await PATCH(makeRequest('/api/org/settings', {
        method: 'PATCH', body: { orgName: 'New' },
      }));
      expect(res.status).toBe(403);
    });

    it('calls updateOrganization with session orgId', async () => {
      await PATCH(makeRequest('/api/org/settings', {
        method: 'PATCH', body: { orgName: 'Renamed' },
      }));
      expect(mocks.updateOrganization).toHaveBeenCalledWith(ORG_A, expect.objectContaining({ orgName: 'Renamed' }));
    });

    it('returns 400 when no valid fields provided', async () => {
      const res = await PATCH(makeRequest('/api/org/settings', {
        method: 'PATCH', body: { plan: 'enterprise' },
      }));
      expect(res.status).toBe(400);
    });
  });
});
