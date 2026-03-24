/**
 * Parses the Project Cortex Taxonomy Matrix xlsx into data/taxonomy.json.
 *
 * Usage: node scripts/parse-taxonomy.js [path-to-xlsx]
 *
 * The xlsx has 11 schema sheets (indices 0-10), each with:
 *   Row 0: Title
 *   Row 1: Summary / attribute count
 *   Row 2: Empty
 *   Row 3: Column headers (#, ATTRIBUTE, TIER, SOURCE, ...)
 *   Row 4+: Data rows (some are tier divider rows like "AUTO-EXTRACTED — ...")
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const SCHEMA_SHEETS = [
  { sheet: 'RFI Labeling Schema', skillId: 'rfi', displayName: 'RFI' },
  { sheet: 'Contract Clause Schema', skillId: 'contract', displayName: 'Contract' },
  { sheet: 'Change Order Schema', skillId: 'change_order', displayName: 'Change Order' },
  { sheet: 'Design Changes & Pre-CO', skillId: 'design_change', displayName: 'Design Change' },
  { sheet: 'Estimate Labeling Schema', skillId: 'estimate', displayName: 'Estimate' },
  { sheet: 'Sub Bid Analysis Schema', skillId: 'sub_bid', displayName: 'Sub Bid' },
  { sheet: 'Submittal Schema', skillId: 'submittal', displayName: 'Submittal' },
  { sheet: 'Daily Report Schema', skillId: 'daily_report', displayName: 'Daily Report' },
  { sheet: 'Production Activity Schema', skillId: 'production_activity', displayName: 'Production Activity' },
  { sheet: 'Safety & Inspection Schema', skillId: 'safety_inspection', displayName: 'Safety & Inspection' },
  { sheet: 'Project Admin Docs Schema', skillId: 'project_admin', displayName: 'Project Admin' },
];

const HEADER_ROW = 3;

function cleanString(val) {
  if (val == null) return '';
  return String(val).replace(/\r\n/g, ' ').replace(/\n/g, ' ').trim();
}

function parseSheet(wb, config) {
  const ws = wb.Sheets[config.sheet];
  if (!ws) {
    console.warn(`Sheet "${config.sheet}" not found, skipping.`);
    return null;
  }

  const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });

  const summary = cleanString(raw[1]?.[0] || '');
  const headers = (raw[HEADER_ROW] || []).map(cleanString);

  const colIndex = {};
  headers.forEach((h, i) => {
    const normalized = h.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (normalized.startsWith('#')) colIndex['NUMBER'] = i;
    else if (normalized === 'ATTRIBUTE') colIndex['ATTRIBUTE'] = i;
    else if (normalized === 'TIER') colIndex['TIER'] = i;
    else if (normalized === 'SOURCE') colIndex['SOURCE'] = i;
    else if (normalized.startsWith('INPUT')) colIndex['INPUT_TYPE'] = i;
    else if (normalized.startsWith('OPTIONS')) colIndex['OPTIONS'] = i;
    else if (normalized.startsWith('LABELER')) colIndex['LABELER'] = i;
    else if (normalized.startsWith('EST')) colIndex['EST_TIME'] = i;
    else if (normalized === 'EXAMPLE') colIndex['EXAMPLE'] = i;
    else if (normalized.startsWith('WHY')) colIndex['WHY_MATTERS'] = i;
    else if (normalized.startsWith('INGESTION')) colIndex['INGESTION_MODEL'] = i;
    else if (normalized.startsWith('AI CONF')) colIndex['AI_CONFIDENCE'] = i;
    else if (normalized.startsWith('LLM')) colIndex['LLM_TECHNIQUE'] = i;
    else if (normalized.startsWith('HUMAN')) colIndex['HUMAN_ROLE'] = i;
    else if (normalized.startsWith('ADJ')) colIndex['ADJ_TIME'] = i;
  });

  const attributes = [];
  for (let i = HEADER_ROW + 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row.length === 0) continue;

    const numVal = row[colIndex['NUMBER'] ?? 0];
    const attrName = cleanString(row[colIndex['ATTRIBUTE'] ?? 1]);

    // Skip tier divider rows (no number, and text looks like "AUTO-EXTRACTED", "TIER 1", etc.)
    if (numVal == null || numVal === '' || typeof numVal === 'string') {
      continue;
    }

    if (!attrName) continue;

    attributes.push({
      number: Number(numVal),
      name: attrName,
      tier: cleanString(row[colIndex['TIER']]),
      source: cleanString(row[colIndex['SOURCE']]),
      inputType: cleanString(row[colIndex['INPUT_TYPE']]),
      options: cleanString(row[colIndex['OPTIONS']]) || null,
      labelerQualification: cleanString(row[colIndex['LABELER']]),
      estTimeSeconds: cleanString(row[colIndex['EST_TIME']]),
      example: cleanString(row[colIndex['EXAMPLE']]),
      whyItMatters: cleanString(row[colIndex['WHY_MATTERS']]),
      ingestionModel: cleanString(row[colIndex['INGESTION_MODEL']]),
      aiConfidence: cleanString(row[colIndex['AI_CONFIDENCE']]),
      llmTechnique: cleanString(row[colIndex['LLM_TECHNIQUE']]),
      humanRole: cleanString(row[colIndex['HUMAN_ROLE']]),
      adjustedTimeSeconds: cleanString(row[colIndex['ADJ_TIME']]),
    });
  }

  return {
    sheetName: config.sheet,
    skillId: config.skillId,
    displayName: config.displayName,
    summary,
    totalAttributes: attributes.length,
    attributes,
  };
}

function main() {
  const xlsxPath = process.argv[2]
    || '/Users/ishaanshrivastava/Downloads/Project Cortex_Labeling_Taxonomy_Matrix_CURRENT.xlsx';

  if (!fs.existsSync(xlsxPath)) {
    console.error(`File not found: ${xlsxPath}`);
    process.exit(1);
  }

  console.log(`Parsing: ${xlsxPath}`);
  const wb = XLSX.readFile(xlsxPath);

  const schemas = [];
  for (const config of SCHEMA_SHEETS) {
    const schema = parseSheet(wb, config);
    if (schema) {
      schemas.push(schema);
      console.log(`  ${config.displayName}: ${schema.totalAttributes} attributes`);
    }
  }

  const outPath = path.join(__dirname, '..', 'data', 'taxonomy.json');
  fs.writeFileSync(outPath, JSON.stringify(schemas, null, 2));
  console.log(`\nWrote ${schemas.length} schemas to ${outPath}`);
}

main();
