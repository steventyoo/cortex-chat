import { NextRequest } from 'next/server';
import { validateToken, SESSION_COOKIE } from '@/lib/auth';
import { parsePipelineItem } from '@/lib/pipeline';

const BASE_URL = 'https://api.airtable.com/v0';

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_PAT}`,
    'Content-Type': 'application/json',
  };
}

function getBaseId() {
  return process.env.AIRTABLE_BASE_ID || '';
}

export async function GET(request: NextRequest) {
  // Auth check
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateToken(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Optional filters from query params
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  const status = searchParams.get('status');

  // Build filter formula
  const filters: string[] = [];
  if (projectId) {
    filters.push(`{Project ID}='${projectId}'`);
  }
  if (status) {
    filters.push(`{Status}='${status}'`);
  }

  let filterFormula = '';
  if (filters.length === 1) {
    filterFormula = filters[0];
  } else if (filters.length > 1) {
    filterFormula = `AND(${filters.join(',')})`;
  }

  try {
    const params = new URLSearchParams({
      pageSize: '100',
      'sort[0][field]': 'Created At',
      'sort[0][direction]': 'desc',
    });
    if (filterFormula) {
      params.set('filterByFormula', filterFormula);
    }

    const url = `${BASE_URL}/${getBaseId()}/PIPELINE_LOG?${params}`;
    const response = await fetch(url, { headers: getHeaders(), cache: 'no-store' });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Airtable error:', errText);
      return Response.json({ error: 'Failed to fetch pipeline data' }, { status: 500 });
    }

    const data = await response.json();
    const items = (data.records || []).map((record: { id: string; fields: Record<string, unknown> }) =>
      parsePipelineItem(record)
    );

    // Compute stats
    const stats = {
      total: items.length,
      pendingReview: items.filter((i: { status: string }) => i.status === 'pending_review').length,
      approved: items.filter((i: { status: string }) => i.status === 'approved' || i.status === 'pushed').length,
      rejected: items.filter((i: { status: string }) => i.status === 'rejected').length,
      flagged: items.filter((i: { status: string }) => i.status === 'tier2_flagged').length,
      processing: items.filter((i: { status: string }) =>
        i.status === 'tier1_extracting' || i.status === 'tier2_validating'
      ).length,
    };

    return Response.json({ items, stats });
  } catch (err) {
    console.error('Pipeline list error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
