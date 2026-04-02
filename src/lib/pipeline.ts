// Pipeline types and utilities for document labeling

export type PipelineStatus =
  | 'intake'
  | 'queued'
  | 'processing'
  | 'failed'
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

export type DocumentType = string;

export type ReviewAction = 'approved' | 'rejected' | 'edited';

export interface ExtractedField {
  value: string | number | null;
  confidence: number; // 0-1
}

export interface ExtractionResult {
  documentType: DocumentType;
  documentTypeConfidence: number;
  fields: Record<string, ExtractedField>;
  records?: Array<Record<string, ExtractedField>>;
  targetTables?: Array<{
    table: string;
    records: Array<Record<string, ExtractedField>>;
  }>;
  rawText?: string;
  skillId?: string;
  skillVersion?: number;
  classifierConfidence?: number;
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
    case 'queued':
      return { label: 'Queued', color: 'text-purple-600', bgColor: 'bg-purple-100' };
    case 'processing':
      return { label: 'Processing…', color: 'text-yellow-700', bgColor: 'bg-yellow-100' };
    case 'failed':
      return { label: 'Failed', color: 'text-red-700', bgColor: 'bg-red-100' };
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
