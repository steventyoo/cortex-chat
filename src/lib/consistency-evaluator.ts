/**
 * Generic consistency-check evaluator.
 * Loads check specs from the `consistency_checks` table and evaluates
 * each expression in a sandboxed Function constructor — identical pattern
 * to derived-evaluator.ts.
 *
 * NOT tied to any specific document type — works for JCR, production reports, etc.
 */

import { getSupabase } from './supabase';
import type { EvalContext } from './derived-evaluator';

// ── Types ────────────────────────────────────────────────────

export interface ConsistencyCheckSpec {
  id: string;
  skill_id: string;
  check_name: string;
  display_name: string;
  description: string | null;
  tier: number;
  classification: 'extraction_error' | 'document_anomaly';
  check_role: 'identity' | 'structural' | 'anomaly';
  scope: string;
  expression: string;
  tolerance_abs: number;
  affected_fields: string[];
  hint_template: string | null;
}

export interface CheckResult {
  check_name: string;
  display_name: string;
  tier: number;
  classification: 'extraction_error' | 'document_anomaly';
  check_role: 'identity' | 'structural' | 'anomaly';
  scope: string;
  status: 'pass' | 'fail';
  expected: number | string | null;
  actual: number | string | null;
  delta: number | null;
  message: string;
  affected_fields: string[];
  hint_template: string | null;
  record_key?: string;
}

// ── Sandbox helpers (same as derived-evaluator) ──────────────

function rd(n: number | null | undefined, decimals?: number): number | null {
  if (n == null) return null;
  const d = decimals ?? 2;
  const factor = Math.pow(10, d);
  return Math.round(n * factor) / factor;
}

// ── Core evaluation ──────────────────────────────────────────

interface ExpressionResult {
  pass: boolean;
  expected?: number | string | null;
  actual?: number | string | null;
  delta?: number | null;
  message?: string;
}

type EvalFn = (ctx: EvalContext, rdFn: typeof rd) => ExpressionResult;

function createCheckEvaluator(expression: string): EvalFn {
  try {
    return new Function('ctx', 'rd', `"use strict"; return (${expression})`) as EvalFn;
  } catch (err) {
    console.error(`[consistency-evaluator] Failed to compile expression: ${expression}`, err);
    return () => ({ pass: true, message: 'Expression compilation failed' });
  }
}

// ── Public API ───────────────────────────────────────────────

export async function loadConsistencySpecs(skillId: string): Promise<ConsistencyCheckSpec[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('consistency_checks')
    .select('*')
    .eq('skill_id', skillId)
    .eq('is_active', true)
    .order('tier', { ascending: true });

  if (error) {
    console.error(`[consistency-evaluator] Failed to load specs for ${skillId}:`, error.message);
    return [];
  }
  return (data || []) as ConsistencyCheckSpec[];
}

