import { cookies } from 'next/headers';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { fetchProjectList } from '@/lib/supabase';
import ProjectDashboardClient from '@/components/ProjectDashboardClient';

export default async function ProjectDashboardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;

  const projects = session ? await fetchProjectList(session.orgId) : [];
  const project = projects.find((p) => p.projectId === projectId);

  return (
    <ProjectDashboardClient
      projectId={projectId}
      projectName={project?.projectName}
      projectAddress={project?.address}
      projectTrade={project?.trade}
    />
  );
}
