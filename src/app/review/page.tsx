import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { validateToken, SESSION_COOKIE } from '@/lib/auth';
import PipelineReview from '@/components/PipelineReview';

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  // Auth check — redirect to login if not authenticated
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token || !(await validateToken(token))) {
    redirect('/');
  }

  return (
    <div className="h-dvh bg-white">
      <PipelineReview />
    </div>
  );
}
