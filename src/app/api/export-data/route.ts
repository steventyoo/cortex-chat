import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const projectId = searchParams.get('projectId');
  const tab = searchParams.get('tab');
  const canonical = searchParams.get('canonical');
  const section = searchParams.get('section');
  const skillId = searchParams.get('skillId') || 'job_cost_report';

  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  const sb = getSupabase();
  const PAGE_SIZE = 1000;
  let allRows: Record<string, unknown>[] = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    let query = sb
      .from('computed_export')
      .select('*')
      .eq('project_id', projectId)
      .eq('skill_id', skillId)
      .order('tab')
      .order('section')
      .order('record_key')
      .range(from, from + PAGE_SIZE - 1);

    if (tab) query = query.eq('tab', tab);
    if (section) query = query.eq('section', section);
    if (canonical) query = query.eq('canonical_name', canonical);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const page = data || [];
    allRows = allRows.concat(page);
    hasMore = page.length === PAGE_SIZE;
    from += PAGE_SIZE;
  }

  return NextResponse.json({ rows: allRows, count: allRows.length });
}
