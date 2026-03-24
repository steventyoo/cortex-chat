/**
 * Skill-based document classification and extraction.
 *
 * Each "skill" is a self-contained extraction configuration for one document type,
 * stored in the document_skills table. The pipeline is:
 *   1. classifyDocument() — lightweight Haiku call to determine doc type
 *   2. getSkill() — fetch the matched skill (or _general fallback)
 *   3. buildSkillPrompt() — assemble extraction prompt from skill definition
 *   4. extractWithSkill() — orchestrate classify → extract → validate
 */

import Anthropic from '@anthropic-ai/sdk';
import { getSupabase } from './supabase';
import { ExtractionResult, ValidationFlag, computeOverallConfidence } from './pipeline';

// ── Types ─────────────────────────────────────────────────────

export interface FieldDefinition {
  name: string;
  type: 'string' | 'number' | 'date' | 'enum' | 'boolean' | 'array';
  tier: 1 | 2 | 3;
  required: boolean;
  description: string;
  options?: string[];
  disambiguationRules?: string;
}

export interface DocumentSkill {
  id: string;
  skillId: string;
  displayName: string;
  version: number;
  status: 'active' | 'draft' | 'archived';
  systemPrompt: string;
  fieldDefinitions: FieldDefinition[];
  targetTable: string;
  multiRecordConfig: {
    primaryTable: string;
    fields: string[];
    secondaryTables?: Array<{ table: string; fields: string[] }>;
  } | null;
  columnMapping: Record<string, string>;
  sampleExtractions: FewShotExample[];
  classifierHints: { description: string; keywords: string[] } | null;
}

export interface FewShotExample {
  inputSnippet: string;
  expectedOutput: Record<string, unknown>;
}

export interface ClassificationResult {
  documentType: string;
  skillId: string | null;
  confidence: number;
  reasoning: string;
}

export interface OrgSkillConfig {
  orgId: string;
  skillId: string;
  documentAliases: string[];
  fieldAliases: Record<string, string>;
  customFields: FieldDefinition[];
  hiddenFields: string[];
  fieldDefaults: Record<string, unknown>;
}

export interface ExtractionOutput {
  extraction: ExtractionResult;
  overallConfidence: number;
  flags: ValidationFlag[];
}

// ── Cache ─────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000;

let _skillsCache: DocumentSkill[] | null = null;
let _skillsCacheTime = 0;

const _orgAliasCache = new Map<string, { data: Map<string, string[]>; time: number }>();

function mapRowToSkill(row: Record<string, unknown>): DocumentSkill {
  return {
    id: String(row.id || ''),
    skillId: String(row.skill_id || ''),
    displayName: String(row.display_name || ''),
    version: Number(row.version || 1),
    status: (row.status as DocumentSkill['status']) || 'active',
    systemPrompt: String(row.system_prompt || ''),
    fieldDefinitions: (row.field_definitions as FieldDefinition[]) || [],
    targetTable: String(row.target_table || 'documents'),
    multiRecordConfig: (row.multi_record_config as DocumentSkill['multiRecordConfig']) || null,
    columnMapping: (row.column_mapping as Record<string, string>) || {},
    sampleExtractions: (row.sample_extractions as FewShotExample[]) || [],
    classifierHints: (row.classifier_hints as DocumentSkill['classifierHints']) || null,
  };
}

// ── Skill Access ──────────────────────────────────────────────

