// Pipeline types and utilities for document labeling

export type PipelineStatus =
  | 'intake'
  | 'tier1_extracting'
  | 'tier1_complete'
  | 'tier2_validating'
  | 'tier2_validated'
  | 'tier2_flagged'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'pushed'
  | 'deleted';

export type DocumentType =
  | 'Change Order'
  | 'ASI'
  | 'RFI'
  | 'Invoice'
  | 'Daily Report'
  | 'Submittal'
  | 'Contract'
  | 'Job Cost Report'
  | 'Schedule'
  | 'Other';

export type ReviewAction = 'approved' | 'rejected' | 'edited';

export interface ExtractedField {
  value: string | number | null;
  confidence: number; // 0-1
}

export interface ExtractionResult {
  documentType: DocumentType;
  documentTypeConfidence: number;
  fields: Record<string, ExtractedField>;
  /** Multi-record extraction: array of records for tabular data (e.g., 24 JOB_COSTS line items) */
  records?: Array<Record<string, ExtractedField>>;
  /** Target table override — for documents that push to multiple tables */
  targetTables?: Array<{
    table: string;
    records: Array<Record<string, ExtractedField>>;
  }>;
  rawText?: string;
}

export interface ValidationFlag {
  field: string;
  issue: string;
  severity: 'info' | 'warning' | 'error';
}

export interface PipelineItem {
  id: string; // Airtable record ID
  pipelineId: string;
  projectId: string;
  fileName: string;
  fileUrl: string | null;
  documentType: DocumentType | null;
  status: PipelineStatus;
  overallConfidence: number | null;
  extractedData: ExtractionResult | null;
  validationFlags: ValidationFlag[];
  reviewer: string | null;
  reviewAction: ReviewAction | null;
  reviewNotes: string | null;
  reviewEdits: string | null;
  rejectionReason: string | null;
  airtableRecordIds: string | null;
  sourceText: string | null;
  aiModel: string | null;
  createdAt: string;
  tier1CompletedAt: string | null;
  tier2CompletedAt: string | null;
  reviewedAt: string | null;
  pushedAt: string | null;
}

// Extraction prompt templates per document type
export const EXTRACTION_SYSTEM_PROMPT = `You are a construction document data extraction AI for OWP (One Way Plumbing LLC), a mechanical/plumbing subcontractor.

Your job is to read construction documents and extract ALL structured data — every line item, every row, every record. You must be thorough and extract COMPLETE data, not summaries.

## Rules
- Extract ONLY what's explicitly stated in the document. Never infer or fabricate data.
- **CRITICAL: Extract EVERY individual line item / row.** For Job Cost Reports, extract ALL cost code line items. For spreadsheets, extract ALL rows. For Change Orders, extract all COs.
- Assign confidence scores honestly:
  - 0.95-1.0: Field is clearly stated with no ambiguity
  - 0.80-0.94: Field is likely correct but some interpretation needed
  - 0.60-0.79: Field is uncertain, may need human verification
  - Below 0.60: Low confidence, likely needs correction
- If a field cannot be found, set value to null and confidence to 0.0
- For dollar amounts, extract as numbers (no $ sign)
- For dates, use ISO format (YYYY-MM-DD)
- For percentages, extract as decimal numbers (e.g., 84.5 not 0.845)

## Multi-Record Extraction
Many construction documents contain MULTIPLE records (line items, rows, cost codes, etc.). You MUST extract each one individually.

**For Job Cost Reports / Job Reports:**
- Extract EVERY cost code line item into "records" array, targeting JOB_COSTS table
- Each record: Cost Code, Description, Contract Budget, Estimated Cost at Completion, Variance, % Over/Under
- ALSO extract production/labor data into "targetTables" with table "PRODUCTION"
- Each production record: Cost Code, Activity Description, Budget Labor Hours, Actual Labor Hours, Hours to Complete, Performance Ratio, Productivity Indicator
- Include a PROJECT summary record in "fields" with totals

**For Change Order documents (including COR spreadsheets):**
- Extract each Change Order as an individual record in "records" array
- Each record: CO ID, CO Type, Scope Description, Date Submitted, Labor amounts, Material amounts, Total Amount, Approval Status

**For Excel spreadsheets with tabular data:**
- Extract EVERY row as a separate record
- Map columns to the appropriate field names

## Response Format
Respond with ONLY valid JSON (no markdown, no explanation).

**For single-record documents:**
{
  "documentType": "Change Order",
  "documentTypeConfidence": 0.95,
  "fields": {
    "fieldName": { "value": "extracted value", "confidence": 0.95 }
  }
}

**For multi-record documents (Job Cost Reports, spreadsheets with multiple rows):**
{
  "documentType": "Job Cost Report",
  "documentTypeConfidence": 0.95,
  "fields": {
    "Report Date": { "value": "2025-02-28", "confidence": 0.95 },
    "Total Budget": { "value": 4361802, "confidence": 0.95 }
  },
  "records": [
    { "Cost Code": { "value": "260", "confidence": 0.95 }, "Description": { "value": "Plumbing Rough-In", "confidence": 0.95 }, "Contract Budget": { "value": 500000, "confidence": 0.95 }, "Estimated Cost": { "value": 480000, "confidence": 0.95 }, "Variance": { "value": 20000, "confidence": 0.95 }, "% Over/Under": { "value": -4.0, "confidence": 0.95 } }
  ],
  "targetTables": [
    {
      "table": "PRODUCTION",
      "records": [
        { "Cost Code": { "value": "260", "confidence": 0.95 }, "Activity Description": { "value": "Plumbing Rough-In", "confidence": 0.95 }, "Budget Labor Hours": { "value": 3000, "confidence": 0.95 }, "Actual Labor Hours": { "value": 2800, "confidence": 0.95 }, "Performance Ratio": { "value": 1.07, "confidence": 0.95 } }
      ]
    }
  ]
}`;

