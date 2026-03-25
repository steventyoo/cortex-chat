/**
 * Backfill embeddings for extracted_records that don't have them yet.
 * Run: node scripts/backfill-embeddings.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai').default;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildEmbeddingText(record) {
  const parts = [`Document type: ${record.document_type || record.skill_id}`];

  for (const [key, val] of Object.entries(record.fields || {})) {
    if (val && typeof val === 'object' && 'value' in val) {
      if (val.value != null) parts.push(`${key}: ${val.value}`);
    } else if (val != null) {
      parts.push(`${key}: ${val}`);
    }
  }

  if (record.raw_text) {
    parts.push('---');
    parts.push(record.raw_text.slice(0, 4000));
  }

  return parts.join('\n').slice(0, 8000);
}

async function main() {
  console.log('=== Backfill Embeddings for extracted_records ===\n');

  const { data: records, error } = await sb
    .from('extracted_records')
    .select('id, skill_id, document_type, fields, raw_text')
    .is('embedding', null);

  if (error) {
    console.error('Failed to fetch records:', error.message);
    process.exit(1);
  }

  console.log(`Found ${records.length} records without embeddings.\n`);

  let success = 0;
  for (const record of records) {
    const text = buildEmbeddingText(record);
    try {
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        dimensions: 1536,
      });

      const embedding = response.data[0].embedding;
      const embeddingStr = `[${embedding.join(',')}]`;

      const { error: updateErr } = await sb
        .from('extracted_records')
        .update({ embedding: embeddingStr })
        .eq('id', record.id);

      if (updateErr) {
        console.error(`  [${record.id}] Update failed:`, updateErr.message);
      } else {
        success++;
        console.log(`  [${record.id}] ${record.document_type || record.skill_id} — embedded`);
      }
    } catch (err) {
      console.error(`  [${record.id}] Embedding failed:`, err.message);
    }
  }

  console.log(`\n=== Done. Embedded ${success}/${records.length} records ===`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
