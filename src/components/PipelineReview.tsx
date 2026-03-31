'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PipelineItem,
  getStatusDisplay,
  getConfidenceIndicator,
  getConfidenceColor,
} from '@/lib/pipeline';

const PdfViewer = dynamic(() => import('./PdfViewer'), { ssr: false });

type ViewMode = 'list' | 'review';

const MONEY_FIELDS = ['budget', 'actual', 'variance', 'cost', 'amount', 'total', 'jtd', 'job to date', 'price', 'value', 'subtotal', 'proposed', 'approved amount', 'labor', 'material', 'ohp', 'revenue', 'expense'];
const PERCENT_FIELDS = ['percent', 'complete', 'pct', 'rate', 'ratio', 'ohp rate'];

interface SkillFieldDef {
  name: string;
  type: 'string' | 'number' | 'date' | 'enum' | 'boolean' | 'array';
  tier: 1 | 2 | 3;
  required: boolean;
  description: string;
  options?: string[];
}

interface SkillData {
  skill_id: string;
  display_name: string;
  field_definitions: SkillFieldDef[];
  version: number;
}

interface SkillListItem {
  skill_id: string;
  display_name: string;
}

function formatFieldValue(fieldName: string, value: string | number | null): string {
  if (value == null) return '';
  const str = String(value);
  const lower = fieldName.toLowerCase();

  // Check if it's a money field
  const isMoney = MONEY_FIELDS.some((kw) => lower.includes(kw));
  if (isMoney) {
    const num = parseFloat(str.replace(/[,$\s]/g, ''));
    if (!isNaN(num)) {
      const isNegative = num < 0;
      const abs = Math.abs(num);
      const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return isNegative ? `-$${formatted}` : `$${formatted}`;
    }
  }

  // Check if it's a percent field
  const isPercent = PERCENT_FIELDS.some((kw) => lower.includes(kw));
  if (isPercent) {
    const num = parseFloat(str);
    if (!isNaN(num)) return `${num}%`;
  }

  return str;
}

// Format values for display in the line items table
function formatCellValue(fieldName: string, value: string | number | null): string {
  if (value == null) return '—';
  return formatFieldValue(fieldName, value) || String(value);
}

function inferFieldType(value: string | number | null): SkillFieldDef['type'] {
  if (value == null) return 'string';
  if (typeof value === 'number') return 'number';
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return 'date';
  const cleaned = str.replace(/[,$\s%]/g, '');
  if (!isNaN(Number(cleaned)) && cleaned.length > 0) return 'number';
  return 'string';
}

interface PipelineStats {
  total: number;
  pendingReview: number;
  approved: number;
  rejected: number;
  flagged: number;
  processing: number;
}

