import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

const BATCH_SIZE = 1000;

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const sb = getSupabase();

    const counts: Record<string, number> = {};
    const categoryCounts: Record<string, number> = {};
    const drivePathCounts: Record<string, number> = {};
    let uncategorizedCount = 0;
    let total = 0;
    let offset = 0;

    while (true) {
      const { data, error } = await sb
        .from('pipeline_log')
        .select('status, category_id, drive_folder_path')
        .eq('org_id', session.orgId)
        .neq('status', 'deleted')
        .neq('is_latest_version', false)
        .range(offset, offset + BATCH_SIZE - 1);

      if (error) {
        console.error('Stats query error:', error.message);
        return Response.json({ error: 'Failed to fetch stats' }, { status: 500 });
      }

      const rows = data || [];
      total += rows.length;

      for (const row of rows) {
        const s = row.status as string;
        counts[s] = (counts[s] || 0) + 1;

        const catId = row.category_id as string | null;
        if (catId) {
          categoryCounts[catId] = (categoryCounts[catId] || 0) + 1;
        } else {
          uncategorizedCount++;
        }

        const drivePath = row.drive_folder_path as string | null;
        if (drivePath) {
          drivePathCounts[drivePath] = (drivePathCounts[drivePath] || 0) + 1;
        }
      }

      if (rows.length < BATCH_SIZE) break;
      offset += BATCH_SIZE;
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
      uncategorizedCount,
      drivePathCounts,
    });
  } catch (err) {
    console.error('Stats error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
