/**
 * Reads data/taxonomy.json and inserts rows into document_skills via Supabase.
 *
 * Usage: node scripts/seed-document-skills.js
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Maps skill_id to the Supabase target table
const TARGET_TABLE_MAP = {
  rfi: 'design_changes',
  contract: 'documents',
  change_order: 'change_orders',
  design_change: 'design_changes',
  estimate: 'documents',
  sub_bid: 'documents',
  submittal: 'documents',
  daily_report: 'documents',
  production_activity: 'production',
  safety_inspection: 'documents',
  project_admin: 'documents',
  _general: 'documents',
};

// Existing FIELD_TO_COLUMN from supabase.ts for known fields
const KNOWN_COLUMN_MAP = {
  'CO ID': 'co_id',
  'CO Number': 'co_id',
  'CO Type': 'co_type',
  'CO Pricing Type': 'co_pricing_type',
  'CO Initiated Date': 'co_initiated_date',
  'CO Approved Date': 'co_approved_date',
  'CO Closed Date': 'co_closed_date',
  'Attributed Subcontractor': 'attributed_subcontractor',
  'Scope Description': 'scope_description',
  'Date Submitted': 'date_submitted',
  'Triggering Doc Ref': 'triggering_doc_ref',
  'Foreman Hours': 'foreman_hours',
  'Foreman Rate': 'foreman_rate',
  'Foreman Name': 'foreman_name',
  'Crew ID / Crew Name': 'crew_id',
  'Mobilization Event': 'mobilization_event',
  'Mobilization Cost': 'mobilization_cost',
  'Journeyman Hours': 'journeyman_hours',
  'Journeyman Rate': 'journeyman_rate',
  'Mgmt Hours': 'mgmt_hours',
  'Mgmt Rate': 'mgmt_rate',
  'Labor Subtotal': 'labor_subtotal',
  'Material Subtotal': 'material_subtotal',
  'Sub Tier Amount': 'sub_tier_amount',
  'OHP Rate': 'ohp_rate',
  'OHP on Labor': 'ohp_on_labor',
  'OHP on Material': 'ohp_on_material',
  'GC Proposed Amount': 'proposed_amount',
  'Owner Approved Amount': 'approved_amount',
  'CSI Division Primary': 'csi_divisions',
  'Building System': 'building_system',
  'Initiating Party': 'initiating_party',
  'Change Reason': 'change_reason',
  'Schedule Impact': 'schedule_impact',
  'Approval Status': 'approval_status',
  'Root Cause': 'root_cause',
  'Preventability': 'preventability',
  'Design Doc ID': 'design_doc_id',
  'Document Type': 'doc_type',
  'Description': 'description',
  'Issued By': 'issued_by',
  'Issue Date': 'issue_date',
  'Response Date': 'response_date',
  'Cost Impact': 'cost_impact',
  'Resulting COR CO': 'resulting_cor_co',
  'CSI Divisions Affected': 'csi_divisions_affected',
  'Cost Code': 'cost_code',
  'Activity Description': 'activity_description',
  'Budget Labor Hours': 'budget_labor_hours',
  'Actual Labor Hours': 'actual_labor_hours',
  'Hours to Complete': 'hours_to_complete',
  'Performance Ratio': 'performance_ratio',
  'Productivity Indicator': 'productivity_indicator',
  'RFI Submitted Date': 'rfi_submitted_date',
  'RFI Required Date': 'rfi_required_date',
  'RFI Response Date': 'rfi_response_date',
  'Submittal Submitted Date': 'submittal_submitted_date',
  'Submittal Required Date': 'submittal_required_date',
  'Submittal Returned Date': 'submittal_returned_date',
  'Report ID': 'report_id',
  'Report Date': 'report_date',
  'Delay Hours': 'delay_hours',
  'Delay Estimated Cost': 'delay_estimated_cost',
  'Rejection Reason Category': 'rejection_reason_category',
  'Rejection Resolution Date': 'rejection_resolution_date',
  'Standard Cost Code': 'standard_cost_code',
  'Warranty Item Trade': 'warranty_item_trade',
  'Warranty Item Cause': 'warranty_item_cause',
  'Warranty Item Cost': 'warranty_item_cost',
};

function mapInputType(inputType) {
  const t = (inputType || '').toLowerCase();
  if (t.includes('dropdown') || t.includes('select') || t === 'auto') return 'enum';
  if (t.includes('number') || t.includes('currency') || t.includes('percent') || t.includes('dollar')) return 'number';
  if (t.includes('date')) return 'date';
  if (t.includes('multi')) return 'array';
  if (t.includes('boolean') || t.includes('yes/no') || t.includes('checkbox')) return 'boolean';
  return 'string';
}

function mapTier(ingestionModel) {
  const m = (ingestionModel || '').toLowerCase();
  if (m.includes('auto')) return 1;
  if (m.includes('ai auto')) return 1;
  if (m.includes('verify')) return 2;
  if (m.includes('human')) return 3;
  return 2;
}

function isRequired(ingestionModel) {
  const m = (ingestionModel || '').toLowerCase();
  return m.includes('auto') && !m.includes('verify') && !m.includes('human');
}

function buildFieldDescription(attr) {
  const parts = [];
  if (attr.whyItMatters) parts.push(attr.whyItMatters);
  if (attr.llmTechnique) parts.push(attr.llmTechnique);
  if (attr.example) parts.push(`Example: ${attr.example}`);
  return parts.join('. ') || attr.name;
}

function toSnakeCase(str) {
  return str
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase();
}

function buildColumnMapping(attributes) {
  const mapping = {};
  for (const attr of attributes) {
    mapping[attr.name] = KNOWN_COLUMN_MAP[attr.name] || toSnakeCase(attr.name);
  }
  return mapping;
}

function parseOptions(optionsStr) {
  if (!optionsStr) return undefined;
  const parts = optionsStr.split(/[|;\n]/).map(s => s.trim()).filter(Boolean);
  if (parts.length <= 1) return undefined;
  return parts;
}

function buildFieldDefinitions(attributes) {
  return attributes.map(attr => {
    const def = {
      name: attr.name,
      type: mapInputType(attr.inputType),
      tier: mapTier(attr.ingestionModel),
      required: isRequired(attr.ingestionModel),
      description: buildFieldDescription(attr),
    };
    const opts = parseOptions(attr.options);
    if (opts) def.options = opts;
    if (attr.llmTechnique && attr.llmTechnique.length > 50) {
      def.disambiguationRules = attr.llmTechnique;
    }
    return def;
  });
}

function buildSystemPrompt(schema) {
  const lines = [
    `You are a construction document data extraction AI specialized in ${schema.displayName} documents.`,
    '',
    'Rules:',
    '- Extract ONLY what is explicitly stated. Never infer or fabricate.',
    '- Assign confidence scores: 0.95-1.0 = clearly stated, 0.80-0.94 = likely correct, 0.60-0.79 = uncertain, below 0.60 = low confidence.',
    '- If a field cannot be found, set value to null and confidence to 0.0.',
    '- For dollar amounts, extract as numbers (no $ sign).',
    '- For dates, use ISO format (YYYY-MM-DD).',
    '- For percentages, extract as decimal (84.5 not 0.845).',
    '',
    'Response format: valid JSON only (no markdown, no explanation).',
    '{',
    `  "documentType": "${schema.displayName}",`,
    '  "documentTypeConfidence": 0.95,',
    '  "fields": { "fieldName": { "value": "...", "confidence": 0.95 } }',
    '}',
  ];
  return lines.join('\n');
}

function buildClassifierHints(schema) {
  const attrNames = schema.attributes.slice(0, 5).map(a => a.name);
  return {
    description: schema.summary || `${schema.displayName} document schema with ${schema.totalAttributes} attributes.`,
    keywords: attrNames,
  };
}

function buildSkillRow(schema) {
  return {
    skill_id: schema.skillId,
    display_name: schema.displayName,
    version: 1,
    status: 'active',
    system_prompt: buildSystemPrompt(schema),
    field_definitions: buildFieldDefinitions(schema.attributes),
    target_table: TARGET_TABLE_MAP[schema.skillId] || 'documents',
    multi_record_config: null,
    column_mapping: buildColumnMapping(schema.attributes),
    sample_extractions: [],
    taxonomy_source: { sheetName: schema.sheetName, totalAttributes: schema.totalAttributes, attributes: schema.attributes },
    classifier_hints: buildClassifierHints(schema),
  };
}

function buildGeneralSkill() {
  return {
    skill_id: '_general',
    display_name: 'General / Unknown',
    version: 1,
    status: 'active',
    system_prompt: [
      'You are a construction document data extraction AI.',
      'The document type is unknown. Extract all key-value pairs you can identify.',
      '',
      'Rules:',
      '- Extract ONLY what is explicitly stated.',
      '- Assign confidence scores honestly (0.0-1.0).',
      '- For dollar amounts, extract as numbers.',
      '- For dates, use ISO format (YYYY-MM-DD).',
      '',
      'Response format: valid JSON only.',
      '{',
      '  "documentType": "Other",',
      '  "documentTypeConfidence": 0.5,',
      '  "fields": { "fieldName": { "value": "...", "confidence": 0.8 } }',
      '}',
    ].join('\n'),
    field_definitions: [],
    target_table: 'documents',
    multi_record_config: null,
    column_mapping: {},
    sample_extractions: [],
    taxonomy_source: null,
    classifier_hints: {
      description: 'Fallback for documents that do not match any known type.',
      keywords: ['document', 'construction', 'general'],
    },
  };
}

async function main() {
  const taxonomyPath = path.join(__dirname, '..', 'data', 'taxonomy.json');
  if (!fs.existsSync(taxonomyPath)) {
    console.error('data/taxonomy.json not found. Run parse-taxonomy.js first.');
    process.exit(1);
  }

  const schemas = JSON.parse(fs.readFileSync(taxonomyPath, 'utf-8'));
  const rows = schemas.map(buildSkillRow);
  rows.push(buildGeneralSkill());

  console.log(`Seeding ${rows.length} skills into document_skills...`);

  // Upsert: delete existing then insert (simple for seed script)
  const { error: delError } = await supabase.from('document_skills').delete().neq('skill_id', '__nonexistent__');
  if (delError) {
    console.error('Failed to clear existing skills:', delError.message);
  }

  for (const row of rows) {
    const { error } = await supabase.from('document_skills').insert(row);
    if (error) {
      console.error(`  Failed to insert ${row.skill_id}:`, error.message);
    } else {
      const fieldCount = row.field_definitions.length;
      console.log(`  ${row.skill_id}: ${fieldCount} fields -> ${row.target_table}`);
    }
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
