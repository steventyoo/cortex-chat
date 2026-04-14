/**
 * JCR-anchored coverage analysis.
 *
 * Parses every cost-code line item from the Job Cost Report, then uses
 * AI semantic matching to determine which ingested documents provide
 * supporting documentation for each cost code.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getSupabase } from './supabase';

// ── Types ────────────────────────────────────────────────────

export interface JcrLineItem {
  costCode: string;
  description: string;
  costCategory: string | null;
  workPhase: string | null;
  revisedBudget: number | null;
  jtdCost: number | null;
  overUnder: number | null;
  pctConsumed: number | null;
}

export interface CoverageMatch {
  docId: string;
  fileName: string;
  skillId: string;
  matchType: 'cost_code' | 'description';
  matchScore: number;
  matchedValue: string;
}

export interface CostCodeCoverage {
  lineItem: JcrLineItem;
  matches: CoverageMatch[];
  coverageScore: number;
  status: 'covered' | 'partial' | 'missing';
}

export interface CoverageReport {
  jcrId: string;
  jcrFileName: string;
  projectName: string;
  totalBudget: number;
  totalJtdCost: number;
  lineItems: CostCodeCoverage[];
  summary: {
    totalCostCodes: number;
    covered: number;
    partial: number;
    missing: number;
    overallScore: number;
    budgetCovered: number;
    budgetMissing: number;
  };
}

interface PipelineDoc {
  id: string;
  fileName: string;
  skillId: string;
  fields: Record<string, { value: string | number | null; confidence: number }>;
}

// ── Helpers ──────────────────────────────────────────────────

function extractNumber(val: string | number | null | undefined): number | null {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/[$,\s%]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Build a compact summary of a document for the AI prompt.
 * Includes file name, document type, and key extracted fields (capped at 8).
 */
function summarizeDoc(doc: PipelineDoc): string {
  const parts: string[] = [`"${doc.fileName}" (type: ${doc.skillId})`];

  const entries = Object.entries(doc.fields).filter(([, v]) => v.value != null);
  const topFields = entries.slice(0, 8);
  if (topFields.length > 0) {
    const fieldStr = topFields
      .map(([k, v]) => {
        const val = String(v.value);
        return `${k}: ${val.length > 80 ? val.slice(0, 80) + '...' : val}`;
      })
      .join('; ');
    parts.push(fieldStr);
  }

  return parts.join(' | ');
}

// ── AI Matching ──────────────────────────────────────────────

interface AiMatchResult {
  costCode: string;
  docIndices: number[];
  confidence: number;
  reasoning: string;
}

const BATCH_SIZE = 60;

async function aiMatchDocuments(
  lineItems: JcrLineItem[],
  docs: PipelineDoc[],
): Promise<Map<string, CoverageMatch[]>> {
  const result = new Map<string, CoverageMatch[]>();
  for (const li of lineItems) {
    result.set(li.costCode, []);
  }

  if (docs.length === 0) return result;

  const jcrBlock = lineItems
    .map((li, i) => {
      const parts = [`[${i}] Code: ${li.costCode} — ${li.description}`];
      if (li.costCategory) parts.push(`Category: ${li.costCategory}`);
      if (li.revisedBudget != null) parts.push(`Budget: $${li.revisedBudget.toLocaleString()}`);
      return parts.join(' | ');
    })
    .join('\n');

  const chunks: PipelineDoc[][] = [];
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    chunks.push(docs.slice(i, i + BATCH_SIZE));
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  async function processChunk(chunk: PipelineDoc[]): Promise<void> {
    const docBlock = chunk
      .map((doc, i) => `[${i}] ${summarizeDoc(doc)}`)
      .join('\n');

    const systemPrompt = `You are a construction project document analyst. Your job is to determine which project documents provide supporting documentation for specific cost codes in a Job Cost Report (JCR).

The JCR lists budget line items by cost code (e.g., "011 - DS & RD Labor", "220 - Roughin Material"). Project documents (POs, invoices, billing schedules, sub bids, contracts, change orders, etc.) relate to these cost codes through the type of work or materials they describe — NOT through explicit cost code numbers.

For example:
- A PO for "PVC fittings" relates to a plumbing roughin material cost code
- An invoice from an electrician relates to electrical labor/material cost codes
- A billing schedule with drywall line items relates to finish material cost codes
- A daily report mentioning concrete work relates to structural/underground cost codes

Be CONSERVATIVE. Only match a document to a cost code when the document clearly relates to that type of work or expenditure. This analysis is used to identify MISSING documentation — false positives are worse than false negatives.`;

    const userPrompt = `Here are the JCR line items (cost codes):

${jcrBlock}

Here are the project documents:

${docBlock}

For each JCR cost code, identify which documents (if any) provide supporting documentation. A document "supports" a cost code when it describes work, materials, services, or costs that fall under that cost code's category.

Use the tool to report your findings.`;

    try {
      const response = await client.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        tools: [
          {
            name: 'report_coverage_matches',
            description: 'Report which documents match which JCR cost codes.',
            input_schema: {
              type: 'object',
              properties: {
                matches: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      costCode: {
                        type: 'string',
                        description: 'The JCR cost code (e.g., "011", "220").',
                      },
                      docIndices: {
                        type: 'array',
                        items: { type: 'number' },
                        description: 'Indices of matching documents from the document list.',
                      },
                      confidence: {
                        type: 'number',
                        minimum: 0,
                        maximum: 1,
                        description: 'Confidence in the mapping (0-1). Use >= 0.7 for clear matches, 0.4-0.69 for partial/likely matches.',
                      },
                      reasoning: {
                        type: 'string',
                        description: 'Brief explanation of why these documents relate to this cost code.',
                      },
                    },
                    required: ['costCode', 'docIndices', 'confidence', 'reasoning'],
                  },
                },
              },
              required: ['matches'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'report_coverage_matches' },
      });

      const toolBlock = response.content.find(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
      );

      if (!toolBlock) return;

      const payload = toolBlock.input as { matches: AiMatchResult[] };
      if (!payload.matches || !Array.isArray(payload.matches)) return;

      for (const m of payload.matches) {
        if (!m.costCode || !Array.isArray(m.docIndices)) continue;

        const existing = result.get(m.costCode) || [];

        for (const idx of m.docIndices) {
          if (idx < 0 || idx >= chunk.length) continue;
          const doc = chunk[idx];

          if (existing.some(e => e.docId === doc.id)) continue;

          existing.push({
            docId: doc.id,
            fileName: doc.fileName,
            skillId: doc.skillId,
            matchType: m.confidence >= 0.7 ? 'cost_code' : 'description',
            matchScore: m.confidence,
            matchedValue: m.reasoning,
          });
        }

        result.set(m.costCode, existing);
      }
    } catch (err) {
      console.error('[coverage] AI matching failed for batch:', err);
    }
  }

  const CONCURRENCY = 3;
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    await Promise.all(chunks.slice(i, i + CONCURRENCY).map(processChunk));
  }

  return result;
}

