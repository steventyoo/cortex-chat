import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { runCoverageAnalysis } from '@/lib/coverage';
import { getSupabase } from '@/lib/supabase';

export const maxDuration = 300;

const CACHE_MAX_AGE_HOURS = 24;

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, jcrPipelineId, forceRefresh } = await request.json().catch(() => ({
    projectId: null,
    jcrPipelineId: null,
    forceRefresh: false,
  }));
  const orgId = (session as SessionPayload).orgId;
  const sb = getSupabase();

  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cutoff = new Date(Date.now() - CACHE_MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();

    let cacheQuery = sb
      .from('coverage_reports')
      .select('report, doc_count, created_at')
      .eq('org_id', orgId)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(1);

    if (projectId) {
      cacheQuery = cacheQuery.eq('project_id', projectId);
    } else {
      cacheQuery = cacheQuery.is('project_id', null);
    }

    const { data: cached } = await cacheQuery;

    if (cached && cached.length > 0) {
      // Check if new documents have been pushed since the report was generated
      let docCountQuery = sb
        .from('pipeline_log')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .in('status', ['pending_review', 'tier2_validated', 'pushed'])
        .not('extracted_data', 'is', null);

      if (projectId) {
        docCountQuery = docCountQuery.eq('project_id', projectId);
      }

      const { count: currentDocCount } = await docCountQuery;

      if (currentDocCount != null && currentDocCount === cached[0].doc_count) {
        return Response.json({
          success: true,
          report: cached[0].report,
          cached: true,
          cachedAt: cached[0].created_at,
        });
      }
    }
  }

  // Cache miss or stale — run the full AI analysis
  try {
    const report = await runCoverageAnalysis(orgId, projectId, jcrPipelineId);

    if (!report) {
      return Response.json(
        { error: 'No Job Cost Report found for this project' },
        { status: 404 }
      );
    }

    // Count current documents for staleness check
    let docCountQuery = sb
      .from('pipeline_log')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .in('status', ['pending_review', 'tier2_validated', 'pushed'])
      .not('extracted_data', 'is', null);

    if (projectId) {
      docCountQuery = docCountQuery.eq('project_id', projectId);
    }

    const { count: docCount } = await docCountQuery;

    // Store in cache (upsert-like: delete old entries for this org/project, insert new)
    await sb
      .from('coverage_reports')
      .delete()
      .eq('org_id', orgId)
      .eq('project_id', projectId || '');

    await sb
      .from('coverage_reports')
      .insert({
        org_id: orgId,
        project_id: projectId || null,
        jcr_pipeline_id: report.jcrId,
        report,
        doc_count: docCount || 0,
      });

    return Response.json({ success: true, report, cached: false });
  } catch (err) {
    console.error('Coverage analysis failed:', err);
    return Response.json(
      { error: 'Coverage analysis failed', details: String(err) },
      { status: 500 }
    );
  }
}
