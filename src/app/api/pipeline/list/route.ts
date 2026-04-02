import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { parsePipelineItem } from '@/lib/pipeline';
import { getSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  const status = searchParams.get('status');
  const showAllVersions = searchParams.get('allVersions') === 'true';

  try {
    const sb = getSupabase();
    let query = sb.from('pipeline_log').select('*').eq('org_id', session.orgId).neq('status', 'deleted').order('created_at', { ascending: false }).limit(100);

    if (!showAllVersions) {
      query = query.neq('is_latest_version', false);
    }

    if (projectId) query = query.eq('project_id', projectId);
    if (status) {
      const STATUS_GROUPS: Record<string, string[]> = {
        approved: ['approved', 'pushed'],
        pending_review: ['pending_review', 'tier2_validated'],
      };
      const statuses = STATUS_GROUPS[status];
      if (statuses) {
        query = query.in('status', statuses);
      } else {
        query = query.eq('status', status);
      }
    }

    const { data, error } = await query;
    if (error) {
      console.error('Supabase error:', error.message);
      return Response.json({ error: 'Failed to fetch pipeline data' }, { status: 500 });
    }

    // Map Supabase rows to the Airtable-shaped records that parsePipelineItem expects
    const items = (data || []).map((row: Record<string, unknown>) => {
      const fields: Record<string, unknown> = {};
      // Map snake_case columns to Title Case field names for parsePipelineItem
      fields['Pipeline ID'] = row.pipeline_id;
      fields['Project ID'] = row.project_id;
      fields['File Name'] = row.file_name;
      fields['File URL'] = row.file_url;
      fields['Document Type'] = row.document_type;
      fields['Status'] = row.status;
      fields['Overall Confidence'] = row.overall_confidence;
      fields['Source Text'] = row.source_text;
      fields['Extracted Data'] = row.extracted_data ? JSON.stringify(row.extracted_data) : null;
      fields['Validation Flags'] = row.validation_flags ? JSON.stringify(row.validation_flags) : null;
      fields['AI Model'] = row.ai_model;
      fields['Reviewer'] = row.reviewer;
      fields['Review Action'] = row.review_action;
      fields['Review Notes'] = row.review_notes;
      fields['Review Edits'] = row.review_edits ? JSON.stringify(row.review_edits) : null;
      fields['Rejection Reason'] = row.rejection_reason;
      fields['Airtable Record IDs'] = row.pushed_record_ids;
      fields['Created At'] = row.created_at;
      fields['Tier1 Completed At'] = row.tier1_completed_at;
      fields['Tier2 Completed At'] = row.tier2_completed_at;
      fields['Reviewed At'] = row.reviewed_at;
      fields['Pushed At'] = row.pushed_at;
      fields['Drive File ID'] = row.drive_file_id;
      fields['Drive Web View Link'] = row.drive_web_view_link;
      fields['Drive Folder Path'] = row.drive_folder_path;
      fields['Drive Modified Time'] = row.drive_modified_time;
      fields['Storage Path'] = row.storage_path;
      fields['Is Latest Version'] = row.is_latest_version;
      fields['Category ID'] = row.category_id;
      fields['Canonical Name'] = row.canonical_name;
      return parsePipelineItem({ id: String(row.id), fields });
    });

    const stats = {
      total: items.length,
      pendingReview: items.filter((i: { status: string }) => i.status === 'pending_review').length,
      approved: items.filter((i: { status: string }) => i.status === 'approved' || i.status === 'pushed').length,
      rejected: items.filter((i: { status: string }) => i.status === 'rejected').length,
      flagged: items.filter((i: { status: string }) => i.status === 'tier2_flagged').length,
      processing: items.filter((i: { status: string }) =>
        i.status === 'queued' || i.status === 'processing' || i.status === 'tier1_extracting' || i.status === 'tier2_validating'
      ).length,
    };

    return Response.json({ items, stats });
  } catch (err) {
    console.error('Pipeline list error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
