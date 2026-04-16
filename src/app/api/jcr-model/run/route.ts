import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { runJcrModel } from '@/lib/jcr-model';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId } = body as { projectId?: string };

    if (!projectId) {
      return NextResponse.json({ error: 'projectId required' }, { status: 400 });
    }

    const sb = getSupabase();

    const { data: jcrDocs } = await sb
      .from('pipeline_log')
      .select('id, org_id, project_id, extracted_data')
      .eq('project_id', projectId)
      .eq('document_type', 'job_cost_report')
      .not('extracted_data', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!jcrDocs || jcrDocs.length === 0) {
      return NextResponse.json({ error: 'No JCR document found for project' }, { status: 404 });
    }

    const doc = jcrDocs[0];
    const ed = doc.extracted_data as {
      fields: Record<string, { value: string | number | null; confidence: number }>;
      records: Array<Record<string, { value: string | number | null; confidence: number }>>;
      skillId?: string;
      targetTables?: Array<{ table: string; records: Array<Record<string, { value: string | number | null; confidence: number }>> }>;
    };

    if (!ed?.fields || !ed?.records?.length) {
      return NextResponse.json({ error: 'JCR document has no extracted records' }, { status: 400 });
    }

    const workerRecords = ed.targetTables
      ?.find(t => t.table === 'worker_transactions')?.records;

    const result = await runJcrModel(
      doc.id,
      doc.project_id,
      doc.org_id,
      { ...ed, workerRecords },
    );

    return NextResponse.json({
      success: true,
      runId: result.runId,
      rowCount: result.rowCount,
      pipelineLogId: doc.id,
      workerCount: workerRecords?.length ?? 0,
    });
  } catch (err) {
    console.error('[jcr-model/run] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
