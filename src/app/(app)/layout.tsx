import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { fetchProjectList } from '@/lib/supabase';
import { ProjectSummary } from '@/lib/types';
import AppShell from '@/components/AppShell';

export const dynamic = 'force-dynamic';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let projects: ProjectSummary[] = [];

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    let orgId: string | undefined;
    if (token) {
      const session = await validateUserSession(token);
      orgId = session?.orgId;
    }
    projects = await fetchProjectList(orgId);
  } catch (err) {
    console.error('Failed to fetch projects:', err);
  }

  return (
    <AppShell projects={projects}>
      <Suspense
        fallback={
          <div className="flex-1 flex items-center justify-center">
            <div className="flex items-center gap-3">
              <svg className="animate-spin w-5 h-5 text-[#999]" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              <span className="text-[14px] text-[#999]">Loading...</span>
            </div>
          </div>
        }
      >
        {children}
      </Suspense>
    </AppShell>
  );
}
