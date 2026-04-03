import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const sb = getSupabase();

    const { data, error } = await sb
      .from('pipeline_log')
      .select('status, category_id')
      .eq('org_id', session.orgId)
      .neq('status', 'deleted')
      .neq('is_latest_version', false);

    if (error) {
      console.error('Stats query error:', error.message);
      return Response.json({ error: 'Failed to fetch stats' }, { status: 500 });
    }

    const rows = data || [];
    const total = rows.length;
    const counts: Record<string, number> = {};
    const categoryCounts: Record<string, number> = {};
    const uncategorizedCount = { value: 0 };

    for (const row of rows) {
      const s = row.status as string;
      counts[s] = (counts[s] || 0) + 1;

      const catId = row.category_id as string | null;
      if (catId) {
        categoryCounts[catId] = (categoryCounts[catId] || 0) + 1;
      } else {
        uncategorizedCount.value++;
      }
    }

    const processing = (counts.queued || 0) + (counts.processing || 0) +
      (counts.tier1_extracting || 0) + (counts.tier2_validating || 0);
    const completed = (counts.pending_review || 0) + (counts.tier2_validated || 0) +
      (counts.approved || 0) + (counts.pushed || 0) + (counts.rejected || 0);
    const failed = counts.failed || 0;
    const storedOnly = counts.stored_only || 0;

    return Response.json({
      total,
      processing,
      completed,
      failed,
      storedOnly,
      pendingReview: (counts.pending_review || 0) + (counts.tier2_validated || 0),
      approved: (counts.approved || 0) + (counts.pushed || 0),
      rejected: counts.rejected || 0,
      flagged: counts.tier2_flagged || 0,
      byStatus: counts,
      categoryCounts,
      uncategorizedCount: uncategorizedCount.value,
    });
  } catch (err) {
    console.error('Stats error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
