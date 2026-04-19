#!/usr/bin/env tsx
/**
 * Langfuse eval runner for Cortex chat.
 *
 * Sends each question from the eval dataset through the chat API,
 * collects the streamed answer, scores the Langfuse trace, and prints
 * a pass/fail summary.
 *
 * Usage:
 *   npx tsx scripts/run-evals.ts                     # all items (from file)
 *   npx tsx scripts/run-evals.ts --source api         # all items (from API)
 *   npx tsx scripts/run-evals.ts --category Payroll   # one category
 *   npx tsx scripts/run-evals.ts --id fixtures-total  # single item
 *
 * Required env vars (in .env.local or .env):
 *   SESSION_SECRET, LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY
 *
 * Optional:
 *   BASE_URL  – defaults to http://localhost:3000
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', override: true });
dotenv.config({ path: '.env' });

import { SignJWT } from 'jose';
import { EVAL_ITEMS, DATASET_NAME, EvalItem } from '../src/lib/eval-dataset';
import { getLangfuse, scoreChatTrace, EvalScores, shutdownLangfuse } from '../src/lib/langfuse';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const RUN_LABEL = `eval-${new Date().toISOString().slice(0, 19).replace(/[:]/g, '-')}`;

/* ── Fetch items from API ─────────────────────────────────── */

async function fetchItemsFromApi(cookie: string): Promise<EvalItem[]> {
  const res = await fetch(`${BASE_URL}/api/eval-items`, {
    headers: { Cookie: `cortex-session=${cookie}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch eval items from API: HTTP ${res.status}`);
  const data = await res.json();
  const items: EvalItem[] = (data.items || [])
    .filter((it: { is_active: boolean }) => it.is_active)
    .map((it: { id: string; category: string; question: string; project_id: string; expected_answer: string; key_values: Record<string, unknown>; expected_tool: string }) => ({
      id: it.id,
      category: it.category,
      question: it.question,
      projectId: it.project_id,
      expectedAnswer: it.expected_answer,
      keyValues: it.key_values || {},
      expectedTool: it.expected_tool,
    }));
  return items;
}

/* ── Helpers ──────────────────────────────────────────────── */

async function mintSessionToken(): Promise<string> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET not set in .env or .env.local');

  return new SignJWT({
    userId: 'eval-runner',
    orgId: 'org_owp_001',
    email: 'eval@cortex.local',
    name: 'Eval Runner',
    role: 'admin',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));
}

interface ChatResult {
  text: string;
  traceId: string | null;
  toolsUsed: string[];
  error: string | null;
}

async function sendChatQuestion(
  question: string,
  projectId: string,
  cookie: string
): Promise<ChatResult> {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `cortex-session=${cookie}`,
    },
    body: JSON.stringify({
      message: question,
      projectId,
      history: [],
      conversationId: `eval-${Date.now()}`,
    }),
  });

  if (!res.ok) {
    return { text: '', traceId: null, toolsUsed: [], error: `HTTP ${res.status}` };
  }

  const body = await res.text();
  const lines = body.split('\n').filter((l) => l.startsWith('data: '));

  let text = '';
  let traceId: string | null = null;
  const toolsUsed: string[] = [];
  let error: string | null = null;

  for (const line of lines) {
    const json = line.slice(6).trim();
    if (!json) continue;
    try {
      const event = JSON.parse(json);
      if (event.text) text += event.text;
      if (event.traceId) traceId = event.traceId;
      if (event.type === 'tool_call' && event.name) toolsUsed.push(event.name);
      if (event.error) error = event.error;
    } catch {
      // non-JSON line, skip
    }
  }

  return { text, traceId, toolsUsed, error };
}

/* ── Scoring ──────────────────────────────────────────────── */

