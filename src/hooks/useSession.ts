'use client';

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import type { UserRole } from '@/lib/schemas/enums';

export interface SessionUser {
  userId: string;
  orgId: string;
  email: string;
  name: string;
  role: UserRole;
  orgName: string;
  onboardingComplete: boolean;
}

interface SessionState {
  user: SessionUser | null;
  isLoading: boolean;
  isAdmin: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionState>({
  user: null,
  isLoading: true,
  isAdmin: false,
  refresh: async () => {},
  logout: async () => {},
});

export function useSession() {
  return useContext(SessionContext);
}

export { SessionContext };

export function useSessionProvider(): SessionState {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    window.location.href = '/login';
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Redirect to onboarding if not complete
  useEffect(() => {
    if (!isLoading && user && !user.onboardingComplete) {
      const path = window.location.pathname;
      if (path !== '/onboarding' && !path.startsWith('/api/')) {
        window.location.href = '/onboarding';
      }
    }
  }, [isLoading, user]);

  return {
    user,
    isLoading,
    isAdmin: user?.role === 'owner' || user?.role === 'admin',
    refresh,
    logout,
  };
}