// Field definitions per document type
export const DOCUMENT_TYPE_FIELDS: Record<string, string[]> = {
  'Change Order': [
    'CO ID', 'CO Type', 'Scope Description', 'Date Submitted',
    'Triggering Doc Ref', 'Foreman Hours', 'Foreman Rate',
    'Journeyman Hours', 'Journeyman Rate', 'Mgmt Hours', 'Mgmt Rate',
    'Labor Subtotal', 'Material Subtotal', 'Sub Tier Amount',
    'OHP Rate', 'OHP on Labor', 'OHP on Material',
    'GC Proposed Amount', 'Owner Approved Amount',
    'CSI Division Primary', 'Building System',
    'Initiating Party', 'Change Reason', 'Schedule Impact',
    'Approval Status',
  ],
  'ASI': [
    'Design Doc ID', 'Document Type', 'Description',
    'Issued By', 'Issue Date', 'Cost Impact',
    'Resulting COR CO', 'CSI Divisions Affected',
  ],
  'RFI': [
    'Design Doc ID', 'Document Type', 'Description',
    'Issued By', 'Issue Date', 'Response Date',
    'Cost Impact', 'Resulting COR CO',
  ],
  'Invoice': [
    'Invoice Number', 'Vendor', 'Date', 'Amount',
    'Description', 'Cost Code', 'Payment Terms',
    'PO Number',
  ],
  'Daily Report': [
    'Date', 'Foreman', 'Crew Size', 'Hours Worked',
    'Work Performed', 'Materials Used', 'Equipment',
    'Weather', 'Visitors', 'Safety Incidents',
  ],
  'Job Cost Report': [
    'Report Date', 'Period', 'Total Budget',
    'Total Actual', 'Total Variance', 'Percent Complete',
    // Per-row fields (in records array):
    'Cost Code', 'Description', 'Contract Budget',
    'Estimated Cost at Completion', 'Variance', '% Over/Under',
  ],
};