function numericTolerance(actual: string, expected: number, tolerance = 0.05): boolean {
  const numbers = actual.replace(/[,$%]/g, '').match(/-?\d[\d,.]*\d|-?\d/g);
  if (!numbers) return false;
  return numbers.some((n) => {
    const parsed = parseFloat(n.replace(/,/g, ''));
    if (isNaN(parsed)) return false;
    if (expected === 0) return parsed === 0;
    return Math.abs(parsed - expected) / Math.abs(expected) <= tolerance;
  });
}

function textMatch(actual: string, expected: string): boolean {
  if (!expected) return true; // no expected answer = always pass (placeholder)
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  return norm(actual).includes(norm(expected));
}

function scoreItem(item: EvalItem, result: ChatResult): EvalScores {
  const hasExpectedAnswer = !!item.expectedAnswer;

  let keyValuesMatch = true;
  for (const [, val] of Object.entries(item.keyValues)) {
    if (typeof val === 'number') {
      if (!numericTolerance(result.text, val)) {
        keyValuesMatch = false;
        break;
      }
    }
  }

  const answerMatches = hasExpectedAnswer ? textMatch(result.text, item.expectedAnswer) : true;
  const correctness = !hasExpectedAnswer
    ? (result.text.length > 20 ? 0.5 : 0)
    : ((answerMatches ? 0.5 : 0) + (keyValuesMatch ? 0.5 : 0));

  let toolRouting: EvalScores['tool_routing'] = 'wrong';
  if (result.toolsUsed.includes(item.expectedTool)) {
    toolRouting = 'correct';
  } else if (result.toolsUsed.length > 0) {
    toolRouting = 'partial';
  }

  return {
    correctness,
    tool_routing: toolRouting,
    answer_match: answerMatches && keyValuesMatch,
  };
}

/* ── Dataset sync ─────────────────────────────────────────── */

async function syncDataset(items: EvalItem[]): Promise<void> {
  const lf = getLangfuse();

  try {
    await lf.getDataset(DATASET_NAME);
  } catch {
    await lf.createDataset({ name: DATASET_NAME });
    console.log(`Created Langfuse dataset: ${DATASET_NAME}`);
  }

  for (const item of items) {
    await lf.createDatasetItem({
      datasetName: DATASET_NAME,
      input: { question: item.question, projectId: item.projectId },
      expectedOutput: { answer: item.expectedAnswer, keyValues: item.keyValues },
      metadata: { category: item.category, expectedTool: item.expectedTool },
      id: item.id,
    });
  }
  await lf.flushAsync();
  console.log(`Synced ${items.length} dataset items to Langfuse\n`);
}

/* ── Main ─────────────────────────────────────────────────── */

interface RunResult {
  id: string;
  category: string;
  question: string;
  passed: boolean;
  scores: EvalScores;
  toolsUsed: string[];
  error: string | null;
  hasExpected: boolean;
}

