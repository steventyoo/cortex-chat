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
  | 'pushed';

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

Your job is to read construction documents and extract structured data fields. You must be accurate and assign confidence scores (0.0 to 1.0) to each extracted field based on how certain you are.

## Rules
- Extract ONLY what's explicitly stated in the document. Never infer or fabricate data.
- Assign confidence scores honestly:
  - 0.95-1.0: Field is clearly stated with no ambiguity
  - 0.80-0.94: Field is likely correct but some interpretation needed
  - 0.60-0.79: Field is uncertain, may need human verification
  - Below 0.60: Low confidence, likely needs correction
- If a field cannot be found, set value to null and confidence to 0.0
- For dollar amounts, extract as numbers (no $ sign)
- For dates, use ISO format (YYYY-MM-DD)

## Response Format
Respond with ONLY valid JSON (no markdown, no explanation). The format must be:
{
  "documentType": "Change Order" | "ASI" | "RFI" | "Invoice" | "Daily Report" | "Submittal" | "Contract" | "Job Cost Report" | "Schedule" | "Other",
  "documentTypeConfidence": 0.95,
  "fields": {
    "fieldName": { "value": "extracted value", "confidence": 0.95 },
    ...
  }
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
  ],
};

// Map extracted document types to Airtable tables
export const DOC_TYPE_TO_TABLE: Record<string, string> = {
  'Change Order': 'CHANGE_ORDERS',
  'ASI': 'DESIGN_CHANGES',
  'RFI': 'DESIGN_CHANGES',
  'Invoice': 'JOB_COSTS',
  'Daily Report': 'DOCUMENTS',
  'Submittal': 'DOCUMENTS',
  'Job Cost Report': 'JOB_COSTS',
  'Contract': 'DOCUMENTS',
  'Schedule': 'DOCUMENTS',
  'Other': 'DOCUMENTS',
};

// Build extraction prompt for a specific document
export function buildExtractionPrompt(sourceText: string, projectId?: string): string {
  const lines: string[] = [];
  lines.push('Extract structured data from the following construction document.');
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

// Compute overall confidence from extracted fields
export function computeOverallConfidence(extraction: ExtractionResult): number {
  const fields = Object.values(extraction.fields);
  if (fields.length === 0) return 0;
  const nonNull = fields.filter((f) => f.value !== null);
  if (nonNull.length === 0) return 0;
  const sum = nonNull.reduce((acc, f) => acc + f.confidence, 0);
  return Math.round((sum / nonNull.length) * 100) / 100;
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
