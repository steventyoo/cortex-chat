import OpenAI from 'openai';
import { getSupabase } from './supabase';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getOpenAI();
  const input = text.slice(0, 8000);

  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  return response.data[0].embedding;
}

export function buildEmbeddingText(opts: {
  documentType: string;
  fields: Record<string, unknown>;
  rawText?: string;
}): string {
  const parts: string[] = [];

  parts.push(`Document type: ${opts.documentType}`);

  for (const [key, val] of Object.entries(opts.fields)) {
    if (val && typeof val === 'object' && 'value' in (val as Record<string, unknown>)) {
      const v = (val as { value: unknown }).value;
      if (v != null) parts.push(`${key}: ${v}`);
    } else if (val != null) {
      parts.push(`${key}: ${val}`);
    }
  }

  if (opts.rawText) {
    parts.push('---');
    parts.push(opts.rawText.slice(0, 4000));
  }

  return parts.join('\n');
}

export async function embedAndStoreForRecord(
  recordId: string,
  documentType: string,
  fields: Record<string, unknown>,
  rawText?: string
): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('OPENAI_API_KEY not set, skipping embedding generation');
    return;
  }

  try {
    const text = buildEmbeddingText({ documentType, fields, rawText });
    const embedding = await generateEmbedding(text);

    const sb = getSupabase();
    const embeddingStr = `[${embedding.join(',')}]`;

    const { error } = await sb
      .from('extracted_records')
      .update({ embedding: embeddingStr })
      .eq('id', recordId);

    if (error) {
      console.error('Failed to store embedding:', error.message);
    }
  } catch (err) {
    console.error('Embedding generation failed:', err);
  }
}

export async function searchByEmbedding(opts: {
  query: string;
  projectId?: string;
  orgId?: string;
  skillId?: string;
  matchCount?: number;
  matchThreshold?: number;
  includePending?: boolean;
}): Promise<Array<{
  id: string;
  skill_id: string;
  document_type: string;
  fields: Record<string, unknown>;
  similarity: number;
  project_id: string;
}>> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('OPENAI_API_KEY not set, cannot perform vector search');
    return [];
  }

  const queryEmbedding = await generateEmbedding(opts.query);
  const sb = getSupabase();

  const { data, error } = await sb.rpc('match_extracted_records', {
    query_embedding: `[${queryEmbedding.join(',')}]`,
    match_count: opts.matchCount || 20,
    match_threshold: opts.matchThreshold || 0.3,
    filter_project_id: opts.projectId || null,
    filter_org_id: opts.orgId || null,
    filter_skill_id: opts.skillId || null,
    include_pending: opts.includePending || false,
  });

  if (error) {
    console.error('Vector search failed:', error.message);
    return [];
  }

  return data || [];
}
