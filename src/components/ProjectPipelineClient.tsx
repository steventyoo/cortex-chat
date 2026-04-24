'use client';

import dynamic from 'next/dynamic';

const PipelineReview = dynamic(() => import('./PipelineReview'), { ssr: false });

export default function ProjectPipelineClient({ projectId }: { projectId: string }) {
  return (
    <div className="flex-1 overflow-hidden h-full">
      <PipelineReview projectId={projectId} />
    </div>
  );
}
