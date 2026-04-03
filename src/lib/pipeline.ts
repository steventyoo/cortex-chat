// Pipeline types and utilities for document labeling
import path from 'path';

// ── Document Categories ────────────────────────────────────────

export interface DefaultCategory {
  key: string;
  label: string;
  priority: 'P1' | 'P2' | 'P3';
  sort_order: number;
  search_keywords: string;
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { key: '01_contract',             label: 'Contract',             priority: 'P1', sort_order: 1,  search_keywords: 'contract,agreement,scope of work,terms' },
  { key: '02_bids_and_estimates',   label: 'Bids and Estimates',   priority: 'P2', sort_order: 2,  search_keywords: 'bid,estimate,proposal,quote,pricing' },
  { key: '03_change_orders',        label: 'Change Orders',        priority: 'P1', sort_order: 3,  search_keywords: 'change order,CO,COR,modification,amendment' },
  { key: '04_rfis',                 label: 'RFIs',                 priority: 'P2', sort_order: 4,  search_keywords: 'rfi,request for information,clarification' },
  { key: '05_submittals',           label: 'Submittals',           priority: 'P3', sort_order: 5,  search_keywords: 'submittal,shop drawing,product data,sample' },
  { key: '06_job_cost_reports',     label: 'Job Cost Reports',     priority: 'P1', sort_order: 6,  search_keywords: 'job cost,cost report,budget,expense,quickbooks' },
  { key: '07_pay_applications',     label: 'Pay Applications',     priority: 'P2', sort_order: 7,  search_keywords: 'pay app,payment application,invoice,billing,AIA' },
  { key: '08_labor_and_timesheets', label: 'Labor and Timesheets', priority: 'P2', sort_order: 8,  search_keywords: 'labor,timesheet,time card,hours,crew,clockshark' },
  { key: '09_material_and_pos',     label: 'Material and POs',     priority: 'P3', sort_order: 9,  search_keywords: 'material,purchase order,PO,supplier,vendor' },
  { key: '10_daily_reports',        label: 'Daily Reports',        priority: 'P3', sort_order: 10, search_keywords: 'daily report,field report,daily log,site report' },
  { key: '11_punch_list',           label: 'Punch List',           priority: 'P3', sort_order: 11, search_keywords: 'punch list,deficiency,snag list,completion' },
  { key: '12_closeout',             label: 'Closeout',             priority: 'P3', sort_order: 12, search_keywords: 'closeout,close out,as-built,final,turnover' },
  { key: '13_warranty',             label: 'Warranty',             priority: 'P3', sort_order: 13, search_keywords: 'warranty,guarantee,defect,maintenance' },
  { key: '14_back_charges',         label: 'Back Charges',         priority: 'P3', sort_order: 14, search_keywords: 'back charge,backcharge,deduction,offset' },
  { key: '15_correspondence',       label: 'Correspondence',       priority: 'P3', sort_order: 15, search_keywords: 'letter,email,correspondence,notice,memo' },
  { key: '16_photos',               label: 'Photos',               priority: 'P3', sort_order: 16, search_keywords: 'photo,image,picture,site photo,progress photo' },
  { key: '17_misc',                 label: 'Miscellaneous',        priority: 'P3', sort_order: 17, search_keywords: 'misc,other,general,uncategorized' },
  // Company-wide (non-project-specific) categories
  { key: '20_financials',           label: 'Company Financials',   priority: 'P2', sort_order: 20, search_keywords: 'P&L,profit and loss,trial balance,AR aging,accounts receivable,financial statement,quickbooks export' },
  { key: '21_bid_log',              label: 'Bid Log',              priority: 'P2', sort_order: 21, search_keywords: 'bid log,bid tracker,bid history,win loss,bid tabulation' },
  { key: '22_gc_contacts',          label: 'GC Contacts',          priority: 'P3', sort_order: 22, search_keywords: 'GC contact,general contractor,PM contact,contact list,vendor list' },
  { key: '23_employee_roster',      label: 'Employee Roster',      priority: 'P3', sort_order: 23, search_keywords: 'employee,roster,crew list,personnel,classification,rate sheet' },
  { key: '24_insurance_and_bonding', label: 'Insurance & Bonding', priority: 'P2', sort_order: 24, search_keywords: 'insurance policy,bonding capacity,COI,surety,claims history,general liability' },
  { key: '25_equipment',            label: 'Equipment',            priority: 'P3', sort_order: 25, search_keywords: 'equipment,tool,vehicle,fleet,rental,utilization,asset' },
];

export const SKILL_TO_CATEGORY_KEY: Record<string, string> = {
  contract:            '01_contract',
  estimate:            '02_bids_and_estimates',
  sub_bid:             '02_bids_and_estimates',
  change_order:        '03_change_orders',
  design_change:       '03_change_orders',
  rfi:                 '04_rfis',
  submittal:           '05_submittals',
  job_cost:            '06_job_cost_reports',
  project_admin:       '07_pay_applications',
  production_activity: '08_labor_and_timesheets',
  daily_report:        '10_daily_reports',
  safety_inspection:   '17_misc',
  financials:          '20_financials',
  bid_log:             '21_bid_log',
  employee_roster:     '23_employee_roster',
  insurance_policy:    '24_insurance_and_bonding',
  equipment:           '25_equipment',
  _general:            '17_misc',
};

