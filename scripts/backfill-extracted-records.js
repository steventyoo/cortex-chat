/**
 * Backfill script: migrates existing data from typed tables
 * (change_orders, production, design_changes, documents)
 * into the unified extracted_records table.
 *
 * Run: node scripts/backfill-extracted-records.js
 * Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const COLUMN_TO_FIELD = {
  co_id: 'CO ID',
  co_type: 'CO Type',
  scope_description: 'Scope Description',
  date_submitted: 'Date Submitted',
  triggering_doc_ref: 'Triggering Doc Ref',
  labor_subtotal: 'Labor Subtotal',
  material_subtotal: 'Material Subtotal',
  sub_tier_amount: 'Sub Tier Amount',
  proposed_amount: 'GC Proposed Amount',
  approved_amount: 'Owner Approved Amount',
  csi_divisions: 'CSI Division Primary',
  approval_status: 'Approval Status',
  root_cause: 'Root Cause',
  preventability: 'Preventability',
  initiating_party: 'Initiating Party',
  change_reason: 'Change Reason',
  schedule_impact: 'Schedule Impact',
  cost_code: 'Cost Code',
  activity_description: 'Activity Description',
  budget_labor_hours: 'Budget Labor Hours',
  actual_labor_hours: 'Actual Labor Hours',
  performance_ratio: 'Performance Ratio',
  productivity_indicator: 'Productivity Indicator',
  hrs_to_complete: 'Hrs to Complete',
  design_doc_id: 'Design Doc ID',
  doc_type: 'Document Type',
  description: 'Description',
  issued_by: 'Issued By',
  issue_date: 'Issue Date',
  cost_impact: 'Cost Impact',
  resulting_cor_co: 'Resulting COR CO',
  document_id: 'Document ID',
  document_type: 'Document Type',
  document_title: 'Document Title',
  date_on_document: 'Date on Document',
  labeling_status: 'Labeling Status',
};

const SKIP_COLUMNS = new Set([
  'id', 'project_id', 'org_id', 'created_at', 'updated_at',
  'airtable_id', 'record_id',
]);

function rowToFields(row, colMap) {
  const fields = {};
  for (const [col, val] of Object.entries(row)) {
    if (SKIP_COLUMNS.has(col) || val == null) continue;
    const fieldName = colMap[col] || col;
    fields[fieldName] = { value: val, confidence: 1.0 };
  }
  return fields;
}

async function backfillTable(tableName, skillId, docType) {
  console.log(`\nBackfilling ${tableName} -> skill_id: ${skillId}...`);

  const { data: rows, error } = await sb.from(tableName).select('*');
  if (error) {
    console.error(`  Error reading ${tableName}:`, error.message);
    return 0;
  }

  if (!rows || rows.length === 0) {
    console.log(`  No rows found in ${tableName}`);
    return 0;
  }

  let inserted = 0;
  for (const row of rows) {
    const fields = rowToFields(row, COLUMN_TO_FIELD);
    if (Object.keys(fields).length === 0) continue;

    const record = {
      project_id: row.project_id || '',
      org_id: row.org_id || '00000000-0000-0000-0000-000000000000',
      skill_id: skillId,
      skill_version: 1,
      document_type: docType,
      fields,
      status: 'pushed',
      created_at: row.created_at || new Date().toISOString(),
    };

    const { error: insertErr } = await sb.from('extracted_records').insert(record);
    if (insertErr) {
      console.error(`  Insert error for row ${row.id}:`, insertErr.message);
    } else {
      inserted++;
    }
  }

  console.log(`  Inserted ${inserted}/${rows.length} rows from ${tableName}`);
  return inserted;
}

async function main() {
  console.log('=== Backfill: Typed Tables -> extracted_records ===');

  let total = 0;

  total += await backfillTable('change_orders', 'change_order', 'Change Order');
  total += await backfillTable('production', 'production_activity', 'Production Activity');
  total += await backfillTable('design_changes', 'design_change', 'Design Change');
  total += await backfillTable('documents', 'submittal', 'Document');

  console.log(`\n=== Done. Total records backfilled: ${total} ===`);
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