export default function PipelineReview() {
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedItem, setSelectedItem] = useState<PipelineItem | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Upload state
  const [showUpload, setShowUpload] = useState(false);
  const [uploadText, setUploadText] = useState('');
  const [uploadProjectId, setUploadProjectId] = useState('');
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadMode, setUploadMode] = useState<'file' | 'text'>('file');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Project list for upload dropdown
  const [projectOptions, setProjectOptions] = useState<Array<{ projectId: string; projectName: string }>>([]);

  // Review state
  const [reviewAction, setReviewAction] = useState<string>('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [editedFields, setEditedFields] = useState<Record<string, string>>({});
  const [submittingReview, setSubmittingReview] = useState(false);

  // Test mode — approvals won't push to real Airtable tables
  const [testMode, setTestMode] = useState(false);

  // Drive scan state
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Mark as pushed state
  const [markingPushedId, setMarkingPushedId] = useState<string | null>(null);

  // Skill-driven field definitions for the review form
  const [skillData, setSkillData] = useState<SkillData | null>(null);
  const [allSkills, setAllSkills] = useState<SkillListItem[]>([]);
  const [loadingSkill, setLoadingSkill] = useState(false);

  // New document type creation state
  const [showNewTypeFlow, setShowNewTypeFlow] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [reclassifySkillId, setReclassifySkillId] = useState('');
  const [savingNewType, setSavingNewType] = useState(false);

  // Add/remove field state
  const [showAddField, setShowAddField] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<string>('string');
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [savingField, setSavingField] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/pipeline/list');
      if (res.ok) {
        const data = await res.json();
        setItems(data.items);
        setStats(data.stats);
      }
    } catch (err) {
      console.error('Failed to fetch pipeline items:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    fetch('/api/skills').then(r => r.json()).then(d => {
      if (d.skills) {
        setAllSkills(d.skills.map((s: SkillData) => ({
          skill_id: s.skill_id,
          display_name: s.display_name,
        })));
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(d => {
      if (d.projects) {
        setProjectOptions(d.projects.map((p: { projectId: string; projectName: string }) => ({
          projectId: p.projectId,
          projectName: p.projectName,
        })));
      }
    }).catch(() => {});
  }, []);

  const fetchSkillForItem = useCallback(async (item: PipelineItem) => {
    const extraction = item.extractedData;
    if (!extraction) return;

    const skillId = extraction.skillId
      || extraction.documentType?.toLowerCase().replace(/\s+/g, '_')
      || '_general';

    setLoadingSkill(true);
    try {
      const res = await fetch(`/api/skills/${skillId}`);
      if (res.ok) {
        const data = await res.json();
        setSkillData(data.skill);
      } else {
        setSkillData(null);
      }
    } catch {
      setSkillData(null);
    } finally {
      setLoadingSkill(false);
    }
  }, []);

  const handleAddField = async () => {
    if (!newFieldName.trim() || !skillData) return;
    setSavingField(true);

    const newField: SkillFieldDef = {
      name: newFieldName.trim(),
      type: newFieldType as SkillFieldDef['type'],
      tier: 2,
      required: newFieldRequired,
      description: '',
    };

    try {
      const res = await fetch(`/api/skills/${skillData.skill_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addFields: [newField] }),
      });
      if (res.ok) {
        const data = await res.json();
        setSkillData(data.skill);
        setEditedFields(prev => ({ ...prev, [newField.name]: '' }));
        setNewFieldName('');
        setNewFieldType('string');
        setNewFieldRequired(false);
        setShowAddField(false);
      }
    } catch (err) {
      console.error('Failed to add field:', err);
    } finally {
      setSavingField(false);
    }
  };

  const handleRemoveField = async (fieldName: string) => {
    if (!skillData) return;
    if (!confirm(`Remove "${fieldName}" from this document type?`)) return;

    try {
      const res = await fetch(`/api/skills/${skillData.skill_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeFields: [fieldName] }),
      });
      if (res.ok) {
        const data = await res.json();
        setSkillData(data.skill);
        setEditedFields(prev => {
          const next = { ...prev };
          delete next[fieldName];
          return next;
        });
      }
    } catch (err) {
      console.error('Failed to remove field:', err);
    }
  };

  const handleCreateNewType = async () => {
    if (!newTypeName.trim() || !selectedItem?.extractedData) return;
    setSavingNewType(true);

    const fields = selectedItem.extractedData.fields;
    if (!fields) { setSavingNewType(false); return; }
    const fieldDefs: SkillFieldDef[] = Object.entries(fields).map(([name, data]) => ({
      name,
      type: inferFieldType(data.value),
      tier: 2 as const,
      required: data.confidence >= 0.8,
      description: '',
    }));

    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skillId: newTypeName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
          displayName: newTypeName.trim(),
          fieldDefinitions: fieldDefs,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setSkillData(data.skill);
        setShowNewTypeFlow(false);
        setNewTypeName('');
        setAllSkills(prev => [...prev, {
          skill_id: data.skill.skill_id,
          display_name: data.skill.display_name,
        }]);
      } else {
        const err = await res.json();
        alert(`Failed to create type: ${err.error}`);
      }
    } catch (err) {
      console.error('Failed to create new type:', err);
    } finally {
      setSavingNewType(false);
    }
  };

  const handleReclassify = async () => {
    if (!reclassifySkillId || !selectedItem) return;
    try {
      const res = await fetch(`/api/skills/${reclassifySkillId}`);
      if (res.ok) {
        const data = await res.json();
        setSkillData(data.skill);
        setShowNewTypeFlow(false);
        setReclassifySkillId('');
      }
    } catch (err) {
      console.error('Failed to reclassify:', err);
    }
  };

  const handleUpload = async () => {
    if (uploadMode === 'file' && !uploadFile) return;
    if (uploadMode === 'text' && !uploadText.trim()) return;
    setUploading(true);

    try {
      let res: Response;

      if (uploadMode === 'file' && uploadFile) {
        const formData = new FormData();
        formData.append('file', uploadFile);
        if (uploadProjectId) formData.append('projectId', uploadProjectId);
        if (uploadFileName) formData.append('fileName', uploadFileName);

        res = await fetch('/api/pipeline/upload', {
          method: 'POST',
          body: formData,
        });
      } else {
        res = await fetch('/api/pipeline/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceText: uploadText,
            projectId: uploadProjectId || undefined,
            fileName: uploadFileName || 'Pasted Document',
          }),
        });
      }

      if (res.ok) {
        setShowUpload(false);
        setUploadText('');
        setUploadFileName('');
        setUploadProjectId('');
        setUploadFile(null);
        setUploadMode('file');
        await fetchItems();
      } else {
        const err = await res.json();
        alert(`Extraction failed: ${err.error}`);
      }
    } catch (err) {
      console.error('Upload error:', err);
      alert(`Failed to process document: ${err instanceof Error ? err.message : 'Network error'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleScanDrive = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch('/api/pipeline/scan-drive');
      const data = await res.json();
      if (res.ok) {
        const processed = data.processed?.length || 0;
        const remaining = data.remainingNewFiles || 0;
        setScanResult(
          processed > 0
            ? `Found ${processed} new file${processed > 1 ? 's' : ''}${remaining > 0 ? ` (${remaining} more queued)` : ''}`
            : data.message || 'No new files found'
        );
        if (processed > 0) await fetchItems();
      } else {
        setScanResult(data.error ? `${data.error}${data.hint ? ` — ${data.hint}` : ''}` : 'Scan failed');
      }
    } catch (err) {
      console.error('Drive scan error:', err);
      setScanResult('Failed to connect to Drive');
    } finally {
      setScanning(false);
      // Clear result after 5 seconds
      setTimeout(() => setScanResult(null), 5000);
    }
  };

  const handleDelete = async (recordId: string, fileName: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Don't open review view
    if (!confirm(`Delete "${fileName}" from the pipeline?`)) return;
    setDeletingId(recordId);
    try {
      const res = await fetch('/api/pipeline/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId }),
      });
      if (res.ok) {
        await fetchItems();
      } else {
        const err = await res.json();
        alert(`Delete failed: ${err.error}`);
      }
    } catch (err) {
      console.error('Delete error:', err);
      alert('Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  const handleMarkAsPushed = async (recordId: string, fileName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Mark "${fileName}" as already pushed to Airtable?\n\nThis means the data from this file is already in your database — no new records will be created.`)) return;
    setMarkingPushedId(recordId);
    try {
      const res = await fetch('/api/pipeline/mark-pushed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId }),
      });
      if (res.ok) {
        await fetchItems();
      } else {
        const err = await res.json();
        alert(`Failed: ${err.error}`);
      }
    } catch (err) {
      console.error('Mark pushed error:', err);
      alert('Failed to update');
    } finally {
      setMarkingPushedId(null);
    }
  };

  const handleReview = async () => {
    if (!selectedItem || !reviewAction) return;
    setSubmittingReview(true);

    try {
      const body: Record<string, unknown> = {
        recordId: selectedItem.id,
        action: reviewAction,
        reviewer: 'Admin',
        notes: reviewNotes,
        testMode,
      };

      if (reviewAction === 'rejected') {
        body.rejectionReason = rejectionReason;
      }

      if (reviewAction === 'edited' || (reviewAction === 'approved' && Object.keys(editedFields).length > 0)) {
        body.action = Object.keys(editedFields).length > 0 ? 'edited' : 'approved';
        body.editedFields = editedFields;
      }

      const res = await fetch('/api/pipeline/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const result = await res.json();
        if (result.alreadyPushed) {
          alert('⚠️ This file was already pushed to Airtable. Marked as approved but no duplicate data was created.');
        }
        setViewMode('list');
        setSelectedItem(null);
        setReviewAction('');
        setReviewNotes('');
        setRejectionReason('');
        setEditedFields({});
        await fetchItems();
      }
    } catch (err) {
      console.error('Review error:', err);
    } finally {
      setSubmittingReview(false);
    }
  };

  const openReview = (item: PipelineItem) => {
    setSelectedItem(item);
    setViewMode('review');
    setReviewAction('');
    setReviewNotes('');
    setRejectionReason('');
    setShowNewTypeFlow(false);
    setShowAddField(false);
    setSkillData(null);

    if (item.extractedData) {
      const fields: Record<string, string> = {};
      if (item.extractedData.fields) {
        for (const [key, val] of Object.entries(item.extractedData.fields)) {
          fields[key] = val.value != null ? formatFieldValue(key, val.value) : '';
        }
      }
      setEditedFields(fields);

      fetchSkillForItem(item);

      const isLowConfidence = (item.extractedData.classifierConfidence ?? 1) < 0.5
        || item.extractedData.skillId === '_general';
      if (isLowConfidence) {
        setShowNewTypeFlow(true);
      }
    }
  };

  const filteredItems = items.filter((item) => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'needs_action') {
      return item.status === 'pending_review' || item.status === 'tier2_flagged';
    }
    if (filterStatus === 'approved') {
      return item.status === 'approved' || item.status === 'pushed';
    }
    return item.status === filterStatus;
  });

  // ─── REVIEW VIEW ───────────────────────────────────────────
  if (viewMode === 'review' && selectedItem) {
    const extraction = selectedItem.extractedData;
    const flags = selectedItem.validationFlags;

    return (
      <div className="h-full flex flex-col bg-white">
        {/* Review header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[#e8e8e8]">
          <button
            onClick={() => { setViewMode('list'); setSelectedItem(null); }}
            className="p-1.5 rounded-lg hover:bg-[#f0f0f0] text-[#999] hover:text-[#1a1a1a] transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1">
            <h2 className="text-[15px] font-semibold text-[#1a1a1a]">{selectedItem.fileName}</h2>
            <p className="text-[12px] text-[#999]">
              {selectedItem.pipelineId} · {extraction?.documentType || 'Unknown type'}
            </p>
          </div>
          <StatusBadge status={selectedItem.status} />
        </div>

        {/* Review content — two panels */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Source document (wider) */}
          <div className="flex-[3] min-w-0 border-r border-[#e8e8e8] flex flex-col">
            <div className="px-4 py-3 bg-[#f7f7f5] border-b border-[#e8e8e8]">
              <h3 className="text-[13px] font-semibold text-[#37352f]">Source Document</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <SourceDocumentView
                text={selectedItem.sourceText || ''}
                fileName={selectedItem.fileName}
                fileUrl={selectedItem.fileUrl}
              />
            </div>
          </div>

          {/* Right: Extracted data + review actions (narrower) */}
          <div className="flex-[2] min-w-[320px] max-w-[420px] flex flex-col">
            <div className="px-4 py-3 bg-[#f7f7f5] border-b border-[#e8e8e8] flex items-center gap-2">
              <h3 className="text-[13px] font-semibold text-[#37352f]">Extracted Data</h3>
              {selectedItem.overallConfidence != null && (
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${getConfidenceColor(selectedItem.overallConfidence)}`}>
                  {Math.round(selectedItem.overallConfidence * 100)}% confidence
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {/* Flags */}
              {flags.length > 0 && (
                <div className="mb-4">
                  <p className="text-[11px] font-semibold text-[#999] uppercase tracking-wider mb-2">Flags</p>
                  <div className="space-y-1.5">
                    {flags.map((flag, i) => (
                      <div
                        key={i}
                        className={`text-[12px] px-3 py-2 rounded-lg ${
                          flag.severity === 'error'
                            ? 'bg-red-50 text-red-700'
                            : flag.severity === 'warning'
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-blue-50 text-blue-700'
                        }`}
                      >
                        <span className="font-medium">{flag.field}:</span> {flag.issue}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Document type + reclassify/create flow */}
              {extraction && (
                <div className="mb-4">
                  <p className="text-[11px] font-semibold text-[#999] uppercase tracking-wider mb-2">Document Type</p>
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-[#1a1a1a]">{skillData?.display_name || extraction.documentType}</span>
                    <span className="text-[12px] text-[#999]">
                      {getConfidenceIndicator(extraction.documentTypeConfidence)}
                    </span>
                    {!showNewTypeFlow && (
                      <button
                        onClick={() => setShowNewTypeFlow(true)}
                        className="ml-auto text-[11px] text-[#007aff] hover:underline"
                      >
                        Change type
                      </button>
                    )}
                  </div>

                  {showNewTypeFlow && (
                    <div className="mt-3 p-3 rounded-lg border border-amber-200 bg-amber-50/50 space-y-3">
                      <p className="text-[12px] font-medium text-amber-800">
                        {(extraction.classifierConfidence ?? 1) < 0.5
                          ? "We couldn't confidently identify this document type."
                          : 'Select the correct type or create a new one.'}
                      </p>

                      <div>
                        <label className="text-[11px] font-medium text-[#555] block mb-1">Reclassify as existing type</label>
                        <div className="flex gap-2">
                          <select
                            value={reclassifySkillId}
                            onChange={(e) => setReclassifySkillId(e.target.value)}
                            className="flex-1 px-2 py-1.5 rounded-lg border border-[#e0e0e0] text-[12px]"
                          >
                            <option value="">Select type...</option>
                            {allSkills.filter(s => s.skill_id !== '_general').map(s => (
                              <option key={s.skill_id} value={s.skill_id}>{s.display_name}</option>
                            ))}
                          </select>
                          <button
                            onClick={handleReclassify}
                            disabled={!reclassifySkillId}
                            className="px-3 py-1.5 rounded-lg bg-[#1a1a1a] text-white text-[12px] font-medium disabled:opacity-40"
                          >
                            Apply
                          </button>
                        </div>
                      </div>

                      <div className="border-t border-amber-200 pt-3">
                        <label className="text-[11px] font-medium text-[#555] block mb-1">Or create new type</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={newTypeName}
                            onChange={(e) => setNewTypeName(e.target.value)}
                            placeholder="e.g. Permit Application"
                            className="flex-1 px-2 py-1.5 rounded-lg border border-[#e0e0e0] text-[12px]"
                          />
                          <button
                            onClick={handleCreateNewType}
                            disabled={!newTypeName.trim() || savingNewType}
                            className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-[12px] font-medium disabled:opacity-40"
                          >
                            {savingNewType ? 'Creating...' : 'Create'}
                          </button>
                        </div>
                      </div>

                      <button
                        onClick={() => setShowNewTypeFlow(false)}
                        className="text-[11px] text-[#999] hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Editable fields — driven by skill field_definitions when available */}
              {extraction && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] font-semibold text-[#999] uppercase tracking-wider">Fields</p>
                    <button
                      onClick={() => setShowAddField(!showAddField)}
                      className="text-[11px] text-[#007aff] hover:underline"
                    >
                      {showAddField ? 'Cancel' : '+ Add field'}
                    </button>
                  </div>

                  {showAddField && (
                    <div className="mb-3 p-3 rounded-lg border border-blue-200 bg-blue-50/50 space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newFieldName}
                          onChange={(e) => setNewFieldName(e.target.value)}
                          placeholder="Field name"
                          className="flex-1 px-2 py-1.5 rounded-lg border border-[#e0e0e0] text-[12px]"
                        />
                        <select
                          value={newFieldType}
                          onChange={(e) => setNewFieldType(e.target.value)}
                          className="px-2 py-1.5 rounded-lg border border-[#e0e0e0] text-[12px]"
                        >
                          <option value="string">Text</option>
                          <option value="number">Number</option>
                          <option value="date">Date</option>
                          <option value="boolean">Yes/No</option>
                          <option value="enum">Dropdown</option>
                        </select>
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-1.5 text-[11px] text-[#555]">
                          <input
                            type="checkbox"
                            checked={newFieldRequired}
                            onChange={(e) => setNewFieldRequired(e.target.checked)}
                            className="rounded"
                          />
                          Required
                        </label>
                        <button
                          onClick={handleAddField}
                          disabled={!newFieldName.trim() || savingField}
                          className="px-3 py-1 rounded-lg bg-[#1a1a1a] text-white text-[11px] font-medium disabled:opacity-40"
                        >
                          {savingField ? 'Adding...' : 'Add'}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    {(() => {
                      const fieldDefs = skillData?.field_definitions;
                      const fieldEntries = Object.entries(extraction.fields || {});

                      if (fieldDefs && fieldDefs.length > 0) {
                        const extractedFieldNames = new Set(fieldEntries.map(([k]) => k));
                        const allFields = [
                          ...fieldDefs.map(fd => ({
                            name: fd.name,
                            def: fd,
                            extracted: extraction.fields?.[fd.name] || null,
                          })),
                          ...fieldEntries
                            .filter(([k]) => !fieldDefs.some(fd => fd.name === k))
                            .map(([k, v]) => ({ name: k, def: null as SkillFieldDef | null, extracted: v })),
                        ];

                        return allFields.map(({ name: fieldName, def, extracted }) => {
                          const confidence = extracted?.confidence ?? 0;
                          const isEnum = def?.type === 'enum' && def.options && def.options.length > 0;
                          const isBoolean = def?.type === 'boolean';

                          return (
                            <div key={fieldName} className="flex items-start gap-2 group">
                              <div className="flex-1">
                                <label className="flex items-center gap-1.5 text-[12px] font-medium text-[#555] mb-1">
                                  {fieldName}
                                  {def?.required && <span className="text-red-400 text-[10px]">*</span>}
                                  <span className="text-[10px]">
                                    {extracted ? getConfidenceIndicator(confidence) : ''}
                                  </span>
                                  {def?.description && (
                                    <span className="text-[10px] text-[#bbb] truncate max-w-[120px]" title={def.description}>
                                      {def.description}
                                    </span>
                                  )}
                                </label>
                                {isEnum ? (
                                  <select
                                    value={editedFields[fieldName] ?? ''}
                                    onChange={(e) => setEditedFields({ ...editedFields, [fieldName]: e.target.value })}
                                    className={`w-full px-3 py-1.5 rounded-lg border text-[13px] transition-colors ${
                                      confidence < 0.7 ? 'border-red-200 bg-red-50/50'
                                        : confidence < 0.9 ? 'border-amber-200 bg-amber-50/50'
                                        : 'border-[#e0e0e0] bg-white'
                                    } focus:outline-none focus:ring-2 focus:ring-[#007aff]/30 focus:border-[#007aff]`}
                                  >
                                    <option value="">— Select —</option>
                                    {def!.options!.map((opt) => (
                                      <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                  </select>
                                ) : isBoolean ? (
                                  <select
                                    value={editedFields[fieldName] ?? ''}
                                    onChange={(e) => setEditedFields({ ...editedFields, [fieldName]: e.target.value })}
                                    className="w-full px-3 py-1.5 rounded-lg border border-[#e0e0e0] bg-white text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/30"
                                  >
                                    <option value="">— Select —</option>
                                    <option value="true">Yes</option>
                                    <option value="false">No</option>
                                  </select>
                                ) : (
                                  <input
                                    type={def?.type === 'date' ? 'date' : def?.type === 'number' ? 'number' : 'text'}
                                    value={editedFields[fieldName] ?? ''}
                                    onChange={(e) => setEditedFields({ ...editedFields, [fieldName]: e.target.value })}
                                    className={`w-full px-3 py-1.5 rounded-lg border text-[13px] transition-colors ${
                                      confidence < 0.7 ? 'border-red-200 bg-red-50/50'
                                        : confidence < 0.9 ? 'border-amber-200 bg-amber-50/50'
                                        : 'border-[#e0e0e0] bg-white'
                                    } focus:outline-none focus:ring-2 focus:ring-[#007aff]/30 focus:border-[#007aff]`}
                                  />
                                )}
                              </div>
                              <button
                                onClick={() => handleRemoveField(fieldName)}
                                className="mt-6 p-1 rounded text-[#ddd] hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                                title={`Remove ${fieldName}`}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                  <path d="M18 6L6 18M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          );
                        });
                      }

                      return fieldEntries.map(([fieldName, fieldData]) => (
                        <div key={fieldName} className="flex items-start gap-2 group">
                          <div className="flex-1">
                            <label className="flex items-center gap-1.5 text-[12px] font-medium text-[#555] mb-1">
                              {fieldName}
                              <span className="text-[10px]">
                                {getConfidenceIndicator(fieldData.confidence)}
                              </span>
                            </label>
                            <input
                              type="text"
                              value={editedFields[fieldName] ?? ''}
                              onChange={(e) => setEditedFields({ ...editedFields, [fieldName]: e.target.value })}
                              className={`w-full px-3 py-1.5 rounded-lg border text-[13px] transition-colors ${
                                fieldData.confidence < 0.7 ? 'border-red-200 bg-red-50/50'
                                  : fieldData.confidence < 0.9 ? 'border-amber-200 bg-amber-50/50'
                                  : 'border-[#e0e0e0] bg-white'
                              } focus:outline-none focus:ring-2 focus:ring-[#007aff]/30 focus:border-[#007aff]`}
                            />
                          </div>
                          <button
                            onClick={() => handleRemoveField(fieldName)}
                            className="mt-6 p-1 rounded text-[#ddd] hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                            title={`Remove ${fieldName}`}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                              <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              )}

              {/* Multi-record line items */}
              {extraction?.records && extraction.records.length > 0 && (
                <div className="mb-4">
                  <p className="text-[11px] font-semibold text-[#999] uppercase tracking-wider mb-2">
                    Line Items ({extraction.records.length} records → {extraction.documentType === 'Change Order' ? 'CHANGE_ORDERS' : 'JOB_COSTS'})
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-[#e0e0e0]">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="bg-[#f7f7f5]">
                          <th className="px-2 py-1.5 text-left font-semibold text-[#555] border-b border-[#e0e0e0]">#</th>
                          {Object.keys(extraction.records[0]).map((key) => (
                            <th key={key} className="px-2 py-1.5 text-left font-semibold text-[#555] border-b border-[#e0e0e0] whitespace-nowrap">{key}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {extraction.records.map((rec, idx) => (
                          <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'}>
                            <td className="px-2 py-1 text-[#999] border-b border-[#f0f0f0]">{idx + 1}</td>
                            {Object.entries(rec).map(([key, val]) => (
                              <td key={key} className="px-2 py-1 border-b border-[#f0f0f0] whitespace-nowrap">
                                <span className={val.confidence < 0.7 ? 'text-red-600' : val.confidence < 0.9 ? 'text-amber-600' : 'text-[#1a1a1a]'}>
                                  {formatCellValue(key, val.value)}
                                </span>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Additional target table records (e.g., PRODUCTION) */}
              {extraction?.targetTables && extraction.targetTables.map((tt, ttIdx) => (
                tt.records && tt.records.length > 0 && (
                  <div key={ttIdx} className="mb-4">
                    <p className="text-[11px] font-semibold text-[#999] uppercase tracking-wider mb-2">
                      {tt.table} ({tt.records.length} records)
                    </p>
                    <div className="overflow-x-auto rounded-lg border border-[#e0e0e0]">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="bg-[#f7f7f5]">
                            <th className="px-2 py-1.5 text-left font-semibold text-[#555] border-b border-[#e0e0e0]">#</th>
                            {Object.keys(tt.records[0]).map((key) => (
                              <th key={key} className="px-2 py-1.5 text-left font-semibold text-[#555] border-b border-[#e0e0e0] whitespace-nowrap">{key}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {tt.records.map((rec, idx) => (
                            <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'}>
                              <td className="px-2 py-1 text-[#999] border-b border-[#f0f0f0]">{idx + 1}</td>
                              {Object.entries(rec).map(([key, val]) => (
                                <td key={key} className="px-2 py-1 border-b border-[#f0f0f0] whitespace-nowrap">
                                  <span className={val.confidence < 0.7 ? 'text-red-600' : val.confidence < 0.9 ? 'text-amber-600' : 'text-[#1a1a1a]'}>
                                    {formatCellValue(key, val.value)}
                                  </span>
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              ))}

              {/* Review actions */}
              <div className="border-t border-[#e8e8e8] pt-4 mt-4">
                <p className="text-[11px] font-semibold text-[#999] uppercase tracking-wider mb-3">Review Decision</p>

                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => setReviewAction('approved')}
                    className={`flex-1 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                      reviewAction === 'approved'
                        ? 'bg-green-500 text-white'
                        : 'bg-green-50 text-green-700 hover:bg-green-100'
                    }`}
                  >
                    ✅ Approve
                  </button>
                  <button
                    onClick={() => setReviewAction('rejected')}
                    className={`flex-1 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                      reviewAction === 'rejected'
                        ? 'bg-red-500 text-white'
                        : 'bg-red-50 text-red-700 hover:bg-red-100'
                    }`}
                  >
                    ❌ Reject
                  </button>
                </div>

                {reviewAction === 'rejected' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mb-3"
                  >
                    <input
                      type="text"
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      placeholder="Reason for rejection..."
                      className="w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/30"
                    />
                  </motion.div>
                )}

                <textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Review notes (optional)..."
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] mb-3 resize-none focus:outline-none focus:ring-2 focus:ring-[#007aff]/30"
                />

                {testMode && reviewAction === 'approved' && (
                  <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[12px] text-amber-800">
                    🧪 Test mode — this approval will NOT push data to Airtable
                  </div>
                )}

                <button
                  onClick={handleReview}
                  disabled={!reviewAction || submittingReview}
                  className="w-full py-2.5 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {submittingReview ? (
                    <>
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                        <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      Processing...
                    </>
                  ) : (
                    `Submit ${reviewAction === 'approved' ? 'Approval' : reviewAction === 'rejected' ? 'Rejection' : 'Review'}${testMode && reviewAction !== 'rejected' ? ' (Test)' : ''}`
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── LIST VIEW ─────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="px-6 py-5 border-b border-[#e8e8e8]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-[20px] font-bold text-[#1a1a1a] tracking-tight">Document Pipeline</h1>
            <p className="text-[13px] text-[#999] mt-0.5">Extract, validate, and approve construction documents</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Test mode toggle */}
            <button
              onClick={() => setTestMode(!testMode)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                testMode
                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                  : 'bg-[#f0f0f0] text-[#999] hover:bg-[#e8e8e8]'
              }`}
              title={testMode ? 'Test mode ON — approvals will NOT push to Airtable' : 'Test mode OFF — approvals WILL push to real data'}
            >
              <div className={`w-7 h-4 rounded-full relative transition-colors ${testMode ? 'bg-amber-400' : 'bg-[#ccc]'}`}>
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${testMode ? 'left-3.5' : 'left-0.5'}`} />
              </div>
              Test
            </button>

            {/* Scan Drive button */}
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleScanDrive}
              disabled={scanning}
              className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[#e0e0e0] text-[13px] font-medium text-[#555] hover:bg-[#f7f7f5] transition-colors disabled:opacity-50"
              title="Scan Google Drive for new documents"
            >
              <svg className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {scanning ? (
                  <>
                    <circle cx="12" cy="12" r="10" className="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" />
                  </>
                ) : (
                  <>
                    <path d="M1 4v6h6" />
                    <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
                  </>
                )}
              </svg>
              {scanning ? 'Scanning...' : 'Scan Drive'}
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => setShowUpload(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5V19M5 12H19" />
              </svg>
              New Document
            </motion.button>
          </div>
        </div>

        {/* Stats bar */}
        {stats && (
          <div className="flex gap-4">
            <StatPill label="Pending Review" value={stats.pendingReview} color="blue" onClick={() => setFilterStatus('pending_review')} active={filterStatus === 'pending_review'} />
            <StatPill label="Flagged" value={stats.flagged} color="red" onClick={() => setFilterStatus('tier2_flagged')} active={filterStatus === 'tier2_flagged'} />
            <StatPill label="Approved" value={stats.approved} color="green" onClick={() => setFilterStatus('approved')} active={filterStatus === 'approved'} />
            <StatPill label="Rejected" value={stats.rejected} color="gray" onClick={() => setFilterStatus('rejected')} active={filterStatus === 'rejected'} />
            <StatPill label="All" value={stats.total} color="slate" onClick={() => setFilterStatus('all')} active={filterStatus === 'all'} />
          </div>
        )}
      </div>

      {/* Test mode banner */}
      {testMode && (
        <div className="px-6 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
          <span className="text-[13px]">🧪</span>
          <span className="text-[12px] font-medium text-amber-800">
            Test Mode — approvals will NOT push data to Airtable tables. Toggle off when ready for production.
          </span>
        </div>
      )}

      {/* Scan result notification */}
      <AnimatePresence>
        {scanResult && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-6 py-2.5 bg-blue-50 border-b border-blue-200 flex items-center gap-2"
          >
            <span className="text-[13px]">📂</span>
            <span className="text-[12px] font-medium text-blue-800">{scanResult}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Upload modal */}
      <AnimatePresence>
        {showUpload && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowUpload(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-4 border-b border-[#e8e8e8]">
                <h2 className="text-[16px] font-semibold text-[#1a1a1a]">Submit Document for Processing</h2>
                <p className="text-[13px] text-[#999] mt-0.5">
                  Upload a file or paste document text. AI will extract and classify the data.
                </p>
              </div>

              <div className="p-6 space-y-4">
                {/* Mode toggle */}
                <div className="flex gap-1 p-0.5 bg-[#f5f5f5] rounded-lg w-fit">
                  <button
                    onClick={() => setUploadMode('file')}
                    className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                      uploadMode === 'file'
                        ? 'bg-white text-[#1a1a1a] shadow-sm'
                        : 'text-[#999] hover:text-[#666]'
                    }`}
                  >
                    Upload File
                  </button>
                  <button
                    onClick={() => setUploadMode('text')}
                    className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                      uploadMode === 'text'
                        ? 'bg-white text-[#1a1a1a] shadow-sm'
                        : 'text-[#999] hover:text-[#666]'
                    }`}
                  >
                    Paste Text
                  </button>
                </div>

                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-[12px] font-medium text-[#555] mb-1">File Name</label>
                    <input
                      type="text"
                      value={uploadFileName}
                      onChange={(e) => setUploadFileName(e.target.value)}
                      placeholder={uploadMode === 'file' && uploadFile ? uploadFile.name : 'e.g. COR-007.pdf'}
                      className="w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/30"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-[12px] font-medium text-[#555] mb-1">Project</label>
                    <select
                      value={uploadProjectId}
                      onChange={(e) => setUploadProjectId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/30 bg-white"
                    >
                      <option value="">(Unassigned)</option>
                      {projectOptions.map((p) => (
                        <option key={p.projectId} value={p.projectId}>{p.projectName}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {uploadMode === 'file' ? (
                  <div>
                    <label className="block text-[12px] font-medium text-[#555] mb-1">Document File</label>
                    <div
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOver(false);
                        const f = e.dataTransfer.files[0];
                        if (f) {
                          setUploadFile(f);
                          if (!uploadFileName) setUploadFileName(f.name);
                        }
                      }}
                      onClick={() => document.getElementById('file-upload-input')?.click()}
                      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                        dragOver
                          ? 'border-[#007aff] bg-[#007aff]/5'
                          : uploadFile
                          ? 'border-[#34c759] bg-[#34c759]/5'
                          : 'border-[#e0e0e0] hover:border-[#ccc] hover:bg-[#fafafa]'
                      }`}
                    >
                      <input
                        id="file-upload-input"
                        type="file"
                        className="hidden"
                        accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.docx,.doc,.pptx,.ppt,.csv,.txt,.eml"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) {
                            setUploadFile(f);
                            if (!uploadFileName) setUploadFileName(f.name);
                          }
                        }}
                      />
                      {uploadFile ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-center gap-2">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#34c759" strokeWidth="2" strokeLinecap="round">
                              <path d="M20 6L9 17L4 12" />
                            </svg>
                            <span className="text-[14px] font-medium text-[#1a1a1a]">{uploadFile.name}</span>
                          </div>
                          <p className="text-[12px] text-[#999]">
                            {(uploadFile.size / 1024 / 1024).toFixed(2)} MB &middot; {uploadFile.type || 'unknown type'}
                          </p>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setUploadFile(null);
                              setUploadFileName('');
                            }}
                            className="text-[12px] text-[#ff3b30] hover:underline"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <svg className="mx-auto" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round">
                            <path d="M21 15V19a2 2 0 01-2 2H5a2 2 0 01-2-2V15" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                          </svg>
                          <p className="text-[13px] text-[#666]">
                            Drag & drop a file here, or <span className="text-[#007aff]">click to browse</span>
                          </p>
                          <p className="text-[11px] text-[#bbb]">
                            PDF, Images, Excel, Word, PowerPoint, CSV, TXT &middot; Max 50 MB
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-[12px] font-medium text-[#555] mb-1">Document Text</label>
                    <textarea
                      value={uploadText}
                      onChange={(e) => setUploadText(e.target.value)}
                      placeholder="Paste the full document text here (OCR output, email text, copied content, etc.)..."
                      rows={12}
                      className="w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] font-mono resize-none focus:outline-none focus:ring-2 focus:ring-[#007aff]/30"
                    />
                  </div>
                )}
              </div>

              <div className="px-6 py-4 border-t border-[#e8e8e8] flex justify-end gap-3">
                <button
                  onClick={() => { setShowUpload(false); setUploadFile(null); setUploadMode('file'); }}
                  className="px-4 py-2 rounded-lg text-[13px] text-[#666] hover:bg-[#f0f0f0] transition-colors"
                >
                  Cancel
                </button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleUpload}
                  disabled={
                    (uploadMode === 'file' ? !uploadFile : !uploadText.trim()) || uploading
                  }
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {uploading ? (
                    <>
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                        <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      {uploadMode === 'file' ? 'Uploading & Extracting...' : 'Extracting with AI...'}
                    </>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M12 2L2 7L12 12L22 7L12 2Z" />
                        <path d="M2 17L12 22L22 17" />
                      </svg>
                      Process Document
                    </>
                  )}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Items list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <svg className="animate-spin w-6 h-6 text-[#999]" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[#f7f7f5] flex items-center justify-center mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
              </svg>
            </div>
            <p className="text-[14px] font-medium text-[#1a1a1a]">No documents yet</p>
            <p className="text-[13px] text-[#999] mt-1">
              Click &quot;New Document&quot; to submit a document for processing
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#f0f0f0]">
            {/* Column headers */}
            <div className="px-6 py-2.5 flex items-center gap-4 bg-[#f7f7f5] border-b border-[#e8e8e8] text-[11px] font-semibold text-[#999] uppercase tracking-wider">
              <div className="w-10 flex-shrink-0">Type</div>
              <div className="flex-1 min-w-0">Document</div>
              <div className="w-14 flex-shrink-0 text-right">Confidence</div>
              <div className="w-24 flex-shrink-0 text-center">Status</div>
              <div className="w-[104px] flex-shrink-0 text-center">Actions</div>
            </div>
            {filteredItems.map((item) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={() => openReview(item)}
                role="button"
                tabIndex={0}
                className="w-full text-left px-6 py-4 hover:bg-[#fafafa] transition-colors flex items-center gap-4 cursor-pointer"
              >
                {/* Color-coded document type badge (left side) */}
                <DocTypeBadge type={item.documentType} />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium text-[#1a1a1a] truncate">
                    {item.fileName}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[12px] text-[#999]">{item.pipelineId}</span>
                    {item.projectId && (
                      <>
                        <span className="text-[10px] text-[#ddd]">·</span>
                        <span className="text-[12px] text-[#999]">{item.projectId}</span>
                      </>
                    )}
                    <span className="text-[10px] text-[#ddd]">·</span>
                    <span className="text-[12px] text-[#999]">
                      {new Date(item.createdAt).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>

                {/* Confidence */}
                {item.overallConfidence != null && (
                  <span className={`text-[12px] font-medium px-2.5 py-1 rounded-lg flex-shrink-0 ${getConfidenceColor(item.overallConfidence)}`}>
                    {Math.round(item.overallConfidence * 100)}%
                  </span>
                )}

                {/* Status */}
                <StatusBadge status={item.status} />

                {/* Mark as Pushed button — for items not yet pushed */}
                {item.status !== 'pushed' && item.status !== 'rejected' && (
                  <button
                    onClick={(e) => handleMarkAsPushed(item.id, item.fileName, e)}
                    disabled={markingPushedId === item.id}
                    className="p-1.5 rounded-lg text-[#ccc] hover:text-green-600 hover:bg-green-50 transition-colors flex-shrink-0 disabled:opacity-50"
                    title="Mark as already pushed (data already in Airtable)"
                  >
                    {markingPushedId === item.id ? (
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                        <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 12l2 2 4-4" />
                        <circle cx="12" cy="12" r="10" />
                      </svg>
                    )}
                  </button>
                )}

                {/* Delete button */}
                <button
                  onClick={(e) => handleDelete(item.id, item.fileName, e)}
                  disabled={deletingId === item.id}
                  className="p-1.5 rounded-lg text-[#ccc] hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0 disabled:opacity-50"
                  title="Delete from pipeline"
                >
                  {deletingId === item.id ? (
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  )}
                </button>

                {/* Arrow */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────

// Color-coded document type badge with icon
function DocTypeBadge({ type }: { type: string | null }) {
  const config = getDocTypeConfig(type);
  return (
    <div className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center flex-shrink-0 ${config.bg}`}>
      <span className="text-[14px] leading-none">{config.icon}</span>
      <span className={`text-[8px] font-bold mt-0.5 leading-none tracking-tight ${config.text}`}>
        {config.abbrev}
      </span>
    </div>
  );
}

function getDocTypeConfig(type: string | null): { bg: string; text: string; icon: string; abbrev: string } {
  switch (type) {
    case 'Change Order':
      return { bg: 'bg-orange-100', text: 'text-orange-700', icon: '📋', abbrev: 'CO' };
    case 'ASI':
      return { bg: 'bg-violet-100', text: 'text-violet-700', icon: '📐', abbrev: 'ASI' };
    case 'RFI':
      return { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: '❓', abbrev: 'RFI' };
    case 'Invoice':
      return { bg: 'bg-green-100', text: 'text-green-700', icon: '💰', abbrev: 'INV' };
    case 'Daily Report':
      return { bg: 'bg-cyan-100', text: 'text-cyan-700', icon: '📝', abbrev: 'DR' };
    case 'Submittal':
      return { bg: 'bg-blue-100', text: 'text-blue-700', icon: '📦', abbrev: 'SUB' };
    case 'Job Cost Report':
      return { bg: 'bg-red-100', text: 'text-red-700', icon: '📊', abbrev: 'JCR' };
    case 'Contract':
      return { bg: 'bg-amber-100', text: 'text-amber-700', icon: '📃', abbrev: 'CON' };
    case 'Schedule':
      return { bg: 'bg-rose-100', text: 'text-rose-700', icon: '📅', abbrev: 'SCH' };
    default:
      return { bg: 'bg-gray-100', text: 'text-gray-600', icon: '📄', abbrev: 'OTH' };
  }
}

function StatusBadge({ status }: { status: string }) {
  const display = getStatusDisplay(status as PipelineItem['status']);
  return (
    <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full flex-shrink-0 ${display.color} ${display.bgColor}`}>
      {display.label}
    </span>
  );
}

function StatPill({
  label,
  value,
  color,
  onClick,
  active,
}: {
  label: string;
  value: number;
  color: string;
  onClick: () => void;
  active: boolean;
}) {
  const colorClasses: Record<string, { base: string; active: string }> = {
    blue: { base: 'text-blue-600', active: 'bg-blue-100 text-blue-700' },
    red: { base: 'text-red-600', active: 'bg-red-100 text-red-700' },
    green: { base: 'text-green-600', active: 'bg-green-100 text-green-700' },
    gray: { base: 'text-gray-600', active: 'bg-gray-100 text-gray-700' },
    slate: { base: 'text-slate-600', active: 'bg-slate-100 text-slate-700' },
  };

  const cls = colorClasses[color] || colorClasses.slate;

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
        active ? cls.active : `${cls.base} hover:bg-[#f0f0f0]`
      }`}
    >
      <span className="text-[16px] font-bold">{value}</span>
      {label}
    </button>
  );
}

/**
 * Smart source document viewer.
 * Detects CSV/spreadsheet data and renders it as a proper table.
 * Falls back to plain text for non-tabular content.
 */
function SourceDocumentView({ text, fileName, fileUrl }: { text: string; fileName: string; fileUrl?: string | null }) {
  const [viewMode, setViewMode] = useState<'pdf' | 'text'>('pdf');

  // Check if this is a PDF from Google Drive
  const isPdf = fileName.match(/\.pdf$/i);
  const driveFileId = fileUrl?.startsWith('gdrive://') ? fileUrl.replace('gdrive://', '') : null;
  const canShowPdf = isPdf && driveFileId;

  if (!text && !canShowPdf) {
    if (fileUrl) {
      return (
        <div className="text-center py-8">
          <p className="text-[13px] text-[#999] mb-3">Source text was not captured for this document.</p>
          <p className="text-[12px] text-[#ccc]">Re-upload the file to extract text.</p>
        </div>
      );
    }
    return <p className="text-[13px] text-[#999] italic">No source text available</p>;
  }

  // PDF viewer with toggle to extracted text
  if (canShowPdf) {
    return (
      <div className="flex flex-col h-full -m-4">
        {/* Toggle bar */}
        <div className="flex items-center gap-1 px-4 py-2 bg-[#fafafa] border-b border-[#e8e8e8]">
          <button
            onClick={() => setViewMode('pdf')}
            className={`px-3 py-1 text-[12px] rounded-md transition-colors ${
              viewMode === 'pdf'
                ? 'bg-white text-[#37352f] font-medium shadow-sm border border-[#e0e0e0]'
                : 'text-[#999] hover:text-[#666]'
            }`}
          >
            PDF View
          </button>
          <button
            onClick={() => setViewMode('text')}
            className={`px-3 py-1 text-[12px] rounded-md transition-colors ${
              viewMode === 'text'
                ? 'bg-white text-[#37352f] font-medium shadow-sm border border-[#e0e0e0]'
                : 'text-[#999] hover:text-[#666]'
            }`}
          >
            Extracted Text
          </button>
        </div>

        {viewMode === 'pdf' ? (
          <div className="flex-1 w-full">
            <PdfViewer
              url={`/api/pipeline/pdf?fileId=${driveFileId}`}
              fileName={fileName}
            />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            <pre className="text-[13px] leading-relaxed text-[#37352f] whitespace-pre-wrap font-mono">
              {text}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // Detect if this is CSV/spreadsheet data
  const isSpreadsheet = fileName.match(/\.(xlsx?|csv|ods)$/i) || text.startsWith('=== Sheet:');

  if (!isSpreadsheet) {
    return (
      <pre className="text-[13px] leading-relaxed text-[#37352f] whitespace-pre-wrap font-mono">
        {text}
      </pre>
    );
  }

  // Parse CSV sections (may have multiple sheets: "=== Sheet: Name ===")
  const sections = text.split(/^(=== Sheet: .+ ===)$/m).filter(Boolean);
  const sheets: { name: string; rows: string[][] }[] = [];

  let currentName = 'Sheet 1';
  for (const section of sections) {
    const sheetMatch = section.match(/^=== Sheet: (.+) ===$/);
    if (sheetMatch) {
      currentName = sheetMatch[1];
      continue;
    }
    // Parse CSV rows
    const rows = parseCSVRows(section.trim());
    if (rows.length > 0) {
      sheets.push({ name: currentName, rows });
    }
  }

  // If no sheet headers found, treat entire text as one sheet
  if (sheets.length === 0) {
    const rows = parseCSVRows(text.trim());
    if (rows.length > 0) {
      sheets.push({ name: 'Data', rows });
    }
  }

  if (sheets.length === 0) {
    return (
      <pre className="text-[13px] leading-relaxed text-[#37352f] whitespace-pre-wrap font-mono">
        {text}
      </pre>
    );
  }

  return (
    <div className="space-y-6">
      {sheets.map((sheet, si) => {
        // Find rows with actual data (skip all-empty rows)
        const dataRows = sheet.rows.filter(row => row.some(cell => cell.trim() !== ''));
        if (dataRows.length === 0) return null;

        // Find the max number of columns
        const maxCols = Math.max(...dataRows.map(r => r.length));

        // Try to detect header row (first row with multiple non-empty cells)
        const headerIdx = dataRows.findIndex(row =>
          row.filter(c => c.trim() !== '').length >= Math.min(3, maxCols / 2)
        );

        return (
          <div key={si}>
            {sheets.length > 1 && (
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] font-semibold text-[#999] uppercase tracking-wider">
                  {sheet.name}
                </span>
                <span className="text-[11px] text-[#ccc]">
                  {dataRows.length} rows
                </span>
              </div>
            )}
            <div className="overflow-x-auto rounded-lg border border-[#e8e8e8]">
              <table className="w-full text-[12px] border-collapse">
                <tbody>
                  {dataRows.map((row, ri) => {
                    const isHeader = ri === headerIdx;
                    // Pad row to maxCols
                    const cells = [...row];
                    while (cells.length < maxCols) cells.push('');

                    return (
                      <tr
                        key={ri}
                        className={
                          isHeader
                            ? 'bg-[#f7f7f5] border-b-2 border-[#e0e0e0]'
                            : ri % 2 === 0
                            ? 'bg-white'
                            : 'bg-[#fafafa]'
                        }
                      >
                        {cells.map((cell, ci) => {
                          const Tag = isHeader ? 'th' : 'td';
                          const trimmed = cell.trim();
                          // Right-align numbers and currency
                          const isNumber = /^-?[\$]?[\d,]+\.?\d*%?$/.test(trimmed.replace(/[",]/g, ''));
                          return (
                            <Tag
                              key={ci}
                              className={`px-2.5 py-1.5 border-r border-[#f0f0f0] last:border-r-0 ${
                                isHeader
                                  ? 'font-semibold text-[#37352f] text-left'
                                  : `text-[#555] ${isNumber ? 'text-right font-mono' : 'text-left'}`
                              } ${trimmed === '' ? 'text-[#e0e0e0]' : ''}`}
                              style={{ minWidth: '40px', maxWidth: '250px' }}
                            >
                              {trimmed || '\u00A0'}
                            </Tag>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Parse CSV text into rows of cells.
 * Handles quoted fields with commas inside them.
 */
function parseCSVRows(csvText: string): string[][] {
  const rows: string[][] = [];
  const lines = csvText.split('\n');

  for (const line of lines) {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++; // Skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        cells.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current); // Push last cell
    rows.push(cells);
  }

  return rows;
}
