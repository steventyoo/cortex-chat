import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const projectId = searchParams.get('projectId');
  const tab = searchParams.get('tab');
  const canonical = searchParams.get('canonical');
  const section = searchParams.get('section');

  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  const sb = getSupabase();
  let query = sb
    .from('jcr_export')
    .select('*')
    .eq('project_id', projectId)
    .order('tab')
    .order('section')
    .order('record_key');

  if (tab) query = query.eq('tab', tab);
  if (section) query = query.eq('section', section);
  if (canonical) query = query.eq('canonical_name', canonical);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rows: data || [], count: data?.length || 0 });
}
