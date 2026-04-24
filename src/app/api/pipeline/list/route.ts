import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { parsePipelineItem } from '@/lib/pipeline';
import { getSupabase } from '@/lib/supabase';

interface CategoryRow {
  id: string;
  key: string;
  label: string;
  priority: string;
  sort_order: number;
  is_default: boolean;
}

const STATUS_GROUPS: Record<string, string[]> = {
  approved: ['approved', 'pushed'],
  pending_review: ['pending_review', 'tier2_validated'],
  processing: ['queued', 'processing', 'tier1_extracting', 'tier2_validating'],
};

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
  const categoryId = searchParams.get('categoryId');
  const driveFolderPath = searchParams.get('driveFolderPath');
  const projectFolder = searchParams.get('projectFolder');
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get('pageSize') || '50', 10)));

  try {
    const sb = getSupabase();

    // --- Count query (for pagination metadata) ---
    let countQ = sb.from('pipeline_log').select('*', { count: 'exact', head: true })
      .eq('org_id', session.orgId)
      .neq('status', 'deleted');
    if (!showAllVersions) countQ = countQ.neq('is_latest_version', false);
    if (projectId) countQ = countQ.eq('project_id', projectId);
    if (categoryId) {
      if (categoryId === 'null') {
        countQ = countQ.is('category_id', null);
      } else {
        countQ = countQ.eq('category_id', categoryId);
      }
    }
    if (status) {
      const group = STATUS_GROUPS[status];
      if (group) { countQ = countQ.in('status', group); }
      else { countQ = countQ.eq('status', status); }
    }
    if (driveFolderPath) {
      countQ = countQ.eq('drive_folder_path', driveFolderPath);
    }
    if (projectFolder) {
      if (projectFolder === '__company_wide') {
        // Handled via categoryId filter from the UI
      } else if (projectFolder === '__no_project') {
        countQ = countQ.is('drive_folder_path', null);
      } else if (projectFolder === '__uncategorized') {
        // No project folder filter needed — categoryId=null handles it
      } else {
        countQ = countQ.or(`drive_folder_path.eq.${projectFolder},drive_folder_path.like.${projectFolder} / %`);
      }
    }
    const { count: totalCount } = await countQ;

    // --- Data query (paginated) ---
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let dataQ = sb.from('pipeline_log').select('*')
      .eq('org_id', session.orgId)
      .neq('status', 'deleted')
      .order('created_at', { ascending: false })
      .range(from, to);
    if (!showAllVersions) dataQ = dataQ.neq('is_latest_version', false);
    if (projectId) dataQ = dataQ.eq('project_id', projectId);
    if (categoryId) {
      if (categoryId === 'null') {
        dataQ = dataQ.is('category_id', null);
      } else {
        dataQ = dataQ.eq('category_id', categoryId);
      }
    }
    if (status) {
      const group = STATUS_GROUPS[status];
      if (group) { dataQ = dataQ.in('status', group); }
      else { dataQ = dataQ.eq('status', status); }
    }
    if (driveFolderPath) {
      dataQ = dataQ.eq('drive_folder_path', driveFolderPath);
    }
    if (projectFolder) {
      if (projectFolder === '__company_wide') {
        // Handled via categoryId filter from the UI
      } else if (projectFolder === '__no_project') {
        dataQ = dataQ.is('drive_folder_path', null);
      } else if (projectFolder === '__uncategorized') {
        // No project folder filter needed — categoryId=null handles it
      } else {
        dataQ = dataQ.or(`drive_folder_path.eq.${projectFolder},drive_folder_path.like.${projectFolder} / %`);
      }
    }

    const { data, error } = await dataQ;
    if (error) {
      console.error('Supabase error:', error.message);
      return Response.json({ error: 'Failed to fetch pipeline data' }, { status: 500 });
    }

    const { data: catData } = await sb
      .from('document_categories')
      .select('id, key, label, priority, sort_order, is_default')
      .eq('org_id', session.orgId)
      .order('sort_order', { ascending: true });

    const categories: CategoryRow[] = (catData || []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      key: String(r.key),
      label: String(r.label),
      priority: String(r.priority),
      sort_order: Number(r.sort_order),
      is_default: Boolean(r.is_default),
    }));

    const items = (data || []).map((row: Record<string, unknown>) => {
      const fields: Record<string, unknown> = {};
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
      fields['Page Count'] = row.page_count;
      fields['Reconciliation Score'] = row.reconciliation_score;
      return parsePipelineItem({ id: String(row.id), fields });
    });

    const totalPages = Math.ceil((totalCount || 0) / pageSize);
    const pagination = {
      page,
      pageSize,
      totalItems: totalCount || 0,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };

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

    return Response.json({ items, stats, categories, pagination });
  } catch (err) {
    console.error('Pipeline list error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