async function main() {
  const args = process.argv.slice(2);
  let categoryFilter: string | null = null;
  let idFilter: string | null = null;
  let source: 'file' | 'api' = 'file';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--category' && args[i + 1]) categoryFilter = args[i + 1];
    if (args[i] === '--id' && args[i + 1]) idFilter = args[i + 1];
    if (args[i] === '--source' && args[i + 1]) source = args[i + 1] as 'file' | 'api';
  }

  const cookie = await mintSessionToken();

  let allItems: EvalItem[];
  if (source === 'api') {
    console.log('Fetching eval items from API...');
    try {
      allItems = await fetchItemsFromApi(cookie);
      console.log(`Loaded ${allItems.length} active items from API`);
    } catch (err) {
      console.warn(`API fetch failed (${err instanceof Error ? err.message : err}), falling back to file`);
      allItems = [...EVAL_ITEMS];
    }
  } else {
    allItems = [...EVAL_ITEMS];
  }

  let items = allItems;
  if (idFilter) items = items.filter((it) => it.id === idFilter);
  if (categoryFilter) items = items.filter((it) => it.category === categoryFilter);

  if (items.length === 0) {
    console.error('No eval items matched the filter. Available IDs:');
    allItems.forEach((it) => console.error(`  ${it.id} (${it.category})`));
    process.exit(1);
  }

  console.log(`\nLangfuse Eval Runner — ${RUN_LABEL}`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`Source: ${source}`);
  console.log(`Items:  ${items.length}\n`);

  await syncDataset(items);

  const lf = getLangfuse();
  const results: RunResult[] = [];

  for (const item of items) {
    const label = `[${item.id}]`;
    const hasExpected = !!item.expectedAnswer || Object.keys(item.keyValues).length > 0;

    process.stdout.write(`${label} "${item.question}" ... `);

    const chatResult = await sendChatQuestion(item.question, item.projectId, cookie);

    if (chatResult.error) {
      console.log(`ERROR: ${chatResult.error}`);
      results.push({
        id: item.id, category: item.category, question: item.question,
        passed: false, scores: { correctness: 0, tool_routing: 'wrong', answer_match: false },
        toolsUsed: chatResult.toolsUsed, error: chatResult.error, hasExpected,
      });
      continue;
    }

    const scores = scoreItem(item, chatResult);

    if (chatResult.traceId) {
      try {
        const dataset = await lf.getDataset(DATASET_NAME);
        const dsItem = dataset.items.find((di: { id?: string }) => di.id === item.id);
        if (dsItem && chatResult.traceId) {
          const trace = lf.trace({ id: chatResult.traceId });
          dsItem.link(trace, RUN_LABEL);
        }
      } catch {
        // dataset item linking is best-effort
      }

      await scoreChatTrace(chatResult.traceId, scores);
    }

    const passed = scores.answer_match && scores.tool_routing === 'correct';
    const status = !hasExpected ? 'SKIP (no expected)' : passed ? 'PASS' : 'FAIL';
    const tools = chatResult.toolsUsed.length > 0 ? chatResult.toolsUsed.join(',') : 'none';
    console.log(`${status}  tools=[${tools}]  correctness=${scores.correctness.toFixed(2)}`);

    results.push({
      id: item.id, category: item.category, question: item.question,
      passed, scores, toolsUsed: chatResult.toolsUsed, error: null, hasExpected,
    });
  }

  /* ── Summary ──────────────────────────────────────────── */
  console.log('\n' + '═'.repeat(60));
  console.log('EVAL SUMMARY');
  console.log('═'.repeat(60));

  const withExpected = results.filter((r) => r.hasExpected);
  const passCount = withExpected.filter((r) => r.passed).length;
  const failCount = withExpected.filter((r) => !r.passed).length;
  const skipCount = results.filter((r) => !r.hasExpected).length;

  const avgCorrectness = withExpected.length > 0
    ? withExpected.reduce((s, r) => s + r.scores.correctness, 0) / withExpected.length
    : 0;

  console.log(`  Total:        ${results.length}`);
  console.log(`  Passed:       ${passCount}`);
  console.log(`  Failed:       ${failCount}`);
  console.log(`  Skipped:      ${skipCount} (no expected answer)`);
  console.log(`  Avg correct:  ${avgCorrectness.toFixed(2)}`);

  const routingCounts = { correct: 0, partial: 0, wrong: 0 };
  for (const r of results) routingCounts[r.scores.tool_routing]++;
  console.log(`  Tool routing: ${routingCounts.correct} correct, ${routingCounts.partial} partial, ${routingCounts.wrong} wrong`);

  if (failCount > 0) {
    console.log('\nFailed items:');
    for (const r of results.filter((r) => r.hasExpected && !r.passed)) {
      console.log(`  - ${r.id}: correctness=${r.scores.correctness.toFixed(2)}, routing=${r.scores.tool_routing}, tools=[${r.toolsUsed.join(',')}]`);
    }
  }

  console.log(`\nRun label: ${RUN_LABEL}`);
  console.log(`View results in Langfuse → Datasets → ${DATASET_NAME}\n`);

  await shutdownLangfuse();
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
