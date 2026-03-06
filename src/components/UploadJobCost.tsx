'use client';

import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ProjectMatch {
  projectId: string;
  projectName: string;
  jobNumber: string | null;
}

interface DiffChange {
  costCode: string;
  description: string;
  field: string;
  oldValue: number;
  newValue: number;
  change: number;
  changePercent: number;
}

interface PreviewData {
  status: 'preview';
  fingerprint: string;
  format: string;
  projectInfo: {
    jobNumber: string | null;
    projectName: string | null;
    company: string | null;
    reportDate: string | null;
    period: string | null;
  };
  matchedProject: ProjectMatch;
  summary: {
    totalBudget: number;
    totalActual: number;
    totalChangeOrders: number;
    totalVariance: number;
    percentComplete: number | null;
  };
  lineItems: Array<{
    costCode: string;
    category: string;
    description: string;
    revisedBudget: number;
    jobToDate: number;
    changeOrders: number;
    overUnder: number;
    percentOfBudget: number | null;
  }>;
  diff: {
    changes: DiffChange[];
    newCostCodes: Array<{ costCode: string; description: string }>;
    removedCostCodes: Array<{ costCode: string; description: string }>;
  };
  existingRecordCount: number;
  warnings: string[];
}

interface ImportResult {
  status: 'imported';
  projectId: string;
  projectName: string;
  summary: PreviewData['summary'];
  results: { updated: number; created: number; errors: string[] };
  diff: { changesApplied: number; newCostCodes: number };
}

