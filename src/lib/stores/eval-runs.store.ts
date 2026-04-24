import { getSupabase } from '@/lib/supabase';

// ─── Reads ──────────────────────────────────────────────────────

export async function listEvalRuns(orgId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('eval_runs')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

export async function getEvalRun(runId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('eval_runs')
    .select('*')
    .eq('id', runId)
    .single();
  if (error) throw error;
  return data;
}

export async function getEvalRunResults(runId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('eval_run_results')
    .select('*')
    .eq('run_id', runId)
    .order('item_key', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ─── Writes ─────────────────────────────────────────────────────

export async function insertEvalRun(row: {
  org_id: string;
  run_label: string;
  run_type: string;
  skill_id?: string | null;
  suite?: string | null;
  total_items: number;
  passed: number;
  failed: number;
  missing: number;
  accuracy: number;
  metadata?: Record<string, unknown>;
}) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('eval_runs')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function insertEvalRunResults(rows: Array<{
  run_id: string;
  item_key: string;
  field?: string | null;
  category?: string | null;
  status: string;
  score: number;
  expected?: string | null;
  actual?: string | null;
  delta?: number | null;
  metadata?: Record<string, unknown>;
}>) {
  if (rows.length === 0) return [];
  const sb = getSupabase();
  const batchSize = 500;
  const allData: unknown[] = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { data, error } = await sb
      .from('eval_run_results')
      .insert(batch)
      .select();
    if (error) throw error;
    if (data) allData.push(...data);
  }
  return allData;
}
