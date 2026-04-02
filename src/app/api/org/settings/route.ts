import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, isAdminRole } from '@/lib/auth-v2';
import { getOrganization, updateOrganization } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const org = await getOrganization(session.orgId);
    if (!org) {
      return Response.json({ error: 'Organization not found' }, { status: 404 });
    }

    return Response.json({
      orgId: org.orgId,
      orgName: org.orgName,
      ownerEmail: org.ownerEmail,
      plan: org.plan,
      driveFolderId: org.driveFolderId,
      alertEmailEnabled: org.alertEmailEnabled,
      weeklyReportEnabled: org.weeklyReportEnabled,
      logoUrl: org.logoUrl,
      onboardingComplete: org.onboardingComplete,
      serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || null,
    });
  } catch (err) {
    console.error('Get org settings error:', err);
    return Response.json({ error: 'Failed to fetch organization settings' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isAdminRole(session.role)) {
    return Response.json({ error: 'Only admins can update organization settings' }, { status: 403 });
  }

  try {
    const body = await req.json();

    const allowedFields = [
      'orgName',
      'driveFolderId',
      'alertEmailEnabled',
      'weeklyReportEnabled',
      'logoUrl',
    ] as const;

    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    await updateOrganization(session.orgId, updates as Parameters<typeof updateOrganization>[1]);

    const org = await getOrganization(session.orgId);
    return Response.json({
      orgId: org?.orgId,
      orgName: org?.orgName,
      plan: org?.plan,
      driveFolderId: org?.driveFolderId,
      alertEmailEnabled: org?.alertEmailEnabled,
      weeklyReportEnabled: org?.weeklyReportEnabled,
      logoUrl: org?.logoUrl,
    });
  } catch (err) {
    console.error('Update org settings error:', err);
    return Response.json({ error: 'Failed to update organization settings' }, { status: 500 });
  }
}
