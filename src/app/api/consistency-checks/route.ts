import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const skillId = request.nextUrl.searchParams.get('skill_id') || undefined;

  try {
    const sb = getSupabase();
    let query = sb.from('consistency_checks').select('*').order('skill_id').order('tier').order('check_name');
    if (skillId) query = query.eq('skill_id', skillId);
    const { data, error } = await query;
    if (error) throw error;
    return Response.json({ checks: data || [] });
  } catch (err) {
    console.error('[consistency-checks] GET error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const sb = getSupabase();
    const { data, error } = await sb.from('consistency_checks').insert(body).select().single();
    if (error) throw error;
    return Response.json({ check: data });
  } catch (err) {
    console.error('[consistency-checks] POST error:', err);
    return Response.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, ...updates } = body;
    if (!id) return Response.json({ error: 'id required' }, { status: 400 });

    const sb = getSupabase();
    const { data, error } = await sb.from('consistency_checks').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return Response.json({ check: data });
  } catch (err) {
    console.error('[consistency-checks] PATCH error:', err);
    return Response.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await request.json();
    if (!id) return Response.json({ error: 'id required' }, { status: 400 });

    const sb = getSupabase();
    const { error } = await sb.from('consistency_checks').delete().eq('id', id);
    if (error) throw error;
    return Response.json({ success: true });
  } catch (err) {
    console.error('[consistency-checks] DELETE error:', err);
    return Response.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 });
  }
}