// Fields for multi-record line items in each target table
export const MULTI_RECORD_FIELDS: Record<string, string[]> = {
  'JOB_COSTS': [
    'Cost Code', 'Description', 'Contract Budget',
    'Estimated Cost at Completion', 'Variance', '% Over/Under',
    'JTD Cost', 'Cost to Complete', 'Invoice Amount', 'Vendor',
  ],
  'PRODUCTION': [
    'Cost Code', 'Activity Description', 'Budget Labor Hours',
    'Actual Labor Hours', 'Hours to Complete', 'Performance Ratio',
    'Productivity Indicator', 'Hrs Remaining', 'Production Status',
  ],
  'CHANGE_ORDERS': [
    'CO ID', 'CO Type', 'Scope Description', 'Date Submitted',
    'Triggering Doc Ref', 'Labor Subtotal', 'Material Subtotal',
    'Sub Tier Amount', 'OHP Rate', 'GC Proposed Amount',
    'Owner Approved Amount', 'Approval Status', 'Change Reason',
    'Schedule Impact',
  ],
};

// Map extracted document types to Supabase tables
export const DOC_TYPE_TO_TABLE: Record<string, string> = {
  'Change Order': 'change_orders',
  'ASI': 'design_changes',
  'RFI': 'design_changes',
  'Invoice': 'job_costs',
  'Daily Report': 'documents',
  'Submittal': 'documents',
  'Job Cost Report': 'job_costs',
  'Contract': 'documents',
  'Schedule': 'documents',
  'Other': 'documents',
};

// Build extraction prompt for a specific document
export function buildExtractionPrompt(sourceText: string, projectId?: string): string {
  const lines: string[] = [];
  lines.push('Extract ALL structured data from the following construction document.');
  lines.push('**IMPORTANT: Extract EVERY individual line item, row, and record. Do NOT summarize.**');
  if (projectId) {
    lines.push(`This document belongs to Project ID: ${projectId}`);
  }
  lines.push('');
  lines.push('First, classify the document type, then extract all relevant fields for that type.');
  lines.push('');
  lines.push('Available document types and their fields:');
  for (const [docType, fields] of Object.entries(DOCUMENT_TYPE_FIELDS)) {
    lines.push(`\n${docType}: ${fields.join(', ')}`);
  }
  lines.push('');
  lines.push('## Multi-Record Extraction Rules:');
  lines.push('- For Job Cost Reports: Put EACH cost code as a separate object in the "records" array.');
  lines.push('  Also extract production/labor data into "targetTables" with table="PRODUCTION".');
  lines.push('- For spreadsheets with multiple rows: Put EACH row as a separate object in "records".');
  lines.push('- For Change Order spreadsheets with multiple COs: Put EACH CO in the "records" array.');
  lines.push('- Use "fields" for document-level summary data (totals, dates, etc.).');
  lines.push('- Use "records" for individual line items that go to the primary target table.');
  lines.push('- Use "targetTables" for line items that go to a DIFFERENT table (e.g., PRODUCTION data from a Job Cost Report).');
  lines.push('');
  lines.push('Target table field names for multi-record extraction:');
  for (const [table, fields] of Object.entries(MULTI_RECORD_FIELDS)) {
    lines.push(`  ${table}: ${fields.join(', ')}`);
  }
  lines.push('\n--- DOCUMENT TEXT ---');
  lines.push(sourceText);
  lines.push('--- END DOCUMENT ---');
  return lines.join('\n');
}