export const FOLDER_HINTS: Array<{ pattern: RegExp; categoryKey: string }> = [
  { pattern: /contract/i,                          categoryKey: '01_contract' },
  { pattern: /bids?|estimates?|proposals?/i,        categoryKey: '02_bids_and_estimates' },
  { pattern: /change.?orders?|COR?s?/i,            categoryKey: '03_change_orders' },
  { pattern: /rfis?|request.?for.?info/i,          categoryKey: '04_rfis' },
  { pattern: /submittals?/i,                       categoryKey: '05_submittals' },
  { pattern: /job.?cost|cost.?report|quickbooks/i,  categoryKey: '06_job_cost_reports' },
  { pattern: /pay.?app|billing|invoice/i,          categoryKey: '07_pay_applications' },
  { pattern: /labor|timesheet|time.?card/i,        categoryKey: '08_labor_and_timesheets' },
  { pattern: /material|purchase.?order|POs?/i,     categoryKey: '09_material_and_pos' },
  { pattern: /daily.?report|field.?report/i,       categoryKey: '10_daily_reports' },
  { pattern: /punch.?list/i,                       categoryKey: '11_punch_list' },
  { pattern: /closeout|close.?out|as.?built/i,     categoryKey: '12_closeout' },
  { pattern: /warranty/i,                          categoryKey: '13_warranty' },
  { pattern: /back.?charge/i,                      categoryKey: '14_back_charges' },
  { pattern: /correspondence|letters?|memos?/i,    categoryKey: '15_correspondence' },
  { pattern: /photos?|images?|pictures?/i,         categoryKey: '16_photos' },
  // Company-wide folder hints
  { pattern: /quickbooks|financials?|P.?L|trial.?balance|AR.?aging/i, categoryKey: '20_financials' },
  { pattern: /bid.?log|bid.?track|win.?loss/i,    categoryKey: '21_bid_log' },
  { pattern: /GC.?contact|contractor.?list/i,      categoryKey: '22_gc_contacts' },
  { pattern: /employee|roster|personnel|crew.?list/i, categoryKey: '23_employee_roster' },
  { pattern: /insurance.?and.?bond|bonding.?capacity|policies/i, categoryKey: '24_insurance_and_bonding' },
  { pattern: /equipment|fleet|tool.?list|asset.?list/i, categoryKey: '25_equipment' },
];

export function matchFolderHint(folderName: string): string | null {
  for (const hint of FOLDER_HINTS) {
    if (hint.pattern.test(folderName)) return hint.categoryKey;
  }
  return null;
}

export function resolveCategoryKey(skillId: string | null, folderName?: string | null): string {
  if (folderName) {
    const hintKey = matchFolderHint(folderName);
    if (hintKey) return hintKey;
  }
  if (skillId && SKILL_TO_CATEGORY_KEY[skillId]) {
    return SKILL_TO_CATEGORY_KEY[skillId];
  }
  return '17_misc';
}

export function generateCanonicalName(
  clientCode: string,
  skillId: string,
  dateStr: string | null,
  originalFileName: string
): string {
  const ext = path.extname(originalFileName).toLowerCase() || '.pdf';
  const descriptor = skillId.replace(/[^a-z0-9_]/gi, '_');
  const datePart = dateStr || new Date().toISOString().slice(0, 10);
  const code = clientCode.toUpperCase();
  return `DATA_${code}_${descriptor}_${datePart}${ext}`;
}

export function generateClientCode(orgName: string): string {
  const words = orgName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'ORG';
  if (words.length === 1) return words[0].substring(0, 6).toUpperCase();
  const stopWords = new Set(['the', 'and', 'of', 'for', 'inc', 'llc', 'ltd', 'co', 'corp']);
  const meaningful = words.filter(w => !stopWords.has(w.toLowerCase()));
  if (meaningful.length === 0) return words[0].substring(0, 6).toUpperCase();
  if (meaningful.length === 1) return meaningful[0].substring(0, 6).toUpperCase();
  return meaningful.map(w => w[0]).join('').substring(0, 5).toUpperCase();
}

export type PipelineStatus =
  | 'intake'
  | 'queued'
  | 'processing'
  | 'failed'
  | 'stored_only'
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
  id: string;
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
  driveFileId: string | null;
  driveWebViewLink: string | null;
  driveFolderPath: string | null;
  driveModifiedTime: string | null;
  storagePath: string | null;
  isLatestVersion: boolean;
  categoryId: string | null;
  canonicalName: string | null;
  pageCount: number | null;
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
    case 'stored_only':
      return { label: 'Stored (Large Doc)', color: 'text-indigo-700', bgColor: 'bg-indigo-100' };
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
    driveFileId: f['Drive File ID'] ? String(f['Drive File ID']) : null,
    driveWebViewLink: f['Drive Web View Link'] ? String(f['Drive Web View Link']) : null,
    driveFolderPath: f['Drive Folder Path'] ? String(f['Drive Folder Path']) : null,
    driveModifiedTime: f['Drive Modified Time'] ? String(f['Drive Modified Time']) : null,
    storagePath: f['Storage Path'] ? String(f['Storage Path']) : null,
    isLatestVersion: f['Is Latest Version'] !== false,
    categoryId: f['Category ID'] ? String(f['Category ID']) : null,
    canonicalName: f['Canonical Name'] ? String(f['Canonical Name']) : null,
    pageCount: f['Page Count'] != null ? Number(f['Page Count']) : null,
  };
}
