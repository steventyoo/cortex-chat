/**
 * Format fingerprinting — identifies the structural template of a document.
 *
 * Two-layer approach:
 * 1. FAST structural hash (~10ms, free): hashes the column layout geometry
 *    from page 1 of the PDF (text positions, font sizes, page dimensions).
 *    Same software = same column layout = same hash. Used as the cache key.
 *
 * 2. LLM label (once per new format, ~$0.001): on cache miss, asks Haiku
 *    to identify the software from page 1's text. Stored as a human-readable
 *    label ("sage_300_cre") alongside the parser for operator visibility.
 *
 * No hardcoded provider names. Works for any software automatically.
 */

import { createHash } from 'crypto';
import { getDocumentProxy } from 'unpdf';
import Anthropic from '@anthropic-ai/sdk';

export interface FingerprintResult {
  /** Stable hash for cache key lookup (e.g. "fp_b6a81b0aefa7") */
  hash: string;
  /** Human-readable label from LLM (e.g. "sage_300_cre"). Only set on cache miss. */
  label?: string;
}

export interface FingerprintOptions {
  /** If true, call Haiku to generate a human-readable label. Default false. */
  identifyWithLlm?: boolean;
  /** Pre-extracted text from the document (used for LLM context and non-PDF fallback) */
  sourceText?: string;
}

// ── Public API ──────────────────────────────────────────────

/**
 * Generate a structural fingerprint for the document.
 *
 * For PDFs: hashes the layout geometry of the first 20 text items on page 1.
 * For non-PDFs: hashes the line-length pattern of the first 50 lines.
 */
export async function fingerprintDocument(
  sourceText: string,
  skillId: string,
  pdfBuffer?: Uint8Array,
  options?: FingerprintOptions,
): Promise<FingerprintResult> {
  let hash: string;

  if (pdfBuffer && pdfBuffer.length > 0) {
    try {
      hash = await structuralHashFromPdf(pdfBuffer, skillId);
    } catch (err) {
      console.warn('[fingerprint] PDF layout extraction failed, falling back to text:', err);
      hash = structuralHashFromText(sourceText, skillId);
    }
  } else {
    hash = structuralHashFromText(sourceText, skillId);
  }

  let label: string | undefined;
  if (options?.identifyWithLlm) {
    try {
      const text = options.sourceText ?? sourceText;
      label = await identifyFormatWithLlm(text.slice(0, 3000));
    } catch (err) {
      console.warn('[fingerprint] LLM identification failed (non-fatal):', err);
    }
  }

  return { hash, label };
}

// ── Layer 1: Structural hash (free, instant) ────────────────

const HEADER_ITEMS = 20;
const GRID = 5;
const round = (n: number) => Math.round(n / GRID) * GRID;

/**
 * Hash the layout geometry of page 1's header area.
 * Only considers the first 20 non-empty text items — these are
 * the report title and column headers, which are structurally
 * identical across documents from the same software.
 */
async function structuralHashFromPdf(
  pdfBuffer: Uint8Array,
  skillId: string,
): Promise<string> {
  const doc = await getDocumentProxy(pdfBuffer);
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1.0 });
  const textContent = await page.getTextContent();

  const pageW = round(viewport.width);
  const pageH = round(viewport.height);

  const positions: string[] = [];
  let count = 0;

  for (const item of textContent.items) {
    if (!('str' in item) || !item.str?.trim()) continue;
    if (++count > HEADER_ITEMS) break;
    const tx = item.transform;
    if (!tx) continue;
    positions.push(`${round(tx[4])},${round(tx[5])},${round(Math.abs(tx[0]))}`);
  }

  const uniquePositions = [...new Set(positions)].sort();
  const raw = `${skillId}|${pageW}x${pageH}|${uniquePositions.join('|')}`;
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 12);
  return `fp_${hash}`;
}

/**
 * Fallback for non-PDF documents: hash the line-structure pattern.
 * Uses line lengths and character composition, not content.
 */
function structuralHashFromText(sourceText: string, skillId: string): string {
  const lines = sourceText.split('\n').slice(0, 50);

  const structure = lines.map(line => {
    const t = line.trim();
    if (t.length === 0) return 'E';
    const len = t.length < 10 ? 'S' : t.length < 40 ? 'M' : t.length < 80 ? 'L' : 'X';
    const alpha = (t.match(/[a-zA-Z]/g) || []).length / t.length;
    const type = alpha > 0.6 ? 'A' : alpha < 0.3 ? 'N' : 'M';
    return `${len}${type}`;
  }).join('');

  const raw = `${skillId}|text|${structure}`;
  return `fp_${createHash('sha256').update(raw).digest('hex').slice(0, 12)}`;
}

// ── Layer 2: LLM identification (cheap, once per new format) ─

const FORMAT_ID_PROMPT = `You are identifying the software that generated a construction document.

Given the first page of text from a document, identify the accounting/project management software that produced it.

Return ONLY a short snake_case identifier. Examples:
- sage_300_cre
- sage_100_contractor  
- viewpoint_vista
- procore
- cmic_spectrum
- foundation_software
- computerease
- buildertrend
- aia_standard_form

If you cannot identify the software, return "unknown".

Return ONLY the identifier, nothing else.`;

async function identifyFormatWithLlm(headerText: string): Promise<string> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 50,
    messages: [
      { role: 'user', content: `${FORMAT_ID_PROMPT}\n\n--- DOCUMENT TEXT ---\n${headerText}` },
    ],
  });

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
  const label = text.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 50);

  console.log(`[fingerprint] LLM identified format: "${label}"`);
  return label || 'unknown';
}