function fmt(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-$${formatted}` : `$${formatted}`;
}

function fmtPct(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

export default function UploadJobCost({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const [stage, setStage] = useState<'upload' | 'preview' | 'importing' | 'done'>('upload');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileText, setFileText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    setError(null);
    setFileName(file.name);

    // Read file as text
    const text = await file.text();
    setFileText(text);

    if (text.trim().length < 50) {
      setError('File appears to be empty or too small');
      return;
    }

    // Send to preview API
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, fileName: file.name, orgId, action: 'preview' }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to parse file');
        return;
      }

      setPreview(data);
      setStage('preview');
    } catch {
      setError('Failed to upload file');
    }
  }, [orgId]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleImport = async () => {
    if (!preview) return;
    setStage('importing');

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: fileText,
          fileName,
          orgId,
          projectId: preview.matchedProject.projectId,
          action: 'import',
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Import failed');
        setStage('preview');
        return;
      }

      setImportResult(data);
      setStage('done');
    } catch {
      setError('Import failed');
      setStage('preview');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#e8e8e8] flex items-center justify-between">
          <div>
            <h2 className="text-[16px] font-semibold text-[#1a1a1a]">
              {stage === 'upload' ? 'Upload Job Cost Report' :
               stage === 'preview' ? 'Review Import' :
               stage === 'importing' ? 'Importing...' : 'Import Complete'}
            </h2>
            <p className="text-[12px] text-[#999] mt-0.5">
              {stage === 'upload' ? 'CSV or text export from Sage, QuickBooks, or Foundation' :
               stage === 'preview' ? `${preview?.lineItems.length} line items from ${preview?.format} format` :
               stage === 'done' ? `${importResult?.results.updated} updated, ${importResult?.results.created} created` : 'Writing to database...'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[#f5f5f5] transition-colors">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="#999" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            {/* Upload stage */}
            {stage === 'upload' && (
              <motion.div key="upload" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
                    dragging
                      ? 'border-[#e8740c] bg-[#e8740c]/5'
                      : 'border-[#e0e0e0] hover:border-[#ccc] hover:bg-[#fafafa]'
                  }`}
                >
                  <div className="text-4xl mb-3">
                    {dragging ? '📥' : '📄'}
                  </div>
                  <p className="text-[14px] font-medium text-[#1a1a1a] mb-1">
                    {dragging ? 'Drop file here' : 'Drop your job cost report here'}
                  </p>
                  <p className="text-[12px] text-[#999]">
                    CSV, TXT, or PDF — Sage, QuickBooks, Foundation supported
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.txt,.pdf,.xlsx"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </div>

                {error && (
                  <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">
                    {error}
                  </div>
                )}
              </motion.div>
            )}

            {/* Preview stage */}
            {stage === 'preview' && preview && (
              <motion.div key="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
                {/* Matched project */}
                <div className="flex items-center gap-3 p-3 bg-[#f0faf0] rounded-xl border border-green-200">
                  <div className="text-xl">✅</div>
                  <div>
                    <p className="text-[13px] font-medium text-[#1a1a1a]">
                      Matched to {preview.matchedProject.projectName}
                    </p>
                    <p className="text-[11px] text-[#999]">
                      Job #{preview.matchedProject.jobNumber || preview.matchedProject.projectId} · {preview.format} format · {preview.projectInfo.period || 'Unknown period'}
                    </p>
                  </div>
                </div>

                {/* Summary cards */}
                <div className="grid grid-cols-2 gap-3">
                  <SummaryCard label="Total Budget" value={fmt(preview.summary.totalBudget)} />
                  <SummaryCard label="Total Actual" value={fmt(preview.summary.totalActual)} />
                  <SummaryCard label="Change Orders" value={fmt(preview.summary.totalChangeOrders)} />
                  <SummaryCard
                    label="Variance"
                    value={fmt(preview.summary.totalVariance)}
                    color={preview.summary.totalVariance > 0 ? '#dc2626' : '#16a34a'}
                  />
                </div>

                {/* Diff section */}
                {preview.existingRecordCount > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-[#999] uppercase tracking-wider mb-2">
                      Changes from previous data ({preview.existingRecordCount} existing records)
                    </p>

                    {preview.diff.changes.length === 0 && preview.diff.newCostCodes.length === 0 ? (
                      <p className="text-[13px] text-[#999] italic">No changes detected — data matches existing records</p>
                    ) : (
                      <div className="space-y-2">
                        {preview.diff.changes.slice(0, 10).map((change, i) => (
                          <div key={i} className="flex items-center justify-between p-2 bg-[#fffbeb] rounded-lg border border-amber-200 text-[12px]">
                            <div>
                              <span className="font-mono text-[#999]">{change.costCode}</span>
                              <span className="ml-2 text-[#555]">{change.description}</span>
                              <span className="ml-2 text-[#999]">{change.field}</span>
                            </div>
                            <div className="text-right">
                              <span className={change.change > 0 ? 'text-red-600' : 'text-green-600'}>
                                {change.change > 0 ? '+' : ''}{fmt(change.change)}
                              </span>
                              <span className="text-[#999] ml-1">({fmtPct(change.changePercent)})</span>
                            </div>
                          </div>
                        ))}
                        {preview.diff.changes.length > 10 && (
                          <p className="text-[12px] text-[#999] text-center">
                            +{preview.diff.changes.length - 10} more changes
                          </p>
                        )}

                        {preview.diff.newCostCodes.length > 0 && (
                          <div className="p-2 bg-blue-50 rounded-lg border border-blue-200 text-[12px]">
                            <span className="font-medium text-blue-700">
                              {preview.diff.newCostCodes.length} new cost codes:
                            </span>
                            <span className="ml-1 text-blue-600">
                              {preview.diff.newCostCodes.map(c => c.costCode).join(', ')}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Line items table */}
                <div>
                  <p className="text-[11px] font-semibold text-[#999] uppercase tracking-wider mb-2">
                    Line Items ({preview.lineItems.length})
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-[#e0e0e0] max-h-[250px] overflow-y-auto">
                    <table className="w-full text-[11px]">
                      <thead className="sticky top-0">
                        <tr className="bg-[#f7f7f5]">
                          <th className="px-2 py-1.5 text-left font-semibold text-[#555]">Code</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-[#555]">Description</th>
                          <th className="px-2 py-1.5 text-right font-semibold text-[#555]">Budget</th>
                          <th className="px-2 py-1.5 text-right font-semibold text-[#555]">Actual</th>
                          <th className="px-2 py-1.5 text-right font-semibold text-[#555]">Over/Under</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.lineItems.map((item, i) => (
                          <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'}>
                            <td className="px-2 py-1 font-mono text-[#999]">{item.costCode}</td>
                            <td className="px-2 py-1 text-[#555]">{item.description}</td>
                            <td className="px-2 py-1 text-right font-mono">{fmt(item.revisedBudget)}</td>
                            <td className="px-2 py-1 text-right font-mono">{fmt(item.jobToDate)}</td>
                            <td className={`px-2 py-1 text-right font-mono ${item.overUnder > 0 ? 'text-red-600' : 'text-green-600'}`}>
                              {fmt(item.overUnder)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Warnings */}
                {preview.warnings.length > 0 && (
                  <div className="space-y-1">
                    {preview.warnings.map((w, i) => (
                      <p key={i} className="text-[12px] text-amber-600">⚠️ {w}</p>
                    ))}
                  </div>
                )}

                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">
                    {error}
                  </div>
                )}
              </motion.div>
            )}

            {/* Importing stage */}
            {stage === 'importing' && (
              <motion.div key="importing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-12 text-center">
                <div className="text-4xl mb-4 animate-pulse">⚡</div>
                <p className="text-[14px] font-medium text-[#1a1a1a]">Writing to database...</p>
                <p className="text-[12px] text-[#999] mt-1">{preview?.lineItems.length} cost codes</p>
              </motion.div>
            )}

            {/* Done stage */}
            {stage === 'done' && importResult && (
              <motion.div key="done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="py-8 text-center">
                <div className="text-4xl mb-4">✅</div>
                <p className="text-[16px] font-semibold text-[#1a1a1a] mb-1">Import Complete</p>
                <p className="text-[13px] text-[#999] mb-6">
                  {importResult.projectName} updated successfully
                </p>

                <div className="grid grid-cols-3 gap-4 max-w-sm mx-auto mb-6">
                  <div className="p-3 bg-[#f7f7f5] rounded-xl">
                    <p className="text-[20px] font-semibold text-[#1a1a1a]">{importResult.results.updated}</p>
                    <p className="text-[11px] text-[#999]">Updated</p>
                  </div>
                  <div className="p-3 bg-[#f7f7f5] rounded-xl">
                    <p className="text-[20px] font-semibold text-[#1a1a1a]">{importResult.results.created}</p>
                    <p className="text-[11px] text-[#999]">Created</p>
                  </div>
                  <div className="p-3 bg-[#f7f7f5] rounded-xl">
                    <p className="text-[20px] font-semibold text-[#e8740c]">{fmt(importResult.summary.totalActual)}</p>
                    <p className="text-[11px] text-[#999]">Total JTD</p>
                  </div>
                </div>

                {importResult.results.errors.length > 0 && (
                  <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-[12px] text-red-700 text-left">
                    <p className="font-medium mb-1">{importResult.results.errors.length} errors:</p>
                    {importResult.results.errors.map((e, i) => (
                      <p key={i}>• {e}</p>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#e8e8e8] flex items-center justify-between">
          <button
            onClick={stage === 'done' ? onClose : () => { setStage('upload'); setPreview(null); setError(null); }}
            className="px-4 py-2 text-[13px] text-[#999] hover:text-[#555] transition-colors"
          >
            {stage === 'done' ? 'Close' : stage === 'upload' ? 'Cancel' : 'Back'}
          </button>

          {stage === 'preview' && (
            <button
              onClick={handleImport}
              className="px-6 py-2.5 bg-[#e8740c] text-white text-[13px] font-medium rounded-xl hover:bg-[#d06a0b] transition-colors shadow-sm"
            >
              Import {preview?.lineItems.length} Cost Codes
            </button>
          )}

          {stage === 'done' && (
            <button
              onClick={onClose}
              className="px-6 py-2.5 bg-[#e8740c] text-white text-[13px] font-medium rounded-xl hover:bg-[#d06a0b] transition-colors shadow-sm"
            >
              Done
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="p-3 bg-[#f7f7f5] rounded-xl">
      <p className="text-[11px] text-[#999] uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-[15px] font-semibold" style={{ color: color || '#1a1a1a' }}>{value}</p>
    </div>
  );
}