// Generate a pipeline ID
export function generatePipelineId(): string {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PL-${datePart}-${randomPart}`;
}

// Compute overall confidence from extracted fields (including multi-record)
export function computeOverallConfidence(extraction: ExtractionResult): number {
  const allFields: ExtractedField[] = [];

  // Summary fields
  for (const f of Object.values(extraction.fields)) {
    if (f.value !== null) allFields.push(f);
  }

  // Multi-record fields
  if (extraction.records) {
    for (const rec of extraction.records) {
      for (const f of Object.values(rec)) {
        if (f.value !== null) allFields.push(f);
      }
    }
  }

  // Target table fields
  if (extraction.targetTables) {
    for (const tt of extraction.targetTables) {
      for (const rec of tt.records) {
        for (const f of Object.values(rec)) {
          if (f.value !== null) allFields.push(f);
        }
      }
    }
  }

  if (allFields.length === 0) return 0;
  const sum = allFields.reduce((acc, f) => acc + f.confidence, 0);
  return Math.round((sum / allFields.length) * 100) / 100;
}

// Get confidence color class
export function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.9) return 'text-green-600 bg-green-50';
  if (confidence >= 0.7) return 'text-amber-600 bg-amber-50';
  return 'text-red-600 bg-red-50';
}

// Get confidence indicator
export function getConfidenceIndicator(confidence: number): string {
  if (confidence >= 0.9) return '🟢';
  if (confidence >= 0.7) return '🟡';
  return '🔴';
}

// Get status display info
export function getStatusDisplay(status: PipelineStatus): { label: string; color: string; bgColor: string } {
  switch (status) {
    case 'intake':
      return { label: 'Intake', color: 'text-gray-600', bgColor: 'bg-gray-100' };
    case 'tier1_extracting':
      return { label: 'AI Extracting', color: 'text-yellow-700', bgColor: 'bg-yellow-100' };
    case 'tier1_complete':
      return { label: 'Extracted', color: 'text-yellow-800', bgColor: 'bg-yellow-100' };
    case 'tier2_validating':
      return { label: 'Validating', color: 'text-orange-700', bgColor: 'bg-orange-100' };
    case 'tier2_validated':
      return { label: 'Validated', color: 'text-orange-800', bgColor: 'bg-orange-100' };
    case 'tier2_flagged':
      return { label: 'Flagged', color: 'text-red-600', bgColor: 'bg-red-100' };
    case 'pending_review':
      return { label: 'Pending Review', color: 'text-blue-600', bgColor: 'bg-blue-100' };
    case 'approved':
      return { label: 'Approved', color: 'text-green-600', bgColor: 'bg-green-100' };
    case 'rejected':
      return { label: 'Rejected', color: 'text-red-700', bgColor: 'bg-red-100' };
    case 'pushed':
      return { label: 'Pushed to DB', color: 'text-green-800', bgColor: 'bg-green-100' };
    case 'deleted':
      return { label: 'Deleted', color: 'text-gray-400', bgColor: 'bg-gray-50' };
  }
}

// Parse pipeline item from Airtable record
export function parsePipelineItem(record: { id: string; fields: Record<string, unknown> }): PipelineItem {
  const f = record.fields;

  let extractedData: ExtractionResult | null = null;
  try {
    if (f['Extracted Data']) {
      extractedData = JSON.parse(String(f['Extracted Data']));
    }
  } catch { /* ignore parse errors */ }

  let validationFlags: ValidationFlag[] = [];
  try {
    if (f['Validation Flags']) {
      validationFlags = JSON.parse(String(f['Validation Flags']));
    }
  } catch { /* ignore */ }

  return {
    id: record.id,
    pipelineId: String(f['Pipeline ID'] || ''),
    projectId: String(f['Project ID'] || ''),
    fileName: String(f['File Name'] || ''),
    fileUrl: f['File URL'] ? String(f['File URL']) : null,
    documentType: (f['Document Type'] as DocumentType) || null,
    status: (f['Status'] as PipelineStatus) || 'intake',
    overallConfidence: f['Overall Confidence'] != null ? Number(f['Overall Confidence']) : null,
    extractedData,
    validationFlags,
    reviewer: f['Reviewer'] ? String(f['Reviewer']) : null,
    reviewAction: (f['Review Action'] as ReviewAction) || null,
    reviewNotes: f['Review Notes'] ? String(f['Review Notes']) : null,
    reviewEdits: f['Review Edits'] ? String(f['Review Edits']) : null,
    rejectionReason: f['Rejection Reason'] ? String(f['Rejection Reason']) : null,
    airtableRecordIds: f['Airtable Record IDs'] ? String(f['Airtable Record IDs']) : null,
    sourceText: f['Source Text'] ? String(f['Source Text']) : null,
    aiModel: f['AI Model'] ? String(f['AI Model']) : null,
    createdAt: String(f['Created At'] || new Date().toISOString()),
    tier1CompletedAt: f['Tier1 Completed At'] ? String(f['Tier1 Completed At']) : null,
    tier2CompletedAt: f['Tier2 Completed At'] ? String(f['Tier2 Completed At']) : null,
    reviewedAt: f['Reviewed At'] ? String(f['Reviewed At']) : null,
    pushedAt: f['Pushed At'] ? String(f['Pushed At']) : null,
  };
}
