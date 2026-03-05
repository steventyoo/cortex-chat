'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PipelineItem,
  getStatusDisplay,
  getConfidenceIndicator,
  getConfidenceColor,
} from '@/lib/pipeline';

type ViewMode = 'list' | 'review';

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

  // Review state
  const [reviewAction, setReviewAction] = useState<string>('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [editedFields, setEditedFields] = useState<Record<string, string>>({});
  const [submittingReview, setSubmittingReview] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus !== 'all') params.set('status', filterStatus);

      const res = await fetch(`/api/pipeline/list?${params}`);
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
  }, [filterStatus]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleUpload = async () => {
    if (!uploadText.trim()) return;
    setUploading(true);

    try {
      const res = await fetch('/api/pipeline/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceText: uploadText,
          projectId: uploadProjectId || undefined,
          fileName: uploadFileName || 'Pasted Document',
        }),
      });

      if (res.ok) {
        setShowUpload(false);
        setUploadText('');
        setUploadFileName('');
        setUploadProjectId('');
        await fetchItems();
      } else {
        const err = await res.json();
        alert(`Extraction failed: ${err.error}`);
      }
    } catch (err) {
      console.error('Upload error:', err);
      alert('Failed to process document');
    } finally {
      setUploading(false);
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
    // Pre-populate editable fields
    if (item.extractedData) {
      const fields: Record<string, string> = {};
      for (const [key, val] of Object.entries(item.extractedData.fields)) {
        fields[key] = val.value != null ? String(val.value) : '';
      }
      setEditedFields(fields);
    }
  };

  const filteredItems = items.filter((item) => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'needs_action') {
      return item.status === 'pending_review' || item.status === 'tier2_flagged';
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
          {/* Left: Source text */}
          <div className="w-1/2 border-r border-[#e8e8e8] flex flex-col">
            <div className="px-4 py-3 bg-[#f7f7f5] border-b border-[#e8e8e8]">
              <h3 className="text-[13px] font-semibold text-[#37352f]">Source Document</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <pre className="text-[13px] leading-relaxed text-[#37352f] whitespace-pre-wrap font-mono">
                {selectedItem.sourceText || 'No source text available'}
              </pre>
            </div>
          </div>

          {/* Right: Extracted data + review actions */}
          <div className="w-1/2 flex flex-col">
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

              {/* Document type */}
              {extraction && (
                <div className="mb-4">
                  <p className="text-[11px] font-semibold text-[#999] uppercase tracking-wider mb-2">Document Type</p>
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-[#1a1a1a]">{extraction.documentType}</span>
                    <span className="text-[12px] text-[#999]">
                      {getConfidenceIndicator(extraction.documentTypeConfidence)}
                    </span>
                  </div>
                </div>
              )}

              {/* Editable fields */}
              {extraction && (
                <div className="mb-4">
                  <p className="text-[11px] font-semibold text-[#999] uppercase tracking-wider mb-2">Fields</p>
                  <div className="space-y-2">
                    {Object.entries(extraction.fields).map(([fieldName, fieldData]) => (
                      <div key={fieldName} className="flex items-start gap-2">
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
                            onChange={(e) =>
                              setEditedFields({ ...editedFields, [fieldName]: e.target.value })
                            }
                            className={`w-full px-3 py-1.5 rounded-lg border text-[13px] transition-colors ${
                              fieldData.confidence < 0.7
                                ? 'border-red-200 bg-red-50/50'
                                : fieldData.confidence < 0.9
                                ? 'border-amber-200 bg-amber-50/50'
                                : 'border-[#e0e0e0] bg-white'
                            } focus:outline-none focus:ring-2 focus:ring-[#007aff]/30 focus:border-[#007aff]`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
                    `Submit ${reviewAction === 'approved' ? 'Approval' : reviewAction === 'rejected' ? 'Rejection' : 'Review'}`
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
                  Paste document text below. AI will extract and classify the data.
                </p>
              </div>

              <div className="p-6 space-y-4">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-[12px] font-medium text-[#555] mb-1">File Name</label>
                    <input
                      type="text"
                      value={uploadFileName}
                      onChange={(e) => setUploadFileName(e.target.value)}
                      placeholder="e.g. COR-007.pdf"
                      className="w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/30"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-[12px] font-medium text-[#555] mb-1">Project ID</label>
                    <input
                      type="text"
                      value={uploadProjectId}
                      onChange={(e) => setUploadProjectId(e.target.value)}
                      placeholder="e.g. PRJ-001"
                      className="w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/30"
                    />
                  </div>
                </div>

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
              </div>

              <div className="px-6 py-4 border-t border-[#e8e8e8] flex justify-end gap-3">
                <button
                  onClick={() => setShowUpload(false)}
                  className="px-4 py-2 rounded-lg text-[13px] text-[#666] hover:bg-[#f0f0f0] transition-colors"
                >
                  Cancel
                </button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleUpload}
                  disabled={!uploadText.trim() || uploading}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {uploading ? (
                    <>
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                        <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      Extracting with AI...
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
            {filteredItems.map((item) => (
              <motion.button
                key={item.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={() => openReview(item)}
                className="w-full text-left px-6 py-4 hover:bg-[#fafafa] transition-colors flex items-center gap-4"
              >
                {/* Doc icon */}
                <div className="w-10 h-10 rounded-xl bg-[#f7f7f5] flex items-center justify-center flex-shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <path d="M14 2v6h6" />
                  </svg>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-[#1a1a1a] truncate">
                      {item.fileName}
                    </span>
                    {item.documentType && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#f0f0f0] text-[#666] font-medium flex-shrink-0">
                        {item.documentType}
                      </span>
                    )}
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

                {/* Arrow */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────

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
