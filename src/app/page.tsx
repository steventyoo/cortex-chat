import { fetchProjectList } from '@/lib/airtable';
import { ProjectSummary } from '@/lib/types';
import ChatContainer from '@/components/ChatContainer';

export const dynamic = 'force-dynamic';

export default async function Home() {
  let projects: ProjectSummary[] = [];
  try {
    projects = await fetchProjectList();
  } catch (err) {
    console.error('Failed to fetch projects:', err);
  }

  return <ChatContainer projects={projects} />;
}
