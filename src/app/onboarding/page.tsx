import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getOrganization } from '@/lib/organizations';
import OnboardingWizard from '@/components/OnboardingWizard';

export default async function OnboardingPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;

  if (!session) {
    redirect('/login');
  }

  const org = await getOrganization(session.orgId);
  if (!org) {
    redirect('/login');
  }

  // If onboarding is already complete, go home
  if (org.onboardingComplete) {
    redirect('/');
  }

  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';

  return (
    <OnboardingWizard
      orgName={org.orgName}
      serviceAccountEmail={serviceAccountEmail}
    />
  );
}
