/**
 * E2E smoke test for the skill-based extraction pipeline.
 * Tests: classify -> extract -> validate using direct API calls.
 *
 * Usage: node scripts/test-extraction.js
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk').default;
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SAMPLE_CO_TEXT = `
CHANGE ORDER #017
Project: Main St Medical Center (#2024-031)
Date Initiated: 2025-03-30
Date Approved: 2025-04-22

Scope Description: Additional fire sprinkler risers required due to revised floor plan in Building B, Wing 2.
Original design showed 4 risers; revised structural drawings (ASI-023) require 6 risers to meet code.

Triggering Document: ASI-023 (Structural Revision)
Initiating Party: Architect / Design Team
Change Reason: Design Error

Labor Breakdown:
  Foreman: 24 hrs @ $95/hr = $2,280
  Journeyman: 80 hrs @ $75/hr = $6,000
  Labor Subtotal: $9,240

Materials:
  Material Subtotal: $4,600

GC Proposed Amount: $15,916
Owner Approved Amount: $15,200

CSI Division: 21 — Fire Suppression
Building System: Fire Protection
Approval Status: Approved
Root Cause: Design Error
Preventability: Yes
`;

async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // 1. Fetch skills from DB
  console.log('1. Fetching skills from document_skills...');
  const { data: skills, error: skillsErr } = await supabase
    .from('document_skills')
    .select('*')
    .eq('status', 'active');

  if (skillsErr || !skills) {
    console.error('Failed to fetch skills:', skillsErr?.message);
    process.exit(1);
  }
  console.log(`   Found ${skills.length} active skills`);

  // 2. Classify the document
  console.log('\n2. Classifying document with Haiku...');
  const typeLines = skills
    .filter(s => s.skill_id !== '_general')
    .map(s => {
      const desc = s.classifier_hints?.description || s.display_name;
      return `- ${s.skill_id}: ${desc}`;
    })
    .join('\n');

  const classifyPrompt = `You are a construction document classifier. Given the beginning of a document, determine which type it is.

Known document types:
${typeLines}

Document text (first 2000 characters):
${SAMPLE_CO_TEXT.slice(0, 2000)}

Respond with ONLY valid JSON (no markdown):
{ "documentType": "skill_id_here", "confidence": 0.0-1.0, "reasoning": "brief explanation" }`;

  const classifyResp = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 256,
    messages: [{ role: 'user', content: classifyPrompt }],
  });

  const classifyText = classifyResp.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  let classification;
  try {
    classification = JSON.parse(classifyText.trim());
  } catch {
    console.error('Failed to parse classification:', classifyText);
    process.exit(1);
  }

  console.log(`   Document type: ${classification.documentType}`);
  console.log(`   Confidence: ${classification.confidence}`);
  console.log(`   Reasoning: ${classification.reasoning}`);

  // 3. Get the matched skill
  const skillId = classification.confidence >= 0.7 ? classification.documentType : '_general';
  const skill = skills.find(s => s.skill_id === skillId) || skills.find(s => s.skill_id === '_general');

  if (!skill) {
    console.error('No matching skill found!');
    process.exit(1);
  }
  console.log(`\n3. Using skill: ${skill.skill_id} (${skill.display_name})`);
  console.log(`   Fields: ${skill.field_definitions.length}`);
  console.log(`   Target table: ${skill.target_table}`);

  // 4. Build extraction prompt
  const fieldLines = skill.field_definitions.map(f => {
    const req = f.required ? 'required' : 'optional';
    let line = `**${f.name}** (${f.type}, ${req}): ${f.description}`;
    if (f.options && f.options.length > 0) {
      line += ` Options: [${f.options.join(', ')}]`;
    }
    return line;
  }).join('\n');

  const extractPrompt = `Extract ALL structured data from the following ${skill.display_name} document.

## Fields to Extract

${fieldLines}

## Response Format
Respond with ONLY valid JSON (no markdown, no explanation):
{
  "documentType": "${skill.display_name}",
  "documentTypeConfidence": 0.95,
  "fields": { "fieldName": { "value": "extracted value", "confidence": 0.95 } }
}

--- DOCUMENT TEXT ---
${SAMPLE_CO_TEXT}
--- END DOCUMENT ---`;

  console.log('\n4. Extracting with Sonnet...');
  const extractResp = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    system: skill.system_prompt,
    messages: [{ role: 'user', content: extractPrompt }],
  });

  const extractText = extractResp.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  let jsonStr = extractText.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1].trim();

  let extraction;
  try {
    extraction = JSON.parse(jsonStr);
  } catch {
    console.error('Failed to parse extraction:', jsonStr.substring(0, 200));
    process.exit(1);
  }

  console.log(`   Document type: ${extraction.documentType}`);
  console.log(`   Fields extracted: ${Object.keys(extraction.fields).length}`);

  // 5. Display extracted fields
  console.log('\n5. Extracted Fields:');
  for (const [name, field] of Object.entries(extraction.fields)) {
    const f = field;
    console.log(`   ${name}: ${JSON.stringify(f.value)} (${Math.round(f.confidence * 100)}%)`);
  }

  // 6. Validate
  console.log('\n6. Validation:');
  let warnings = 0;
  for (const [name, field] of Object.entries(extraction.fields)) {
    if (field.confidence < 0.7 && field.value !== null) {
      console.log(`   [WARNING] ${name}: Low confidence (${Math.round(field.confidence * 100)}%)`);
      warnings++;
    }
  }
  for (const fd of skill.field_definitions) {
    if (fd.required && !(fd.name in extraction.fields)) {
      console.log(`   [WARNING] ${fd.name}: Required field not returned`);
      warnings++;
    }
  }
  if (warnings === 0) console.log('   No validation warnings');

  // 7. Verify column mapping
  console.log('\n7. Column Mapping (sample):');
  const mapping = skill.column_mapping || {};
  let mapped = 0;
  for (const fieldName of Object.keys(extraction.fields).slice(0, 5)) {
    const col = mapping[fieldName] || fieldName.toLowerCase().replace(/\s+/g, '_');
    console.log(`   "${fieldName}" -> ${col}`);
    mapped++;
  }
  if (Object.keys(extraction.fields).length > 5) {
    console.log(`   ... and ${Object.keys(extraction.fields).length - 5} more`);
  }

  console.log('\n=== E2E TEST PASSED ===');
  console.log(`Classified as ${classification.documentType} (${classification.confidence}), extracted ${Object.keys(extraction.fields).length} fields, ${warnings} warnings`);
}

main().catch(err => {
  console.error('Test FAILED:', err);
  process.exit(1);
});
