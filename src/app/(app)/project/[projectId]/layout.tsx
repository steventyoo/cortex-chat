import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { verifyProjectAccess, fetchProjectList } from '@/lib/supabase';
import { listProjectSources } from '@/lib/stores/project-sources.store';
import ProjectLayoutTabs from '@/components/ProjectLayoutTabs';

export const dynamic = 'force-dynamic';

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
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

  const [projects, sources] = await Promise.all([
    fetchProjectList(session.orgId),
    listProjectSources(session.orgId, projectId),
  ]);

  const project = projects.find((p) => p.projectId === projectId);
  const projectName = project?.projectName ?? projectId;

  const gdriveSource = sources.find(
    (s) => s.provider === 'gdrive' && s.kind === 'file'
  );
  const drivePath = gdriveSource
    ? (gdriveSource.config as Record<string, unknown>)?.folder_id
      ? `Google Drive / ${gdriveSource.label || (gdriveSource.config as Record<string, unknown>).folder_id}`
      : null
    : null;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Project header */}
      <div className="hidden lg:block border-b border-[#f0f0f0] bg-white/80 backdrop-blur-xl flex-shrink-0 px-6 pt-4 pb-0">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-[15px] font-semibold text-[#1a1a1a]">{projectName}</h1>
          {project?.status && (
            <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${
              project.status.toLowerCase().includes('complete') || project.status.toLowerCase().includes('closed')
                ? 'bg-[#f0f0f0] text-[#999]'
                : 'bg-[#e8f5e9] text-[#2e7d32]'
            }`}>
              {project.status}
            </span>
          )}
        </div>
        {drivePath && (
          <p className="text-[12px] text-[#999] mb-3 flex items-center gap-1.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#bbb]">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
            {drivePath}
          </p>
        )}
        <ProjectLayoutTabs projectId={projectId} />
      </div>

      {/* Mobile header (simplified) */}
      <div className="lg:hidden border-b border-[#f0f0f0] bg-white px-4 pt-3 pb-0 flex-shrink-0">
        <h1 className="text-[14px] font-semibold text-[#1a1a1a] mb-2">{projectName}</h1>
        <ProjectLayoutTabs projectId={projectId} />
      </div>

      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
