import { NextRequest, NextResponse } from 'next/server';
import { getQStashReceiver, publishExtractionContinuation, type ExtractionContinuationPayload } from '@/lib/qstash';
import { runExtractionAgent, type ContinuationState, type SchemaFieldDef } from '@/lib/extraction-agent';
import { put, del } from '@vercel/blob';
import { getSupabase } from '@/lib/supabase';
import { runSkillPipeline } from '@/lib/skill-pipeline';
import { getSkillFieldDefinitionsScoped, getSkill } from '@/lib/skills';
import { getBaseUrl } from '@/lib/base-url';

export const maxDuration = 600;

const MAX_CONTINUATION_ATTEMPTS = 5;

export async function POST(req: NextRequest) {
  const receiver = getQStashReceiver();
  const body = await req.text();
  const signature = req.headers.get('upstash-signature') ?? '';

  try {
    await receiver.verify({ body, signature });
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload: ExtractionContinuationPayload = JSON.parse(body);
  if (!payload.continuation || !payload.pipelineLogId || !payload.blobUrl) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { pipelineLogId, skillId, blobUrl, attempt } = payload;
  const sb = getSupabase();

  console.log(
    `[continue-extraction] Resuming: pipeline=${pipelineLogId} skill=${skillId} attempt=${attempt}`,
  );

  // Idempotency: check if already completed or a later attempt superseded this one
  const { data: logRow } = await sb
    .from('pipeline_log')
    .select('status, org_id, project_id')
    .eq('id', pipelineLogId)
    .single();

  if (!logRow || (logRow.status !== 'extracting_continued')) {
    console.log(`[continue-extraction] Skipping — pipeline already in status: ${logRow?.status}`);
    return NextResponse.json({ status: 'skipped', reason: `pipeline status is ${logRow?.status}` });
  }

  // Load state from blob
  let continuationState: ContinuationState;
  try {
    const stateRes = await fetch(blobUrl);
    if (!stateRes.ok) throw new Error(`Blob fetch failed: ${stateRes.status}`);
    continuationState = await stateRes.json();
  } catch (err) {
    console.error(`[continue-extraction] Failed to load state from blob:`, err);
    return NextResponse.json({ error: 'Failed to load continuation state' }, { status: 500 });
  }

  // Check max attempts
  if (attempt >= MAX_CONTINUATION_ATTEMPTS) {
    console.log(`[continue-extraction] Max attempts reached (${MAX_CONTINUATION_ATTEMPTS}), finalizing with best output`);
    await finishWithBestOutput(continuationState, pipelineLogId);
    await del(blobUrl);
    return NextResponse.json({ status: 'completed', reason: 'max_attempts_reached' });
  }

  // Load skill & schema for agent
  const skill = await getSkill(skillId);
  if (!skill) {
    console.error(`[continue-extraction] Skill not found: ${skillId}`);
    return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
  }

  const scopedFieldDefs = await getSkillFieldDefinitionsScoped(skillId);
  const schemaFields: SchemaFieldDef[] = [];
  for (const [scope, fields] of scopedFieldDefs.entries()) {
    for (const f of fields) {
      schemaFields.push({
        name: f.name,
        scope,
        type: f.type,
        description: f.description,
        extractionHint: f.disambiguationRules ?? null,
        required: f.required,
      });
    }
  }

  const contextHints = skill.extractionHints || undefined;

  // Resume agent with existing state
  const agentResult = await runExtractionAgent({
    skillId,
    schemaFields,
    pages: [], // Sandbox still has /tmp/source_text.txt
    inputFiles: [], // Sandbox filesystem is intact
    startedAt: Date.now(),
    maxDurationMs: 420_000,
    pipelineLogId,
    contextHints,
    existingSandboxId: continuationState.sandboxId,
    continuationCount: continuationState.continuationCount,
    // resumeState passes through deserializeResumeState() which converts string[] -> Set<string>
    resumeState: {
      messages: continuationState.messages,
      bestSnapshot: continuationState.bestSnapshot,
      iterationHistory: continuationState.iterationHistory,
      totalInputTokens: continuationState.totalInputTokens,
      totalOutputTokens: continuationState.totalOutputTokens,
      totalToolCalls: continuationState.totalToolCalls,
      activityLog: continuationState.activityLog,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });

  if (agentResult.needsContinuation && agentResult.continuationState) {
    // Save updated state and schedule another continuation
    const nextAttempt = agentResult.continuationState.attempt;
    const newBlobKey = `extraction-state/${pipelineLogId}/${nextAttempt}.json`;
    const { url: newBlobUrl } = await put(newBlobKey, JSON.stringify(agentResult.continuationState), {
      access: 'public',
      addRandomSuffix: false,
    });
    console.log(`[continue-extraction] Agent needs more time, scheduling attempt ${nextAttempt}`);

    const baseUrl = getBaseUrl();

    await publishExtractionContinuation(baseUrl, {
      continuation: true,
      pipelineLogId,
      skillId,
      blobUrl: newBlobUrl,
      attempt: nextAttempt,
    });

    // Clean up old blob
    await del(blobUrl).catch(() => {});

    return NextResponse.json({ status: 'continued', attempt: nextAttempt });
  }

  // Agent finished — run the full pipeline
  console.log(
    `[continue-extraction] Agent completed: ${Object.keys(agentResult.fields).length} fields, ` +
    `${agentResult.records.length} records, score=${agentResult.compositeScore}%`,
  );

  await runPostExtractionPipeline(agentResult, pipelineLogId, skillId, logRow.org_id, logRow.project_id);

  // Cleanup
  await del(blobUrl).catch(() => {});

  return NextResponse.json({
    status: 'completed',
    fields: Object.keys(agentResult.fields).length,
    records: agentResult.records.length,
    compositeScore: agentResult.compositeScore,
  });
}

async function finishWithBestOutput(
  state: ContinuationState,
  pipelineLogId: string,
) {
  const sb = getSupabase();

  if (state.bestSnapshot?.outputRaw) {
    console.log(`[continue-extraction] Using bestSnapshot (score=${state.bestSnapshot.compositeScore}%) as final output`);
  }

  await sb.from('pipeline_log').update({
    status: 'completed',
    processing_note: `Extraction completed after max attempts. Best score: ${state.bestSnapshot?.compositeScore ?? 0}%`,
    agent_composite_score: state.bestSnapshot?.compositeScore ?? null,
    agent_best_output: state.bestSnapshot?.outputRaw ?? state.lastOutputRaw ?? null,
    agent_best_script: state.bestSnapshot?.script ?? state.lastScript ?? null,
    agent_rounds: state.activityLog.filter(e => e.type === 'reasoning').length,
    agent_tool_calls: state.totalToolCalls,
  }).eq('id', pipelineLogId);
}

async function runPostExtractionPipeline(
  agentResult: { fields: Record<string, { value: unknown; confidence: number }>; records: Array<Record<string, unknown>>; secondaryTables: Record<string, Array<Record<string, unknown>>>; compositeScore: number; script: string; agentToolCalls: number },
  pipelineLogId: string,
  skillId: string,
  orgId: string,
  projectId: string | null,
) {
  const sb = getSupabase();

  type FieldsMap = Record<string, { value: string | number | null; confidence: number }>;
  type RecordRow = Record<string, { value: string | number | null; confidence: number }>;

  const fields: FieldsMap = {};
  for (const [k, v] of Object.entries(agentResult.fields)) {
    fields[k] = {
      value: v.value == null ? null : (typeof v.value === 'number' || typeof v.value === 'string' ? v.value : String(v.value)),
      confidence: v.confidence,
    };
  }

  const collections: Record<string, RecordRow[]> = {};
  if (agentResult.records.length > 0) {
    const scopedFieldDefs = await getSkillFieldDefinitionsScoped(skillId);
    const scopes = [...scopedFieldDefs.keys()].filter(s => s !== 'doc');
    const primaryScope = scopes[0] ?? 'records';
    collections[primaryScope] = agentResult.records.map(r => {
      const row: RecordRow = {};
      for (const [k, v] of Object.entries(r)) {
        row[k] = { value: v == null ? null : (typeof v === 'number' || typeof v === 'string' ? v : String(v)), confidence: 1.0 };
      }
      return row;
    });
  }
  for (const [scope, rows] of Object.entries(agentResult.secondaryTables)) {
    collections[scope] = rows.map(r => {
      const row: RecordRow = {};
      for (const [k, v] of Object.entries(r)) {
        row[k] = { value: v == null ? null : (typeof v === 'number' || typeof v === 'string' ? v : String(v)), confidence: 1.0 };
      }
      return row;
    });
  }

  try {
    const pipeResult = await runSkillPipeline(
      pipelineLogId,
      projectId || '',
      orgId,
      skillId,
      { fields, collections },
      {
        agentMeta: {
          parser_type: 'agent',
          confirmed_absent: [],
          agent_tool_calls: agentResult.agentToolCalls,
          composite_score: agentResult.compositeScore,
        },
      },
    );
    console.log(
      `[continue-extraction] Skill pipeline complete: rows=${pipeResult.rowCount} ` +
      `identity=${pipeResult.identityScore}% quality=${pipeResult.qualityScore}%`,
    );
  } catch (err) {
    console.error(`[continue-extraction] Skill pipeline failed:`, err);
    await sb.from('pipeline_log').update({
      status: 'pipeline_failed',
      processing_note: `Pipeline failed after extraction: ${err instanceof Error ? err.message : String(err)}`,
    }).eq('id', pipelineLogId);
  }
}
