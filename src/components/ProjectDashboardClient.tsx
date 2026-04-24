'use client';

import dynamic from 'next/dynamic';

const ProjectDashboard = dynamic(() => import('./ProjectDashboard'), { ssr: false });

interface Props {
  projectId: string;
  projectName?: string;
  projectAddress?: string;
  projectTrade?: string;
}

export default function ProjectDashboardClient({
  projectId,
  projectName,
  projectAddress,
  projectTrade,
}: Props) {
  return (
    <ProjectDashboard
      projectId={projectId}
      projectName={projectName}
      projectAddress={projectAddress}
      projectTrade={projectTrade}
    />
  );
}
