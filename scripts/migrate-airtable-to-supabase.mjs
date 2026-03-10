#!/usr/bin/env node
/**
 * One-time migration: Airtable → Supabase
 *
 * Reads all records from each Airtable table and inserts into Supabase.
 * Run from the cortex-chat directory:
 *   node scripts/migrate-airtable-to-supabase.mjs
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env.local') });

// ── Config ────────────────────────────────────────────────
const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars. Ensure .env.local has AIRTABLE_PAT, AIRTABLE_BASE_ID, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Airtable fetcher (handles pagination + rate limits) ───
async function fetchAllAirtable(tableName) {
  const records = [];
  let offset;
  const baseUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`;
  const headers = { Authorization: `Bearer ${AIRTABLE_PAT}` };

  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (offset) params.set('offset', offset);

    let res;
    let retries = 0;
    while (true) {
      res = await fetch(`${baseUrl}?${params}`, { headers });
      if (res.status === 429 && retries < 5) {
        retries++;
        console.log(`  Rate limited on ${tableName}, waiting ${retries}s...`);
        await new Promise(r => setTimeout(r, 1000 * retries));
        continue;
      }
      break;
    }

    if (!res.ok) {
      console.error(`  Airtable error for ${tableName}: ${res.status} ${await res.text()}`);
      break;
    }

    const data = await res.json();
    records.push(...(data.records || []));
    offset = data.offset;

    // Small delay between pages to avoid rate limits
    if (offset) await new Promise(r => setTimeout(r, 250));
  } while (offset);

  return records;
}

// ── Field mappers per table ───────────────────────────────

function mapOrg(f) {
  return {
    org_id: f['Organization ID'] || f['Org ID'] || '',
    org_name: f['Organization Name'] || f['Org Name'] || '',
    owner_email: f['Owner Email'] || '',
    plan: (f['Plan'] || 'free').toLowerCase(),
    google_drive_folder_id: f['Google Drive Folder ID'] || f['Drive Folder ID'] || '',
    alert_email_enabled: f['Alert Email Enabled'] !== false,
    weekly_report_enabled: f['Weekly Report Enabled'] === true,
    logo_url: f['Logo URL'] || '',
    active: f['Active'] !== false,
    onboarding_complete: f['Onboarding Complete'] === true,
  };
}

function mapUser(f) {
  return {
    user_id: f['User ID'] || '',
    org_id: f['Organization ID'] || f['Org ID'] || '',
    email: (f['Email'] || '').toLowerCase(),
    name: f['Name'] || '',
    password_hash: f['Password Hash'] || '',
    role: (f['Role'] || 'member').toLowerCase(),
    active: f['Active'] !== false,
    phone: f['Phone'] || '',
    alert_preferences: f['Alert Preferences'] ? (typeof f['Alert Preferences'] === 'string' ? JSON.parse(f['Alert Preferences']) : f['Alert Preferences']) : {},
    last_login: f['Last Login'] || null,
  };
}

function mapProject(f) {
  return {
    project_id: f['Project ID'] || '',
    org_id: f['Organization ID'] || f['Org ID'] || '',
    project_name: f['Project Name'] || '',
    job_number: f['Job Number'] || '',
    contract_value: Number(f['Contract Value'] || 0),
    revised_budget: Number(f['Revised Budget'] || 0),
    job_to_date: Number(f['Job to Date'] || 0),
    percent_complete_cost: Number(f['Percent Complete Cost'] || f['Percent Complete'] || 0),
    total_cos: Number(f['Total COs'] || 0),
    project_status: (f['Project Status'] || f['Status'] || 'active').toLowerCase(),
    foreman: f['Foreman'] || '',
    project_manager: f['Project Manager'] || '',
  };
}

function mapDocument(f) {
  return {
    project_id: f['Project ID'] || '',
    org_id: f['Organization ID'] || f['Org ID'] || '',
    document_id: f['Document ID'] || '',
    document_type: (f['Document Type'] || 'other').toLowerCase().replace(/\s+/g, '_'),
    document_title: f['Document Title'] || '',
    date_on_document: f['Date on Document'] || null,
    labeling_status: f['Labeling Status'] || '',
    source_file_url: f['Source File URL'] || f['File URL'] || '',
    metadata: {},
  };
}

function mapChangeOrder(f) {
  return {
    project_id: f['Project ID'] || '',
    org_id: f['Organization ID'] || f['Org ID'] || '',
    co_id: f['CO ID'] || '',
    co_type: f['CO Type'] || '',
    scope_description: f['Scope Description'] || '',
    date_submitted: f['Date Submitted'] || null,
    triggering_doc_ref: f['Triggering Doc Ref'] || '',
    foreman_hours: Number(f['Foreman Hours'] || 0),
    foreman_rate: Number(f['Foreman Rate'] || 0),
    journeyman_hours: Number(f['Journeyman Hours'] || 0),
    journeyman_rate: Number(f['Journeyman Rate'] || 0),
    mgmt_hours: Number(f['Mgmt Hours'] || 0),
    mgmt_rate: Number(f['Mgmt Rate'] || 0),
    labor_subtotal: Number(f['Labor Subtotal'] || 0),
    material_subtotal: Number(f['Material Subtotal'] || 0),
    sub_tier_amount: Number(f['Sub Tier Amount'] || 0),
    ohp_rate: Number(f['OHP Rate'] || 0),
    ohp_on_labor: Number(f['OHP on Labor'] || 0),
    ohp_on_material: Number(f['OHP on Material'] || 0),
    proposed_amount: Number(f['GC Proposed Amount'] || f['Proposed Amount'] || 0),
    approved_amount: Number(f['Owner Approved Amount'] || f['Approved Amount'] || 0),
    negotiation_delta: Number(f['Negotiation Delta'] || 0),
    csi_divisions: f['CSI Divisions'] ? (Array.isArray(f['CSI Divisions']) ? f['CSI Divisions'] : [f['CSI Divisions']]) : [],
    building_system: f['Building System'] || '',
    initiating_party: f['Initiating Party'] || '',
    change_reason: f['Change Reason'] || '',
    schedule_impact: f['Schedule Impact'] || '',
    approval_status: (f['Approval Status'] || 'pending').toLowerCase(),
    root_cause: f['Root Cause'] || '',
    preventability: f['Preventability'] || '',
    responsibility_attribution: f['Responsibility Attribution'] || '',
    backup_doc_quality: f['Backup Doc Quality'] || '',
    negotiation_strategy: f['Negotiation Strategy'] || '',
    metadata: {},
  };
}

function mapProduction(f) {
  return {
    project_id: f['Project ID'] || '',
    org_id: f['Organization ID'] || f['Org ID'] || '',
    cost_code: f['Cost Code'] || '',
    activity_description: f['Activity Description'] || '',
    budget_labor_hours: Number(f['Budget Labor Hours'] || 0),
    actual_labor_hours: Number(f['Actual Labor Hours'] || 0),
    hours_to_complete: Number(f['Hours to Complete'] || 0),
    hours_remaining: Number(f['Hrs Remaining'] || f['Hours Remaining'] || 0),
    performance_ratio: Number(f['Performance Ratio'] || 0),
    productivity_indicator: f['Productivity Indicator'] || '',
    production_status: f['Production Status'] || '',
    metadata: {},
  };
}

function mapJobCost(f) {
  return {
    project_id: f['Project ID'] || '',
    org_id: f['Organization ID'] || f['Org ID'] || '',
    item_code: f['Item Code'] || '',
    item_description: f['Item Description'] || '',
    category: f['Category'] || '',
    revised_budget: Number(f['Revised Budget'] || 0),
    job_to_date: Number(f['Job to Date'] || f['JTD Cost'] || 0),
    change_orders: Number(f['Change Orders'] || 0),
    over_under: Number(f['Over Under'] || 0),
    pct_of_budget: Number(f['Pct of Budget'] || f['% of Budget'] || 0),
    variance_status: (f['Variance Status'] || 'on_budget').toLowerCase(),
    cost_to_complete: Number(f['Cost to Complete'] || 0),
    estimated_cost_at_completion: Number(f['Estimated Cost at Completion'] || 0),
    invoice_amount: Number(f['Invoice Amount'] || 0),
    vendor: f['Vendor'] || '',
    metadata: {},
  };
}

function mapDesignChange(f) {
  return {
    project_id: f['Project ID'] || '',
    org_id: f['Organization ID'] || f['Org ID'] || '',
    design_doc_id: f['Design Doc ID'] || '',
    doc_type: f['Document Type'] || f['Doc Type'] || '',
    description: f['Description'] || '',
    issued_by: f['Issued By'] || '',
    issue_date: f['Issue Date'] || null,
    response_date: f['Response Date'] || null,
    cost_impact: f['Cost Impact'] || '',
    resulting_cor_co: f['Resulting COR CO'] || '',
    csi_divisions_affected: f['CSI Divisions Affected'] ? (Array.isArray(f['CSI Divisions Affected']) ? f['CSI Divisions Affected'] : [f['CSI Divisions Affected']]) : [],
    metadata: {},
  };
}

function mapCrossRef(f) {
  return {
    project_id: f['Project ID'] || '',
    org_id: f['Organization ID'] || f['Org ID'] || '',
    relationship_id: f['Relationship ID'] || '',
    from_document: f['From Document'] || '',
    to_document: f['To Document'] || '',
    relationship_type: f['Relationship Type'] || '',
    dollar_value_carried: Number(f['Dollar Value Carried'] || 0),
    metadata: {},
  };
}

function mapLabelingLog(f) {
  return {
    project_id: f['Project ID'] || '',
    org_id: f['Organization ID'] || f['Org ID'] || '',
    document_id: f['Document ID'] || '',
    tier1_complete: f['Tier 1 Complete'] === true,
    tier2_complete: f['Tier 2 Complete'] === true,
    tier3_complete: f['Tier 3 Complete'] === true,
    metadata: {},
  };
}

function mapStaffing(f) {
  return {
    project_id: f['Project ID'] || '',
    org_id: f['Organization ID'] || f['Org ID'] || '',
    name: f['Name'] || '',
    role: f['Role'] || '',
    active: f['Active'] !== false,
    metadata: {},
  };
}

function mapPipeline(f) {
  // Normalize document_type to match the enum
  let docType = f['Document Type'] || null;
  if (docType) {
    const dtMap = {
      'change order': 'change_order', 'asi': 'asi', 'rfi': 'rfi',
      'ccd': 'ccd', 'pr/pco': 'pr_pco', 'bulletin': 'bulletin',
      'invoice': 'invoice', 'daily report': 'daily_report',
      'submittal': 'submittal', 'contract': 'contract',
      'job cost report': 'job_cost_report', 'schedule': 'schedule',
      'safety': 'safety', 'inspection': 'inspection',
      'meeting minutes': 'meeting_minutes', 'pay application': 'pay_application',
      'correspondence': 'correspondence', 'punch list': 'punch_list',
      'estimate': 'estimate', 'sub bid': 'sub_bid',
      'production activity': 'production_activity', 'other': 'other',
    };
    docType = dtMap[docType.toLowerCase()] || 'other';
  }

  return {
    pipeline_id: f['Pipeline ID'] || '',
    project_id: f['Project ID'] || '',
    org_id: f['Organization ID'] || f['Org ID'] || '',
    file_name: f['File Name'] || '',
    file_url: f['File URL'] || '',
    document_type: docType,
    status: (f['Status'] || 'intake').toLowerCase(),
    overall_confidence: f['Overall Confidence'] != null ? Number(f['Overall Confidence']) : null,
    source_text: f['Source Text'] || '',
    extracted_data: f['Extracted Data'] ? (typeof f['Extracted Data'] === 'string' ? JSON.parse(f['Extracted Data']) : f['Extracted Data']) : {},
    validation_flags: f['Validation Flags'] ? (typeof f['Validation Flags'] === 'string' ? JSON.parse(f['Validation Flags']) : f['Validation Flags']) : [],
    ai_model: f['AI Model'] || '',
    fingerprint: f['Fingerprint'] || '',
    reviewer: f['Reviewer'] || '',
    review_action: f['Review Action'] ? f['Review Action'].toLowerCase() : null,
    review_notes: f['Review Notes'] || '',
    review_edits: f['Review Edits'] ? (typeof f['Review Edits'] === 'string' ? JSON.parse(f['Review Edits']) : f['Review Edits']) : null,
    rejection_reason: f['Rejection Reason'] || '',
    pushed_record_ids: f['Airtable Record IDs'] || '',
    created_at: f['Created At'] || new Date().toISOString(),
    tier1_completed_at: f['Tier1 Completed At'] || null,
    tier2_completed_at: f['Tier2 Completed At'] || null,
    reviewed_at: f['Reviewed At'] || null,
    pushed_at: f['Pushed At'] || null,
  };
}

function mapDailyNote(f) {
  return {
    project_id: f['Project ID'] || '',
    org_id: f['Organization ID'] || f['Org ID'] || '',
    content: f['Content'] || '',
    crew_count: f['Crew Count'] != null ? Number(f['Crew Count']) : null,
    weather: f['Weather'] || '',
    author_name: f['Author Name'] || '',
    author_email: f['Author Email'] || '',
    note_date: f['Date'] || new Date().toISOString().split('T')[0],
    status: (f['Status'] || 'active').toLowerCase(),
    created_at: f['Created At'] || new Date().toISOString(),
    updated_at: f['Updated At'] || new Date().toISOString(),
  };
}

// ── Fallback org_id (most Airtable records lack this) ─────
let DEFAULT_ORG_ID = '';

async function resolveDefaultOrg() {
  const { data } = await sb.from('organizations').select('org_id').limit(1);
  if (data && data.length > 0) DEFAULT_ORG_ID = data[0].org_id;
  console.log(`Default org_id: ${DEFAULT_ORG_ID}`);
}

// Fix org_id + skip invalid records
function postProcess(row, supabaseTable) {
  // Fill empty org_id
  if (!row.org_id && DEFAULT_ORG_ID) row.org_id = DEFAULT_ORG_ID;

  // Skip records with empty required FK fields
  if (!row.project_id && ['documents', 'change_orders', 'production', 'job_costs',
    'design_changes', 'cross_refs', 'labeling_log', 'staffing', 'pipeline_log', 'daily_notes'].includes(supabaseTable)) {
    return null; // skip
  }

  // Fix document_type enum
  if (row.document_type) {
    const dtFix = {
      'cor': 'change_order', 'co': 'change_order', 'm_hours': 'daily_report',
      'job_report': 'job_cost_report', 'production_report': 'production_activity',
    };
    if (dtFix[row.document_type]) row.document_type = dtFix[row.document_type];
    // Validate against enum
    const validDocTypes = ['change_order', 'asi', 'rfi', 'ccd', 'pr_pco', 'bulletin',
      'invoice', 'daily_report', 'submittal', 'contract', 'job_cost_report', 'schedule',
      'safety', 'inspection', 'meeting_minutes', 'pay_application', 'correspondence',
      'punch_list', 'estimate', 'sub_bid', 'production_activity', 'other'];
    if (!validDocTypes.includes(row.document_type)) row.document_type = 'other';
  }

  // Fix variance_status enum
  if (row.variance_status) {
    const vs = row.variance_status.toLowerCase();
    if (vs.includes('over')) row.variance_status = 'over';
    else if (vs.includes('under')) row.variance_status = 'under';
    else row.variance_status = 'on_budget';
  }

  // Fix approval_status enum
  if (row.approval_status) {
    const validApproval = ['pending', 'submitted', 'in_review', 'approved', 'rejected', 'disputed'];
    if (!validApproval.includes(row.approval_status)) row.approval_status = 'pending';
  }

  // Fix pipeline status enum
  if (row.status && supabaseTable === 'pipeline_log') {
    const validStatus = ['intake', 'tier1_extracting', 'tier1_complete', 'tier2_validating',
      'tier2_validated', 'tier2_flagged', 'pending_review', 'approved', 'rejected', 'pushed', 'deleted'];
    if (!validStatus.includes(row.status)) row.status = 'intake';
  }

  return row;
}

// ── Migration logic ───────────────────────────────────────

async function migrateTable(airtableName, supabaseTable, mapper) {
  console.log(`\n📥 Fetching ${airtableName} from Airtable...`);
  const records = await fetchAllAirtable(airtableName);
  console.log(`   Found ${records.length} records`);

  if (records.length === 0) {
    console.log(`   Skipping (empty table)`);
    return { table: airtableName, fetched: 0, inserted: 0, errors: 0 };
  }

  // Map records
  const rows = [];
  const errors = [];
  for (const rec of records) {
    try {
      let row = mapper(rec.fields || {});
      // Skip rows with empty required fields
      if (supabaseTable === 'projects' && !row.project_id) continue;
      if (supabaseTable === 'organizations' && !row.org_id) continue;
      if (supabaseTable === 'users' && !row.email) continue;
      // Post-process: fix org_id, enums, skip invalid
      row = postProcess(row, supabaseTable);
      if (!row) continue;
      rows.push(row);
    } catch (err) {
      errors.push(`Map error for ${rec.id}: ${err.message}`);
    }
  }

  console.log(`   Mapped ${rows.length} rows (${errors.length} mapping errors)`);

  if (rows.length === 0) {
    return { table: airtableName, fetched: records.length, inserted: 0, errors: errors.length };
  }

  // Insert in batches of 50
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error, count } = await sb.from(supabaseTable).upsert(batch, { onConflict: getConflictKey(supabaseTable) }).select('id');
    if (error) {
      console.error(`   ❌ Insert error for ${supabaseTable} batch ${i}: ${error.message}`);
      // Try one by one for this batch
      for (const row of batch) {
        const { error: singleErr } = await sb.from(supabaseTable).insert(row);
        if (singleErr) {
          errors.push(`${supabaseTable}: ${singleErr.message} — ${JSON.stringify(row).substring(0, 100)}`);
        } else {
          inserted++;
        }
      }
    } else {
      inserted += batch.length;
    }
  }

  console.log(`   ✅ Inserted ${inserted}/${rows.length} into ${supabaseTable}`);
  if (errors.length > 0) {
    console.log(`   ⚠️  ${errors.length} errors:`);
    for (const e of errors.slice(0, 5)) console.log(`      ${e}`);
    if (errors.length > 5) console.log(`      ... and ${errors.length - 5} more`);
  }

  return { table: airtableName, fetched: records.length, inserted, errors: errors.length };
}

function getConflictKey(table) {
  switch (table) {
    case 'organizations': return 'org_id';
    case 'users': return 'email';
    case 'projects': return 'project_id';
    case 'pipeline_log': return 'pipeline_id';
    default: return undefined; // No upsert, just insert
  }
}

// ── Main ──────────────────────────────────────────────────

async function main() {
  console.log('🚀 Airtable → Supabase Migration');
  console.log('='.repeat(50));
  console.log(`Airtable Base: ${AIRTABLE_BASE_ID}`);
  console.log(`Supabase URL:  ${SUPABASE_URL}`);
  console.log('');

  const results = [];

  // Order matters: parent tables first (FK constraints)
  // 1. Organizations
  results.push(await migrateTable('ORGANIZATIONS', 'organizations', mapOrg));

  // Resolve default org for child records missing org_id
  await resolveDefaultOrg();

  // 2. Users
  results.push(await migrateTable('USERS', 'users', mapUser));

  // 3. Projects
  results.push(await migrateTable('PROJECTS', 'projects', mapProject));

  // 4. All child tables (can run after projects exist)
  results.push(await migrateTable('DOCUMENTS', 'documents', mapDocument));
  results.push(await migrateTable('CHANGE_ORDERS', 'change_orders', mapChangeOrder));
  results.push(await migrateTable('PRODUCTION', 'production', mapProduction));
  results.push(await migrateTable('JOB_COSTS', 'job_costs', mapJobCost));
  results.push(await migrateTable('DESIGN_CHANGES', 'design_changes', mapDesignChange));
  results.push(await migrateTable('CROSS_REFS', 'cross_refs', mapCrossRef));
  results.push(await migrateTable('LABELING_LOG', 'labeling_log', mapLabelingLog));
  results.push(await migrateTable('STAFFING', 'staffing', mapStaffing));
  results.push(await migrateTable('PIPELINE_LOG', 'pipeline_log', mapPipeline));
  results.push(await migrateTable('DAILY_NOTES', 'daily_notes', mapDailyNote));

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 Migration Summary');
  console.log('='.repeat(50));
  console.log(`${'Table'.padEnd(25)} ${'Fetched'.padStart(8)} ${'Inserted'.padStart(9)} ${'Errors'.padStart(7)}`);
  console.log('-'.repeat(50));
  for (const r of results) {
    console.log(`${r.table.padEnd(25)} ${String(r.fetched).padStart(8)} ${String(r.inserted).padStart(9)} ${String(r.errors).padStart(7)}`);
  }
  const totalFetched = results.reduce((s, r) => s + r.fetched, 0);
  const totalInserted = results.reduce((s, r) => s + r.inserted, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors, 0);
  console.log('-'.repeat(50));
  console.log(`${'TOTAL'.padEnd(25)} ${String(totalFetched).padStart(8)} ${String(totalInserted).padStart(9)} ${String(totalErrors).padStart(7)}`);
  console.log('\n✅ Migration complete!');
}

main().catch(err => {
  console.error('💥 Migration failed:', err);
  process.exit(1);
});
