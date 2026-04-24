import ProjectPipelineClient from '@/components/ProjectPipelineClient';

export default async function ProjectPipelinePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectPipelineClient projectId={projectId} />;
}
