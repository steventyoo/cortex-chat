import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { verifyProjectAccess } from '@/lib/supabase';
import ProjectSources from '@/components/ProjectSources';

export const dynamic = 'force-dynamic';

export default async function ProjectSourcesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) redirect('/login');
  const session = await validateUserSession(token);
  if (!session) redirect('/login');

  const hasAccess = await verifyProjectAccess(projectId, session.orgId);
  if (!hasAccess) redirect('/');

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="mb-6">
        <a href="/" className="text-[13px] text-[#007aff] hover:underline">
          &larr; Back to Dashboard
        </a>
        <h1 className="text-[22px] font-bold text-[#1a1a1a] mt-2">
          Project Sources
        </h1>
        <p className="text-[14px] text-[#999] mt-1">
          Manage data sources for <span className="font-medium text-[#555]">{projectId}</span>
        </p>
      </div>
      <ProjectSources projectId={projectId} />
    </div>
  );
}
