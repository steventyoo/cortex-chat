#!/usr/bin/env node

/**
 * Re-process existing pipeline_log records into extracted_records
 * using the new skill-based schema. Generates embeddings for each.
 *
 * Usage: node scripts/reprocess-pipeline.js
 */

const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');

require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateEmbedding(text) {
  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.substring(0, 8000),
  });
  return resp.data[0].embedding;
}

function buildEmbeddingText(documentType, fields, rawText) {
  const parts = [`Document Type: ${documentType}`];
  for (const [name, data] of Object.entries(fields)) {
    if (data && data.value != null) {
      parts.push(`${name}: ${data.value}`);
    }
  }
  if (rawText) {
    parts.push(`Source: ${rawText.substring(0, 2000)}`);
  }
  return parts.join('\n');
}

async function main() {
  console.log('Fetching pipeline_log records...');

  const { data: records, error } = await supabase
    .from('pipeline_log')
    .select('id, file_name, document_type, project_id, org_id, extracted_data, overall_confidence, source_text')
    .order('created_at');

  if (error) {
    console.error('Failed to fetch pipeline_log:', error.message);
    process.exit(1);
  }

  console.log(`Found ${records.length} pipeline records.\n`);

  const skillMap = {
    change_order: { skillId: 'change_order', version: 5 },
    job_cost_report: { skillId: '_general', version: 1 },
  };

  for (const rec of records) {
    const extracted = typeof rec.extracted_data === 'string'
      ? JSON.parse(rec.extracted_data)
      : rec.extracted_data;

    if (!extracted || !extracted.fields) {
      console.log(`  Skipping ${rec.file_name} — no extracted fields`);
      continue;
    }

    const docType = rec.document_type || '_general';
    const skill = skillMap[docType] || { skillId: '_general', version: 1 };

    const fieldsJson = {};
    for (const [name, data] of Object.entries(extracted.fields)) {
      fieldsJson[name] = { value: data.value, confidence: data.confidence };
    }

    console.log(`Processing: ${rec.file_name}`);
    console.log(`  Type: ${docType}, Skill: ${skill.skillId}, Fields: ${Object.keys(fieldsJson).length}`);

    const row = {
      project_id: rec.project_id,
      org_id: rec.org_id,
      skill_id: skill.skillId,
      skill_version: skill.version,
      pipeline_log_id: rec.id,
      document_type: extracted.documentType || docType,
      source_file: rec.file_name,
      fields: fieldsJson,
      raw_text: rec.source_text || null,
      overall_confidence: rec.overall_confidence || null,
      status: 'approved',
    };

    const { data: inserted, error: insertErr } = await supabase
      .from('extracted_records')
      .insert(row)
      .select('id')
      .single();

    if (insertErr) {
      console.error(`  FAILED to insert: ${insertErr.message}`);
      continue;
    }

    const erId = inserted.id;
    console.log(`  Inserted extracted_record: ${erId}`);

    // Update pipeline_log to point to the new record
    await supabase.from('pipeline_log').update({
      pushed_record_ids: erId,
    }).eq('id', rec.id);

    // Generate and store embedding
    try {
      const embText = buildEmbeddingText(
        extracted.documentType || docType,
        fieldsJson,
        rec.source_text
      );
      const embedding = await generateEmbedding(embText);

      const { error: embErr } = await supabase
        .from('extracted_records')
        .update({ embedding: embedding })
        .eq('id', erId);

      if (embErr) {
        console.error(`  Embedding store failed: ${embErr.message}`);
      } else {
        console.log(`  Embedding stored (${embedding.length} dims)`);
      }
    } catch (embErr) {
      console.error(`  Embedding generation failed:`, embErr.message);
    }

    console.log('');
  }

  // Verify
  const { data: finalRecords } = await supabase
    .from('extracted_records')
    .select('id, document_type, skill_id, source_file, overall_confidence')
    .order('created_at');

  console.log('=== Final extracted_records ===');
  for (const r of (finalRecords || [])) {
    console.log(`  ${r.source_file} | type=${r.document_type} | skill=${r.skill_id} | conf=${r.overall_confidence}`);
  }
  console.log(`\nTotal: ${(finalRecords || []).length} records`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
