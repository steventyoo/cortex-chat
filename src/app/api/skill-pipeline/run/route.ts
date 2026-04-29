import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { runSkillPipeline } from '@/lib/skill-pipeline';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, skillId } = body as { projectId?: string; skillId?: string };

    if (!projectId) {
      return NextResponse.json({ error: 'projectId required' }, { status: 400 });
    }

    const sb = getSupabase();

    const query = sb
      .from('pipeline_log')
      .select('id, org_id, project_id, document_type, extracted_data')
      .eq('project_id', projectId)
      .not('extracted_data', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1);

    if (skillId) {
      query.eq('document_type', skillId);
    }

    const { data: docs } = await query;

    if (!docs || docs.length === 0) {
      return NextResponse.json({ error: 'No extracted document found for project' }, { status: 404 });
    }

    const doc = docs[0];
    const resolvedSkillId = skillId || doc.document_type || 'job_cost_report';
    const ed = doc.extracted_data as {
      fields: Record<string, { value: string | number | null; confidence: number }>;
      records?: Array<Record<string, { value: string | number | null; confidence: number }>>;
      skillId?: string;
      targetTables?: Array<{ table: string; records: Array<Record<string, { value: string | number | null; confidence: number }>> }>;
    };

    if (!ed?.fields) {
      return NextResponse.json({ error: 'Document has no extracted fields' }, { status: 400 });
    }

    const collections: Record<string, Array<Record<string, { value: string | number | null; confidence: number }>>> = {};
    if (ed.records?.length) {
      collections.cost_code = ed.records;
    }
    for (const tt of ed.targetTables ?? []) {
      if (tt.table && tt.records?.length) {
        collections[tt.table] = tt.records;
      }
    }

    const result = await runSkillPipeline(
      doc.id,
      doc.project_id,
      doc.org_id,
      resolvedSkillId,
      { fields: ed.fields, collections },
    );

    return NextResponse.json({
      success: true,
      runId: result.runId,
      rowCount: result.rowCount,
      identityScore: result.identityScore,
      qualityScore: result.qualityScore,
      reconciliationScore: result.reconciliationScore,
      checksPassed: result.checkResults.filter(r => r.status === 'pass').length,
      checksFailed: result.checkResults.filter(r => r.status === 'fail').length,
      pipelineLogId: doc.id,
      skillId: resolvedSkillId,
    });
  } catch (err) {
    console.error('[skill-pipeline/run] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
