import { vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SessionPayload } from '@/lib/auth-v2';

export const ORG_A = 'org_test_A';
export const ORG_B = 'org_test_B';

export function makeSession(overrides: Partial<SessionPayload> = {}): SessionPayload {
  return {
    userId: 'usr_testuser1',
    orgId: ORG_A,
    email: 'alice@orga.com',
    name: 'Alice',
    role: 'owner',
    ...overrides,
  };
}

export function makeRequest(
  url: string,
  opts: { method?: string; body?: unknown; cookie?: boolean } = {},
): NextRequest {
  const { method = 'GET', body, cookie = true } = opts;
  const headers = new Headers();
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (cookie) headers.set('Cookie', 'cortex-session=mock-token');
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest(new URL(url, 'http://localhost:3000'), init);
}

export interface QueryLog {
  table: string;
  filters: Array<{ method: string; args: unknown[] }>;
}

export function createSupabaseChainMock(resolvedData: unknown = []) {
  const logs: QueryLog[] = [];
  let currentLog: QueryLog | null = null;

  function chain() {
    const self: Record<string, unknown> = {};
    const methods = ['select', 'eq', 'neq', 'in', 'order', 'limit', 'single', 'insert', 'update', 'delete', 'rpc'];
    for (const m of methods) {
      self[m] = (...args: unknown[]) => {
        if (currentLog) currentLog.filters.push({ method: m, args });
        if (m === 'single') {
          return Promise.resolve({
            data: Array.isArray(resolvedData) ? resolvedData[0] ?? null : resolvedData,
            error: null,
          });
        }
        return self;
      };
    }
    self.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve({ data: resolvedData, error: null }).then(resolve, reject);
    return self;
  }

  return {
    from: (table: string) => {
      currentLog = { table, filters: [] };
      logs.push(currentLog);
      return chain();
    },
    rpc: vi.fn().mockResolvedValue({ data: resolvedData, error: null }),
    storage: {
      from: () => ({
        createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.url' }, error: null }),
        upload: vi.fn().mockResolvedValue({ data: { path: 'test/path' }, error: null }),
      }),
    },
    logs,
    getFiltersForTable(table: string) {
      return logs.filter((l) => l.table === table).flatMap((l) => l.filters);
    },
    hasOrgFilter(table: string, orgId: string) {
      return this.getFiltersForTable(table).some(
        (f) => f.method === 'eq' && f.args[0] === 'org_id' && f.args[1] === orgId,
      );
    },
  };
}

/**
 * Build the mock return value for vi.mock('@/lib/auth-v2').
 * MUST be called inside the vi.mock factory with literal values
 * or vi.hoisted variables — NOT with file-scoped variables.
 */
export function buildAuthMock(orgId = ORG_A) {
  return {
    validateUserSession: vi.fn().mockResolvedValue({
      userId: 'usr_testuser1', orgId, email: 'alice@orga.com', name: 'Alice', role: 'owner' as const,
    }),
    SESSION_COOKIE: 'cortex-session',
    isAdminRole: vi.fn((role: string) => role === 'owner' || role === 'admin'),
    hashPassword: vi.fn().mockResolvedValue('hashed_pw'),
    createUserSession: vi.fn().mockResolvedValue('mock-token'),
    sessionCookieOptions: vi.fn().mockReturnValue({}),
  };
}
