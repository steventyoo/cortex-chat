/**
 * Knowledge document chunking, embedding, and retrieval.
 *
 * Reference documents (textbooks, manuals, specs) are uploaded by operators,
 * chunked into ~1000-token segments, embedded via OpenAI, and stored in
 * knowledge_chunks for retrieval during extraction prompts.
 */

import { getSupabase } from './supabase';
import { generateEmbedding } from './embeddings';

const CHUNK_SIZE = 4000;    // ~1000 tokens at ~4 chars/token
const CHUNK_OVERLAP = 800;  // ~200 tokens overlap

export interface KnowledgeDocument {
  id: string;
  orgId: string;
  title: string;
  fileName: string;
  storagePath: string;
  mimeType: string;
  extractedText: string | null;
  chunkCount: number;
  uploadedBy: string | null;
  createdAt: string;
}

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  similarity?: number;
}

/**
 * Split text into overlapping chunks for embedding.
 * Tries to break at paragraph/sentence boundaries.
 */
export function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + CHUNK_SIZE, text.length);

    if (end < text.length) {
      const slice = text.slice(start, end);
      const paragraphBreak = slice.lastIndexOf('\n\n');
      if (paragraphBreak > CHUNK_SIZE * 0.5) {
        end = start + paragraphBreak + 2;
      } else {
        const sentenceBreak = slice.lastIndexOf('. ');
        if (sentenceBreak > CHUNK_SIZE * 0.3) {
          end = start + sentenceBreak + 2;
        }
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = end - CHUNK_OVERLAP;
    if (start < 0) start = 0;
    if (end >= text.length) break;
  }

  return chunks.filter(c => c.length > 0);
}

/**
 * Store chunks and generate embeddings for a knowledge document.
 */
export async function chunkAndEmbedDocument(
  documentId: string,
  text: string
): Promise<number> {
  const sb = getSupabase();
  const chunks = chunkText(text);

  // Delete any existing chunks for re-processing
  await sb.from('knowledge_chunks').delete().eq('document_id', documentId);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    let embeddingStr: string | null = null;
    try {
      if (process.env.OPENAI_API_KEY) {
        const embedding = await generateEmbedding(chunk);
        embeddingStr = `[${embedding.join(',')}]`;
      }
    } catch (err) {
      console.error(`[knowledge] Failed to embed chunk ${i} of doc ${documentId}:`, err);
    }

    const { error } = await sb.from('knowledge_chunks').insert({
      document_id: documentId,
      chunk_index: i,
      content: chunk,
      embedding: embeddingStr,
    });

    if (error) {
      console.error(`[knowledge] Failed to insert chunk ${i}:`, error.message);
    }
  }

  // Update document metadata
  await sb.from('knowledge_documents').update({
    extracted_text: text.slice(0, 500000),
    chunk_count: chunks.length,
  }).eq('id', documentId);

  console.log(`[knowledge] Chunked and embedded doc ${documentId}: ${chunks.length} chunks`);
  return chunks.length;
}

/**
 * Retrieve relevant knowledge chunks for a given query, scoped to specific document IDs.
 */
export async function retrieveKnowledgeChunks(
  query: string,
  documentIds: string[],
  maxChunks = 5,
  threshold = 0.3
): Promise<KnowledgeChunk[]> {
  if (!process.env.OPENAI_API_KEY || documentIds.length === 0) return [];

  try {
    const queryEmbedding = await generateEmbedding(query);
    const sb = getSupabase();

    const { data, error } = await sb.rpc('match_knowledge_chunks', {
      query_embedding: `[${queryEmbedding.join(',')}]`,
      match_count: maxChunks,
      match_threshold: threshold,
      filter_document_ids: documentIds,
    });

    if (error) {
      console.error('[knowledge] Retrieval failed:', error.message);
      return [];
    }

    return (data || []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      documentId: String(row.document_id),
      chunkIndex: Number(row.chunk_index),
      content: String(row.content),
      similarity: Number(row.similarity),
    }));
  } catch (err) {
    console.error('[knowledge] Retrieval error:', err);
    return [];
  }
}

/**
 * List all knowledge documents for an org.
 */
export async function listKnowledgeDocuments(orgId: string): Promise<KnowledgeDocument[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('knowledge_documents')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[knowledge] List failed:', error.message);
    return [];
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    orgId: String(row.org_id),
    title: String(row.title),
    fileName: String(row.file_name),
    storagePath: String(row.storage_path),
    mimeType: String(row.mime_type),
    extractedText: row.extracted_text ? String(row.extracted_text) : null,
    chunkCount: Number(row.chunk_count || 0),
    uploadedBy: row.uploaded_by ? String(row.uploaded_by) : null,
    createdAt: String(row.created_at),
  }));
}
