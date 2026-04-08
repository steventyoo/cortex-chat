/**
 * JCR-anchored coverage analysis.
 *
 * Parses every cost-code line item from the Job Cost Report, then cross-references
 * against all other ingested documents to determine which cost codes have
 * supporting documentation and which are missing coverage.
 */

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

function normalizeText(val: string | number | null | undefined): string {
  if (val == null) return '';
  return String(val).toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

function matchCostCode(docFields: Record<string, { value: string | number | null; confidence: number }>, costCode: string): { matched: boolean; field: string; value: string } {
  const normalized = normalizeText(costCode);

  const costCodeAliases = [
    'cost code', 'cost_code', 'line item number', 'line_item_number',
    'item number', 'item_number', 'cost code number', 'account code',
    'budget code', 'job cost code',
  ];

  for (const [key, val] of Object.entries(docFields)) {
    if (val.value == null) continue;
    const keyLower = key.toLowerCase();
    const valNorm = normalizeText(val.value);

    for (const alias of costCodeAliases) {
      if (keyLower.includes(alias) && valNorm === normalized) {
        return { matched: true, field: key, value: String(val.value) };
      }
    }
  }

  return { matched: false, field: '', value: '' };
}

function matchDescription(
  docFields: Record<string, { value: string | number | null; confidence: number }>,
  description: string
): { score: number; field: string; value: string } {
  const descNorm = normalizeText(description);
  if (!descNorm) return { score: 0, field: '', value: '' };

  const descWords = new Set(descNorm.split(/\s+/).filter(w => w.length > 2));
  let bestScore = 0;
  let bestField = '';
  let bestValue = '';

  const descAliases = [
    'description', 'scope', 'item', 'work', 'trade', 'activity',
    'line item', 'name', 'title', 'spec',
  ];

  for (const [key, val] of Object.entries(docFields)) {
    if (val.value == null) continue;
    const keyLower = key.toLowerCase();

    const isDescField = descAliases.some(a => keyLower.includes(a));
    if (!isDescField) continue;

    const valNorm = normalizeText(val.value);
    if (!valNorm) continue;

    const valWords = new Set(valNorm.split(/\s+/).filter(w => w.length > 2));
    const intersection = [...descWords].filter(w => valWords.has(w));
    const union = new Set([...descWords, ...valWords]);

    if (union.size === 0) continue;
    const jaccard = intersection.length / union.size;

    if (jaccard > bestScore) {
      bestScore = jaccard;
      bestField = key;
      bestValue = String(val.value);
    }
  }

  return { score: bestScore, field: bestField, value: bestValue };
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

  // Prefer the JCR that actually has multi-record line items
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

  // Parse JCR line items — from records array or from extra_fields cost codes
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
    // Fallback: extract cost-code-like fields from the flat fields/extra_fields
    // The current JCR was extracted as flat fields with cost code names as keys
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
            revisedBudget: null,
            jtdCost: null,
            overUnder: null,
            pctConsumed: null,
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
            revisedBudget: null,
            jtdCost: null,
            overUnder: null,
            pctConsumed: null,
          });
        }
      }
    }

    // Also add header-level single line item if we have it
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

  // If header total budget wasn't extracted, sum from line items
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

  // Cross-reference each line item against all documents
  const coverageItems: CostCodeCoverage[] = [];

  for (const li of lineItems) {
    const matches: CoverageMatch[] = [];

    for (const doc of docs) {
      const costCodeMatch = matchCostCode(doc.fields, li.costCode);
      if (costCodeMatch.matched) {
        matches.push({
          docId: doc.id,
          fileName: doc.fileName,
          skillId: doc.skillId,
          matchType: 'cost_code',
          matchScore: 1.0,
          matchedValue: costCodeMatch.value,
        });
        continue;
      }

      const descMatch = matchDescription(doc.fields, li.description);
      if (descMatch.score >= 0.75) {
        matches.push({
          docId: doc.id,
          fileName: doc.fileName,
          skillId: doc.skillId,
          matchType: 'description',
          matchScore: descMatch.score,
          matchedValue: descMatch.value,
        });
      }
    }

    const uniqueMatches = matches.reduce((acc, m) => {
      const existing = acc.find(a => a.docId === m.docId);
      if (!existing || m.matchScore > existing.matchScore) {
        return [...acc.filter(a => a.docId !== m.docId), m];
      }
      return acc;
    }, [] as CoverageMatch[]);

    uniqueMatches.sort((a, b) => b.matchScore - a.matchScore);

    const coverageScore = uniqueMatches.length > 0
      ? Math.max(...uniqueMatches.map(m => m.matchScore))
      : 0;

    const status = uniqueMatches.some(m => m.matchType === 'cost_code') ? 'covered'
      : coverageScore >= 0.75 ? 'partial'
      : 'missing';

    coverageItems.push({ lineItem: li, matches: uniqueMatches, coverageScore, status });
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
