import { cookies } from 'next/headers';
import { fetchProjectList } from '@/lib/supabase';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { ProjectSummary } from '@/lib/types';
import ChatContainer from '@/components/ChatContainer';

export const dynamic = 'force-dynamic';

export default async function Home() {
  let projects: ProjectSummary[] = [];

  try {
    // Read org from JWT session
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

  return <ChatContainer projects={projects} />;
}
