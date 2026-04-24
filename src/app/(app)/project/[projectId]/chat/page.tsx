import ProjectChatClient from '@/components/ProjectChatClient';

export default async function ProjectChatPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectChatClient projectId={projectId} />;
}
