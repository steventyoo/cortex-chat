import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { validateUserSession, SESSION_COOKIE, isAdminRole } from '@/lib/auth-v2';

export const dynamic = 'force-dynamic';

export default async function OperatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) redirect('/login');

  const session = await validateUserSession(token);
  if (!session || !isAdminRole(session.role)) {
    redirect('/');
  }

  return <>{children}</>;
}