export async function listActiveSkills(): Promise<DocumentSkill[]> {
  const now = Date.now();
  if (_skillsCache && now - _skillsCacheTime < CACHE_TTL_MS) {
    return _skillsCache;
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from('document_skills')
    .select('*')
    .eq('status', 'active');

  if (error) {
    console.error('Failed to fetch skills:', error.message);
    return _skillsCache || [];
  }

  _skillsCache = (data || []).map(mapRowToSkill);
  _skillsCacheTime = now;
  return _skillsCache;
}

export async function getSkill(skillId: string): Promise<DocumentSkill | null> {
  const skills = await listActiveSkills();
  return skills.find(s => s.skillId === skillId) || null;
}

// ── Org Alias Map ─────────────────────────────────────────────

export async function getOrgAliasMap(orgId: string): Promise<Map<string, string[]>> {
  const now = Date.now();
  const cached = _orgAliasCache.get(orgId);
  if (cached && now - cached.time < CACHE_TTL_MS) {
    return cached.data;
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from('org_skill_configs')
    .select('skill_id, document_aliases')
    .eq('org_id', orgId);

  const aliasMap = new Map<string, string[]>();
  if (!error && data) {
    for (const row of data) {
      const aliases = (row.document_aliases as string[]) || [];
      if (aliases.length > 0) {
        aliasMap.set(String(row.skill_id), aliases);
      }
    }
  }

  _orgAliasCache.set(orgId, { data: aliasMap, time: now });
  return aliasMap;
}

// ── Classifier ────────────────────────────────────────────────

export async function classifyDocument(
  text: string,
  knownSkills: DocumentSkill[],
  orgId?: string
): Promise<ClassificationResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let orgAliasMap: Map<string, string[]> | null = null;
  if (orgId) {
    orgAliasMap = await getOrgAliasMap(orgId);
  }

  const typeLines = knownSkills
    .filter(s => s.skillId !== '_general')
    .map(s => {
      const desc = s.classifierHints?.description || s.displayName;
      const aliases = orgAliasMap?.get(s.skillId);
      const aliasLine = aliases && aliases.length > 0
        ? `\n  Also known as: ${aliases.join(', ')}`
        : '';
      return `- ${s.skillId}: ${desc}${aliasLine}`;
    })
    .join('\n');

  const prompt = `You are a construction document classifier. Given the beginning of a document, determine which type it is.

Known document types:
${typeLines}

Document text (first 2000 characters):
${text.slice(0, 2000)}

Respond with ONLY valid JSON (no markdown):
{ "documentType": "skill_id_here", "confidence": 0.0-1.0, "reasoning": "brief explanation" }`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.type === 'text' ? b.text : '')
      .join('');

    let jsonStr = responseText.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();

    const parsed = JSON.parse(jsonStr);
    const skillId = String(parsed.documentType || '');
    const confidence = Number(parsed.confidence || 0);

    const matchedSkill = knownSkills.find(s => s.skillId === skillId);

    return {
      documentType: matchedSkill?.displayName || skillId,
      skillId: confidence >= 0.7 && matchedSkill ? matchedSkill.skillId : '_general',
      confidence,
      reasoning: String(parsed.reasoning || ''),
    };
  } catch (err) {
    console.error('Classification failed:', err);
    return {
      documentType: 'Unknown',
      skillId: '_general',
      confidence: 0,
      reasoning: `Classification error: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

// ── Prompt Builder ────────────────────────────────────────────

export function buildSkillPrompt(skill: DocumentSkill, sourceText: string): string {
  const lines: string[] = [];

  lines.push(`Extract ALL structured data from the following ${skill.displayName} document.`);
  lines.push('');

  if (skill.fieldDefinitions.length > 0) {
    lines.push('## Fields to Extract');
    lines.push('');
    for (const field of skill.fieldDefinitions) {
      const reqLabel = field.required ? 'required' : 'optional';
      let fieldLine = `**${field.name}** (${field.type}, ${reqLabel}): ${field.description}`;
      if (field.options && field.options.length > 0) {
        fieldLine += ` Options: [${field.options.join(', ')}]`;
      }
      lines.push(fieldLine);
    }
    lines.push('');
  }

  if (skill.multiRecordConfig) {
    lines.push('## Multi-Record Extraction');
    lines.push('This document may contain multiple records. Extract each as a separate object in the "records" array.');
    lines.push(`Primary target table fields: ${skill.multiRecordConfig.fields.join(', ')}`);
    if (skill.multiRecordConfig.secondaryTables) {
      for (const st of skill.multiRecordConfig.secondaryTables) {
        lines.push(`Also extract into "${st.table}": ${st.fields.join(', ')}`);
      }
    }
    lines.push('');
  }

  if (skill.sampleExtractions.length > 0) {
    lines.push('## Examples');
    lines.push('');
    for (const ex of skill.sampleExtractions.slice(0, 3)) {
      lines.push(`Input: "${ex.inputSnippet}"`);
      lines.push(`Output: ${JSON.stringify(ex.expectedOutput)}`);
      lines.push('');
    }
  }

  lines.push('## Response Format');
  lines.push('Respond with ONLY valid JSON (no markdown, no explanation):');
  lines.push('{');
  lines.push(`  "documentType": "${skill.displayName}",`);
  lines.push('  "documentTypeConfidence": 0.95,');
  lines.push('  "fields": { "fieldName": { "value": "extracted value", "confidence": 0.95 } }');
  lines.push('}');
  lines.push('');
  lines.push('--- DOCUMENT TEXT ---');
  lines.push(sourceText);
  lines.push('--- END DOCUMENT ---');

  return lines.join('\n');
}

// ── Main Extraction Orchestrator ──────────────────────────────

export async function extractWithSkill(
  sourceText: string,
  projectId: string,
  orgId?: string
): Promise<ExtractionOutput> {
  const skills = await listActiveSkills();

  // 1. Classify
  const classification = await classifyDocument(sourceText, skills, orgId);

  // 2. Get matched skill
  const skill = await getSkill(classification.skillId || '_general')
    || await getSkill('_general');

  if (!skill) {
    throw new Error('No skill found (not even _general). Run the seed script.');
  }

  // 3. Build prompt and extract
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const extractionPrompt = buildSkillPrompt(skill, sourceText);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    system: skill.systemPrompt,
    messages: [{ role: 'user', content: extractionPrompt }],
  });

  const responseText = response.content
    .filter(b => b.type === 'text')
    .map(b => b.type === 'text' ? b.text : '')
    .join('');

  let jsonStr = responseText.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1].trim();

  const extraction = JSON.parse(jsonStr) as ExtractionResult;

  // Attach skill metadata
  extraction.skillId = skill.skillId;
  extraction.skillVersion = skill.version;
  extraction.classifierConfidence = classification.confidence;

  // 4. Compute confidence
  const overallConfidence = computeOverallConfidence(extraction);

  // 5. Validate
  const flags: ValidationFlag[] = [];

  for (const [fieldName, fieldData] of Object.entries(extraction.fields)) {
    if (fieldData.value !== null && fieldData.confidence < 0.7) {
      flags.push({
        field: fieldName,
        issue: `Low confidence (${Math.round(fieldData.confidence * 100)}%)`,
        severity: 'warning',
      });
    }
    if (fieldData.value === null) {
      const expectedField = skill.fieldDefinitions.find(f => f.name === fieldName);
      if (expectedField?.required) {
        flags.push({
          field: fieldName,
          issue: 'Missing — not detected in document',
          severity: 'info',
        });
      }
    }
  }

  // Check for required fields that weren't returned at all
  for (const fd of skill.fieldDefinitions) {
    if (fd.required && !(fd.name in extraction.fields)) {
      flags.push({
        field: fd.name,
        issue: 'Required field not returned by extraction',
        severity: 'warning',
      });
    }
  }

  if (extraction.documentTypeConfidence < 0.8) {
    flags.push({
      field: 'Document Type',
      issue: `Document type classification has low confidence (${Math.round(extraction.documentTypeConfidence * 100)}%)`,
      severity: 'warning',
    });
  }

  return { extraction, overallConfidence, flags };
}

// ── Correction Recording ──────────────────────────────────────

export async function recordCorrection(
  skillId: string,
  pipelineLogId: string,
  originalExtraction: Record<string, unknown>,
  correctedFields: Record<string, unknown>,
  sourceSnippet: string
): Promise<void> {
  const sb = getSupabase();

  const fieldsChanged: string[] = [];
  for (const key of Object.keys(correctedFields)) {
    const origField = (originalExtraction.fields as Record<string, unknown>)?.[key];
    const origValue = origField && typeof origField === 'object' ? (origField as Record<string, unknown>).value : undefined;
    if (origValue !== correctedFields[key]) {
      fieldsChanged.push(key);
    }
  }

  if (fieldsChanged.length === 0) return;

  const skill = await getSkill(skillId);
  const skillVersion = skill?.version || 1;

  const { error } = await sb.from('skill_corrections').insert({
    skill_id: skillId,
    skill_version: skillVersion,
    pipeline_log_id: pipelineLogId,
    source_snippet: sourceSnippet,
    original_extraction: originalExtraction,
    corrected_extraction: correctedFields,
    fields_changed: fieldsChanged,
    is_few_shot_candidate: false,
  });

  if (error) {
    console.error('Failed to record correction:', error.message);
  }
}

// ── Few-Shot Example Selection ────────────────────────────────

export async function selectFewShotExamples(
  skillId: string,
  n = 5
): Promise<FewShotExample[]> {
  const sb = getSupabase();

  const { data, error } = await sb
    .from('skill_corrections')
    .select('source_snippet, corrected_extraction')
    .eq('skill_id', skillId)
    .eq('is_few_shot_candidate', true)
    .order('created_at', { ascending: false })
    .limit(n);

  if (error || !data) return [];

  return data.map(row => ({
    inputSnippet: String(row.source_snippet || '').substring(0, 500),
    expectedOutput: row.corrected_extraction as Record<string, unknown>,
  }));
}