// ── Main ─────────────────────────────────────────────────────

export async function runCoverageAnalysis(
  orgId: string,
  projectId?: string | null,
  jcrPipelineId?: string | null
): Promise<CoverageReport | null> {
  const sb = getSupabase();

  // Find the JCR
  let jcrQuery = sb
    .from('pipeline_log')
    .select('id, file_name, extracted_data')
    .eq('org_id', orgId)
    .in('status', ['pending_review', 'tier2_validated', 'pushed'])
    .not('extracted_data', 'is', null);

  if (jcrPipelineId) {
    jcrQuery = jcrQuery.eq('id', jcrPipelineId);
  } else {
    jcrQuery = jcrQuery.eq('extracted_data->>skillId', 'job_cost_report');
  }

  if (projectId) {
    jcrQuery = jcrQuery.eq('project_id', projectId);
  }

  const { data: jcrDocs } = await jcrQuery.limit(10);

  if (!jcrDocs || jcrDocs.length === 0) {
    return null;
  }

  const jcrDoc = jcrDocs.reduce((best, doc) => {
    const ed = doc.extracted_data as { records?: unknown[] } | null;
    const bestEd = best.extracted_data as { records?: unknown[] } | null;
    const docRecords = ed?.records?.length || 0;
    const bestRecords = bestEd?.records?.length || 0;
    return docRecords > bestRecords ? doc : best;
  }, jcrDocs[0]);

  const jcrData = jcrDoc.extracted_data as {
    skillId: string;
    fields: Record<string, { value: string | number | null; confidence: number }>;
    records?: Array<Record<string, { value: string | number | null; confidence: number }>>;
  };

  // Parse JCR header
  const projectName = String(jcrData.fields['Project Name / Description']?.value || 'Unknown');
  let totalBudget = extractNumber(jcrData.fields['Total Revised Budget']?.value) || 0;
  const totalJtdCost = extractNumber(jcrData.fields['Total Job-to-Date Cost']?.value) || 0;

  // Parse JCR line items
  const lineItems: JcrLineItem[] = [];

  if (jcrData.records && jcrData.records.length > 0) {
    for (const rec of jcrData.records) {
      lineItems.push({
        costCode: String(rec['Line Item Number / Cost Code']?.value || ''),
        description: String(rec['Line Item Description']?.value || ''),
        costCategory: rec['Cost Category']?.value ? String(rec['Cost Category'].value) : null,
        workPhase: rec['Work Phase / Activity']?.value ? String(rec['Work Phase / Activity'].value) : null,
        revisedBudget: extractNumber(rec['Revised Budget (line)']?.value),
        jtdCost: extractNumber(rec['Job-to-Date Cost (line)']?.value),
        overUnder: extractNumber(rec['Over/Under Budget — $ (line)']?.value),
        pctConsumed: extractNumber(rec['% Budget Consumed (line)']?.value),
      });
    }
  } else {
    const costCodePattern = /^(.+?)_cost_code$/i;
    const materialPattern = /^(.+?)_material_cost_code$/i;
    const seenCodes = new Set<string>();

    for (const [key, val] of Object.entries(jcrData.fields)) {
      if (val.value == null) continue;

      let match = key.match(materialPattern);
      if (match) {
        const code = String(val.value);
        if (!seenCodes.has(code)) {
          seenCodes.add(code);
          lineItems.push({
            costCode: code,
            description: `${match[1].replace(/_/g, ' ')} Material`,
            costCategory: 'Material',
            workPhase: match[1].replace(/_/g, ' '),
            revisedBudget: null, jtdCost: null, overUnder: null, pctConsumed: null,
          });
        }
        continue;
      }

      match = key.match(costCodePattern);
      if (match) {
        const code = String(val.value);
        if (!seenCodes.has(code)) {
          seenCodes.add(code);
          lineItems.push({
            costCode: code,
            description: `${match[1].replace(/_/g, ' ')} Labor`,
            costCategory: 'Labor',
            workPhase: match[1].replace(/_/g, ' '),
            revisedBudget: null, jtdCost: null, overUnder: null, pctConsumed: null,
          });
        }
      }
    }

    if (jcrData.fields['Line Item Number / Cost Code']?.value) {
      const code = String(jcrData.fields['Line Item Number / Cost Code'].value);
      if (!seenCodes.has(code)) {
        lineItems.push({
          costCode: code,
          description: String(jcrData.fields['Line Item Description']?.value || ''),
          costCategory: jcrData.fields['Cost Category']?.value ? String(jcrData.fields['Cost Category'].value) : null,
          workPhase: jcrData.fields['Work Phase / Activity']?.value ? String(jcrData.fields['Work Phase / Activity'].value) : null,
          revisedBudget: extractNumber(jcrData.fields['Revised Budget (line)']?.value),
          jtdCost: extractNumber(jcrData.fields['Job-to-Date Cost (line)']?.value),
          overUnder: extractNumber(jcrData.fields['Over/Under Budget — $ (line)']?.value),
          pctConsumed: extractNumber(jcrData.fields['% Budget Consumed (line)']?.value),
        });
      }
    }
  }

  if (totalBudget === 0 && lineItems.length > 0) {
    totalBudget = lineItems.reduce((sum, li) => sum + (li.revisedBudget || 0), 0);
  }

  // Fetch all other documents in the org/project
  let docQuery = sb
    .from('pipeline_log')
    .select('id, file_name, extracted_data')
    .eq('org_id', orgId)
    .in('status', ['pending_review', 'tier2_validated', 'pushed'])
    .not('extracted_data', 'is', null)
    .neq('id', jcrDoc.id);

  if (projectId) {
    docQuery = docQuery.eq('project_id', projectId);
  }

  const { data: otherDocs } = await docQuery;

  const docs: PipelineDoc[] = (otherDocs || [])
    .filter((d: Record<string, unknown>) => {
      const ed = d.extracted_data as Record<string, unknown> | null;
      return ed?.fields;
    })
    .map((d: Record<string, unknown>) => {
      const ed = d.extracted_data as Record<string, unknown>;
      return {
        id: d.id as string,
        fileName: d.file_name as string,
        skillId: (ed.skillId as string) || 'unknown',
        fields: (ed.fields || {}) as Record<string, { value: string | number | null; confidence: number }>,
      };
    });

  console.log(`[coverage] AI matching: ${lineItems.length} line items x ${docs.length} documents`);

  // AI-powered semantic matching
  const matchMap = await aiMatchDocuments(lineItems, docs);

  // Build coverage items from AI results
  const coverageItems: CostCodeCoverage[] = [];

  for (const li of lineItems) {
    const matches = matchMap.get(li.costCode) || [];

    matches.sort((a, b) => b.matchScore - a.matchScore);

    const coverageScore = matches.length > 0
      ? Math.max(...matches.map(m => m.matchScore))
      : 0;

    const status: CostCodeCoverage['status'] =
      matches.some(m => m.matchType === 'cost_code') ? 'covered'
      : coverageScore >= 0.4 ? 'partial'
      : 'missing';

    coverageItems.push({ lineItem: li, matches, coverageScore, status });
  }

  // Summary
  const covered = coverageItems.filter(c => c.status === 'covered').length;
  const partial = coverageItems.filter(c => c.status === 'partial').length;
  const missing = coverageItems.filter(c => c.status === 'missing').length;
  const totalCostCodes = coverageItems.length;

  const budgetCovered = coverageItems
    .filter(c => c.status !== 'missing')
    .reduce((sum, c) => sum + (c.lineItem.revisedBudget || 0), 0);
  const budgetMissing = coverageItems
    .filter(c => c.status === 'missing')
    .reduce((sum, c) => sum + (c.lineItem.revisedBudget || 0), 0);

  const overallScore = totalCostCodes > 0
    ? coverageItems.reduce((sum, c) => sum + c.coverageScore, 0) / totalCostCodes
    : 0;

  return {
    jcrId: jcrDoc.id,
    jcrFileName: jcrDoc.file_name,
    projectName,
    totalBudget,
    totalJtdCost,
    lineItems: coverageItems,
    summary: {
      totalCostCodes,
      covered,
      partial,
      missing,
      overallScore: Math.round(overallScore * 100) / 100,
      budgetCovered,
      budgetMissing,
    },
  };
}
