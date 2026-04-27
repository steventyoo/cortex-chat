import { createHash } from 'crypto';
import { getSupabase } from '../supabase';
import type { PromoteParserInput } from '../schemas/parser-cache.schema';

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex').slice(0, 40);
}

/**
 * Get the best active cached parser for a (skill_id, format_fingerprint).
 * Prefers highest validated_count (most battle-tested).
 */
export async function getActiveParser(skillId: string, formatFingerprint: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('parser_cache')
    .select('*')
    .eq('skill_id', skillId)
    .eq('format_fingerprint', formatFingerprint)
    .eq('is_active', true)
    .order('validated_count', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[parser-cache] Lookup failed:', error.message);
    return null;
  }
  return data;
}

/**
 * Promote a parser to the cache after it achieves 100% identity score.
 * Uses parser_hash to avoid storing duplicate code.
 */
export async function promoteParser(input: PromoteParserInput) {
  const sb = getSupabase();
  const parserHash = hashCode(input.parser_code);

  const { data: existing } = await sb
    .from('parser_cache')
    .select('id, validated_count')
    .eq('skill_id', input.skill_id)
    .eq('format_fingerprint', input.format_fingerprint)
    .eq('parser_hash', parserHash)
    .maybeSingle();

  if (existing) {
    await sb
      .from('parser_cache')
      .update({
        validated_count: existing.validated_count + 1,
        last_validated_at: new Date().toISOString(),
        identity_score: input.identity_score,
        quality_score: input.quality_score ?? null,
      })
      .eq('id', existing.id);
    console.log(`[parser-cache] Existing parser updated: validated_count=${existing.validated_count + 1}`);
    return existing.id;
  }

  const { data, error } = await sb
    .from('parser_cache')
    .insert({
      skill_id: input.skill_id,
      format_fingerprint: input.format_fingerprint,
      parser_code: input.parser_code,
      parser_hash: parserHash,
      identity_score: input.identity_score,
      quality_score: input.quality_score ?? null,
      checks_passed: input.checks_passed,
      checks_total: input.checks_total,
      promoted_from: input.promoted_from ?? null,
      meta: input.meta ?? {},
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      console.log('[parser-cache] Parser already cached (concurrent insert)');
      return null;
    }
    console.error('[parser-cache] Promotion failed:', error.message);
    return null;
  }

  console.log(`[parser-cache] New parser cached: skill=${input.skill_id} format=${input.format_fingerprint}`);
  return data?.id ?? null;
}

/**
 * Increment validated_count after a cached parser succeeds on another document.
 */
export async function incrementValidated(parserId: string) {
  const sb = getSupabase();
  const { data } = await sb
    .from('parser_cache')
    .select('validated_count')
    .eq('id', parserId)
    .single();

  const newCount = (data?.validated_count ?? 0) + 1;
  const { error } = await sb
    .from('parser_cache')
    .update({
      validated_count: newCount,
      last_validated_at: new Date().toISOString(),
      failure_count: 0,
    })
    .eq('id', parserId);

  if (error) {
    console.error('[parser-cache] Increment failed:', error.message);
  }
}

/**
 * Record a failure for a cached parser. Deactivates after 3 consecutive failures.
 */
export async function recordCacheFailure(parserId: string) {
  const sb = getSupabase();
  const { data } = await sb
    .from('parser_cache')
    .select('failure_count')
    .eq('id', parserId)
    .single();

  const newCount = (data?.failure_count ?? 0) + 1;
  const deactivate = newCount >= 3;

  await sb
    .from('parser_cache')
    .update({
      failure_count: newCount,
      ...(deactivate ? { is_active: false } : {}),
    })
    .eq('id', parserId);

  if (deactivate) {
    console.warn(`[parser-cache] Parser ${parserId} deactivated after ${newCount} consecutive failures`);
  }
}

/**
 * Get the most recent deactivated parser for a (skill_id, format_fingerprint).
 * Used to supply reference code when regenerating an improved parser.
 */
export async function getDeactivatedParser(skillId: string, formatFingerprint: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('parser_cache')
    .select('*')
    .eq('skill_id', skillId)
    .eq('format_fingerprint', formatFingerprint)
    .eq('is_active', false)
    .order('last_validated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[parser-cache] Deactivated lookup failed:', error.message);
    return null;
  }
  return data;
}

/**
 * Store quality gap information on a parser cache entry's meta field.
 */
export async function updateParserQualityGaps(parserId: string, qualityGaps: QualityGap[]) {
  const sb = getSupabase();
  const { error } = await sb
    .from('parser_cache')
    .update({
      meta: { quality_gaps: qualityGaps },
    })
    .eq('id', parserId);
  if (error) console.error('[parser-cache] Quality gaps update failed:', error.message);
}

export interface GapEvidence {
  record_identifier: string;
  document_excerpt: string;
  extracted_value: string | number | null;
  expected_hint: string;
}

export interface QualityGap {
  scope: string;
  field: string;
  null_pct: number;
  type: 'missing_doc_field' | 'sparse_collection_field';
  description?: string;
  field_type?: string;
  evidence?: GapEvidence[];
}

/**
 * List all cached parsers, optionally filtered by skill_id.
 */
export async function listCachedParsers(skillId?: string) {
  const sb = getSupabase();
  let query = sb.from('parser_cache').select('*').order('created_at', { ascending: false });
  if (skillId) query = query.eq('skill_id', skillId);
  const { data, error } = await query;
  if (error) {
    console.error('[parser-cache] List failed:', error.message);
    return [];
  }
  return data ?? [];
}

/**
 * Toggle a cached parser's is_active status.
 */
export async function toggleParserActive(parserId: string, isActive: boolean) {
  const sb = getSupabase();
  const { error } = await sb
    .from('parser_cache')
    .update({ is_active: isActive, failure_count: 0 })
    .eq('id', parserId);
  if (error) console.error('[parser-cache] Toggle failed:', error.message);
}

/**
 * Replace a cached parser's code (e.g. after appending a gap-fill function).
 * Recomputes parser_hash and resets failure_count.
 */
export async function updateParserCode(
  parserId: string,
  newCode: string,
  opts?: { quality_score?: number; meta?: Record<string, unknown> },
) {
  const sb = getSupabase();
  const newHash = hashCode(newCode);
  const { error } = await sb
    .from('parser_cache')
    .update({
      parser_code: newCode,
      parser_hash: newHash,
      failure_count: 0,
      last_validated_at: new Date().toISOString(),
      ...(opts?.quality_score != null ? { quality_score: opts.quality_score } : {}),
      ...(opts?.meta ? { meta: opts.meta } : {}),
    })
    .eq('id', parserId);
  if (error) {
    console.error('[parser-cache] Code update failed:', error.message);
    return false;
  }
  console.log(`[parser-cache] Parser code updated: id=${parserId} hash=${newHash.slice(0, 12)} len=${newCode.length}`);
  return true;
}
