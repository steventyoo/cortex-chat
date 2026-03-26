import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, isAdminRole, hashPassword } from '@/lib/auth-v2';
import { getUsersByOrg, getUserByEmail, createUser, getSupabase } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const members = await getUsersByOrg(session.orgId);
    return Response.json({
      members: members.map((m) => ({
        userId: m.userId,
        email: m.email,
        name: m.name,
        role: m.role,
        active: m.active,
        lastLogin: m.lastLogin,
      })),
    });
  } catch (err) {
    console.error('List members error:', err);
    return Response.json({ error: 'Failed to list members' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isAdminRole(session.role)) {
    return Response.json({ error: 'Only admins can invite members' }, { status: 403 });
  }

  try {
    const { email, name, role, password } = await req.json();

    if (!email || !name || !password) {
      return Response.json({ error: 'email, name, and password are required' }, { status: 400 });
    }

    const validRoles = ['admin', 'member', 'viewer'];
    const memberRole = validRoles.includes(role) ? role : 'member';

    const existing = await getUserByEmail(email);
    if (existing) {
      return Response.json(
        { error: 'A user with this email already exists' },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);
    const user = await createUser({
      orgId: session.orgId,
      email: email.toLowerCase(),
      name,
      passwordHash,
      role: memberRole,
    });

    return Response.json({
      member: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    }, { status: 201 });
  } catch (err) {
    console.error('Add member error:', err);
    return Response.json({ error: 'Failed to add member' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isAdminRole(session.role)) {
    return Response.json({ error: 'Only admins can remove members' }, { status: 403 });
  }

  try {
    const { userId } = await req.json();
    if (!userId) {
      return Response.json({ error: 'userId is required' }, { status: 400 });
    }

    if (userId === session.userId) {
      return Response.json({ error: 'Cannot remove yourself' }, { status: 400 });
    }

    const sb = getSupabase();
    const { error } = await sb
      .from('users')
      .update({ active: false })
      .eq('user_id', userId)
      .eq('org_id', session.orgId);

    if (error) {
      return Response.json({ error: 'Failed to remove member' }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error('Remove member error:', err);
    return Response.json({ error: 'Failed to remove member' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isAdminRole(session.role)) {
    return Response.json({ error: 'Only admins can update member roles' }, { status: 403 });
  }

  try {
    const { userId, role } = await req.json();
    if (!userId || !role) {
      return Response.json({ error: 'userId and role are required' }, { status: 400 });
    }

    const validRoles = ['admin', 'member', 'viewer'];
    if (!validRoles.includes(role)) {
      return Response.json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` }, { status: 400 });
    }

    if (userId === session.userId) {
      return Response.json({ error: 'Cannot change your own role' }, { status: 400 });
    }

    const sb = getSupabase();
    const { error } = await sb
      .from('users')
      .update({ role })
      .eq('user_id', userId)
      .eq('org_id', session.orgId);

    if (error) {
      return Response.json({ error: 'Failed to update role' }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error('Update member role error:', err);
    return Response.json({ error: 'Failed to update member role' }, { status: 500 });
  }
}