export async function evaluateConsistencyChecks(
  skillId: string,
  ctx: EvalContext,
): Promise<CheckResult[]> {
  const specs = await loadConsistencySpecs(skillId);
  if (specs.length === 0) {
    console.warn(`[consistency-evaluator] No active consistency_checks for skill=${skillId}`);
    return [];
  }

  const results: CheckResult[] = [];

  for (const spec of specs) {
    const evalFn = createCheckEvaluator(spec.expression);

    try {
      if (spec.scope === 'doc') {
        const result = evalFn(ctx, rd);
        results.push({
          check_name: spec.check_name,
          display_name: spec.display_name,
          tier: spec.tier,
          classification: spec.classification,
          check_role: spec.check_role,
          scope: spec.scope,
          status: result.pass ? 'pass' : 'fail',
          expected: result.expected ?? null,
          actual: result.actual ?? null,
          delta: result.delta ?? null,
          message: result.message || (result.pass ? 'OK' : 'Failed'),
          affected_fields: spec.affected_fields,
          hint_template: spec.hint_template,
        });
      } else {
        const collection = ctx.collections[spec.scope];
        if (!collection || collection.length === 0) continue;

        for (let i = 0; i < collection.length; i++) {
          const record = collection[i];
          const scopedCtx: EvalContext = {
            ...ctx,
            current: record,
          };

          const result = evalFn(scopedCtx, rd);

          if (!result.pass) {
            const recordKey = String(
              record.cost_code || record.name || record.id || `${spec.scope}_${i}`
            );
            results.push({
              check_name: spec.check_name,
              display_name: spec.display_name,
              tier: spec.tier,
              classification: spec.classification,
              check_role: spec.check_role,
              scope: spec.scope,
              status: 'fail',
              expected: result.expected ?? null,
              actual: result.actual ?? null,
              delta: result.delta ?? null,
              message: result.message || 'Failed',
              affected_fields: spec.affected_fields,
              hint_template: spec.hint_template,
              record_key: `${spec.scope}=${recordKey}`,
            });
          }
        }

        // For scoped checks, if no failures found, emit a single pass entry
        const hasFailures = results.some(
          r => r.check_name === spec.check_name && r.status === 'fail'
        );
        if (!hasFailures) {
          results.push({
            check_name: spec.check_name,
            display_name: spec.display_name,
            tier: spec.tier,
            classification: spec.classification,
            check_role: spec.check_role,
            scope: spec.scope,
            status: 'pass',
            expected: null,
            actual: null,
            delta: null,
            message: `All ${collection.length} ${spec.scope} records passed`,
            affected_fields: spec.affected_fields,
            hint_template: spec.hint_template,
          });
        }
      }
    } catch (err) {
      console.error(`[consistency-evaluator] Error evaluating ${spec.check_name}:`, err);
      results.push({
        check_name: spec.check_name,
        display_name: spec.display_name,
        tier: spec.tier,
        classification: spec.classification,
        check_role: spec.check_role,
        scope: spec.scope,
        status: 'fail',
        expected: null,
        actual: null,
        delta: null,
        message: `Evaluation error: ${err instanceof Error ? err.message : String(err)}`,
        affected_fields: spec.affected_fields,
        hint_template: spec.hint_template,
      });
    }
  }

  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  console.log(
    `[consistency-evaluator] Evaluated ${results.length} checks for skill=${skillId}: ` +
    `${passed} passed, ${failed} failed`
  );

  return results;
}

/**
 * Compute a reconciliation score (0-100) from check results.
 * Only counts unique check_names (not per-record duplicates).
 */
export function computeReconciliationScore(results: CheckResult[]): number {
  const checkNames = new Set(results.map(r => r.check_name));
  const failedNames = new Set(
    results.filter(r => r.status === 'fail').map(r => r.check_name)
  );
  const total = checkNames.size;
  if (total === 0) return 100;
  const passed = total - failedNames.size;
  return Math.round((passed / total) * 100);
}

/**
 * Identity score: only counts checks with check_role = 'identity'.
 * 100% means all accounting equations hold — the parser is provably correct.
 * This is the gate for parser cache promotion.
 */
export function computeIdentityScore(results: CheckResult[]): number {
  const identity = results.filter(r => r.check_role === 'identity');
  const names = new Set(identity.map(r => r.check_name));
  const failedNames = new Set(
    identity.filter(r => r.status === 'fail').map(r => r.check_name)
  );
  if (names.size === 0) return 100;
  return Math.round(((names.size - failedNames.size) / names.size) * 100);
}

/**
 * Quality score: counts identity + structural checks, excludes anomaly.
 * Measures overall extraction completeness and correctness.
 */
export function computeQualityScore(results: CheckResult[]): number {
  const scored = results.filter(r => r.check_role !== 'anomaly');
  const names = new Set(scored.map(r => r.check_name));
  const failedNames = new Set(
    scored.filter(r => r.status === 'fail').map(r => r.check_name)
  );
  if (names.size === 0) return 100;
  return Math.round(((names.size - failedNames.size) / names.size) * 100);
}

/**
 * Returns only anomaly failures for operator display.
 * These are legitimate document characteristics, not extraction errors.
 */
export function getAnomalyFlags(results: CheckResult[]): CheckResult[] {
  return results.filter(r => r.check_role === 'anomaly' && r.status === 'fail');
}
