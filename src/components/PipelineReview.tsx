'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
type ListView = 'recent' | 'categories' | 'drive';

interface CategoryInfo {
  id: string;
  key: string;
  label: string;
  priority: string;
  sort_order: number;
  is_default: boolean;
}

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

interface GlobalStats {
  total: number;
  processing: number;
  completed: number;
  failed: number;
  storedOnly: number;
  pendingReview: number;
  approved: number;
  rejected: number;
  flagged: number;
  byStatus: Record<string, number>;
  categoryCounts: Record<string, number>;
  uncategorizedCount: number;
  drivePathCounts: Record<string, number>;
  projectCategoryCounts: Record<string, Record<string, number>>;
  projectTotalCounts: Record<string, number>;
  companyWideTotalCount: number;
}

interface PaginationInfo {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export default function PipelineReview() {
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedItem, setSelectedItem] = useState<PipelineItem | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [listView, setListView] = useState<ListView>('recent');
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

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

  // Drive connection state
  const [showDriveSetup, setShowDriveSetup] = useState(false);
  const [driveFolderId, setDriveFolderId] = useState('');
  const [savedDriveFolderId, setSavedDriveFolderId] = useState<string | null | undefined>(undefined);
  const [serviceAccountEmail, setServiceAccountEmail] = useState<string | null>(null);
  const [driveTestResult, setDriveTestResult] = useState<{ success: boolean; folderName?: string; subfolders?: { id: string; name: string }[]; error?: string } | null>(null);
  const [testingDrive, setTestingDrive] = useState(false);
  const [savingDrive, setSavingDrive] = useState(false);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Move category state
  const [movingId, setMovingId] = useState<string | null>(null);
  const [showReviewMoveMenu, setShowReviewMoveMenu] = useState(false);

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

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);

  // Category drill-down state (for Categories tab)
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  // Drive folder drill-down state (for Drive Folders tab)
  const [selectedDrivePath, setSelectedDrivePath] = useState<string | null>(null);

  // Global stats for progress bar (polled separately, no limit)
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null);

  // Stop ingest state
  const [stoppingIngest, setStoppingIngest] = useState(false);

  const fetchItems = useCallback(async (page?: number) => {
    setLoading(true);
    try {
      const p = page ?? currentPage;
      const params = new URLSearchParams({ page: String(p), pageSize: '50' });
      if (filterStatus && filterStatus !== 'all') {
        const STATUS_PARAM_MAP: Record<string, string> = {
          needs_action: 'pending_review',
          processing: 'processing',
          approved: 'approved',
          pending_review: 'pending_review',
          tier2_flagged: 'tier2_flagged',
          rejected: 'rejected',
          failed: 'failed',
        };
        const mapped = STATUS_PARAM_MAP[filterStatus];
        if (mapped) params.set('status', mapped);
      }
      if (selectedCategoryId) {
        params.set('categoryId', selectedCategoryId === '__uncategorized' ? 'null' : selectedCategoryId);
      }
      if (selectedProject) {
        params.set('projectFolder', selectedProject);
      }
      if (selectedDrivePath) {
        params.set('driveFolderPath', selectedDrivePath);
      }
      const res = await fetch(`/api/pipeline/list?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items);
        setStats(data.stats);
        if (data.categories) setCategories(data.categories);
        if (data.pagination) setPagination(data.pagination);
      }
    } catch (err) {
      console.error('Failed to fetch pipeline items:', err);
    } finally {
      setLoading(false);
    }
  }, [currentPage, filterStatus, selectedCategoryId, selectedProject, selectedDrivePath]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Auto-poll while any items are queued or processing
  useEffect(() => {
    const hasInProgress = items.some(
      (i) => i.status === 'queued' || i.status === 'processing' || i.status === 'tier1_extracting'
    );
    if (!hasInProgress) return;

    const interval = setInterval(() => {
      const params = new URLSearchParams({ page: String(currentPage), pageSize: '50' });
      fetch(`/api/pipeline/list?${params.toString()}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (data) {
            setItems(data.items);
            setStats(data.stats);
            if (data.pagination) setPagination(data.pagination);
          }
        })
        .catch(() => {});
    }, 3000);

    return () => clearInterval(interval);
  }, [items, currentPage]);

  // Fetch global stats for the progress bar
  const fetchGlobalStats = useCallback(async () => {
    try {
      const res = await fetch('/api/pipeline/stats');
      if (res.ok) {
        const data = await res.json();
        setGlobalStats(data);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchGlobalStats(); }, [fetchGlobalStats]);

  // Poll global stats while processing is active
  useEffect(() => {
    if (!globalStats || globalStats.processing === 0) return;
    const interval = setInterval(fetchGlobalStats, 4000);
    return () => clearInterval(interval);
  }, [globalStats, fetchGlobalStats]);

  // Reset to page 1 when filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [filterStatus, selectedCategoryId, selectedProject, selectedDrivePath]);

  // Reset category/drive selection when leaving their views
  useEffect(() => {
    if (listView !== 'categories') {
      setSelectedProject(null);
      setSelectedCategoryId(null);
    }
    if (listView !== 'drive') setSelectedDrivePath(null);
  }, [listView]);

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

  // Load current Drive folder config
  useEffect(() => {
    fetch('/api/org/settings').then(r => r.json()).then(d => {
      setSavedDriveFolderId(d.driveFolderId || null);
      if (d.serviceAccountEmail) setServiceAccountEmail(d.serviceAccountEmail);
    }).catch(() => {
      setSavedDriveFolderId(null);
    });
  }, []);

  const handleTestDrive = async () => {
    if (!driveFolderId.trim()) return;
    setTestingDrive(true);
    setDriveTestResult(null);
    try {
      const res = await fetch('/api/onboarding/test-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: driveFolderId.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setDriveTestResult({ success: true, folderName: data.folderName, subfolders: data.subfolders });
      } else {
        setDriveTestResult({ success: false, error: data.error });
      }
    } catch {
      setDriveTestResult({ success: false, error: 'Network error' });
    } finally {
      setTestingDrive(false);
    }
  };

  const handleSaveDrive = async () => {
    if (!driveFolderId.trim()) return;
    setSavingDrive(true);
    try {
      const res = await fetch('/api/org/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driveFolderId: driveFolderId.trim() }),
      });
      if (res.ok) {
        setSavedDriveFolderId(driveFolderId.trim());
        setShowDriveSetup(false);
        setDriveTestResult(null);
        setDriveFolderId('');
      } else {
        const err = await res.json();
        alert(`Failed to save: ${err.error}`);
      }
    } catch {
      alert('Network error saving Drive folder');
    } finally {
      setSavingDrive(false);
    }
  };

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
        alert(`Upload failed: ${err.error}`);
      }
    } catch (err) {
      console.error('Upload error:', err);
      alert(`Failed to upload document: ${err instanceof Error ? err.message : 'Network error'}`);
    } finally {
      setUploading(false);
    }
  };

  const [retryingId, setRetryingId] = useState<string | null>(null);

  const handleRetry = async (recordId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRetryingId(recordId);
    try {
      const res = await fetch('/api/pipeline/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId }),
      });
      if (res.ok) {
        await fetchItems();
      } else {
        const err = await res.json();
        alert(`Retry failed: ${err.error}`);
      }
    } catch (err) {
      console.error('Retry error:', err);
      alert('Failed to retry');
    } finally {
      setRetryingId(null);
    }
  };

  const handleScanDrive = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch('/api/pipeline/scan-drive');
      const data = await res.json();
      if (res.ok) {
        const queued = data.queued?.filter((f: { status: string }) => f.status === 'queued').length || 0;
        const remaining = data.remainingNewFiles || 0;
        setScanResult(
          queued > 0
            ? `Queued ${queued} file${queued > 1 ? 's' : ''} for processing${remaining > 0 ? ` (${remaining} more next run)` : ''}`
            : data.message || 'No new files found'
        );
        if (queued > 0) {
          await fetchItems();
          fetchGlobalStats();
        }
      } else {
        setScanResult(data.error ? `${data.error}${data.hint ? ` — ${data.hint}` : ''}` : 'Scan failed');
      }
    } catch (err) {
      console.error('Drive scan error:', err);
      setScanResult('Failed to connect to Drive');
    } finally {
      setScanning(false);
      setTimeout(() => setScanResult(null), 5000);
    }
  };

  const handleStopIngest = async () => {
    if (!confirm('Stop all document ingestion? This will cancel all queued and processing documents.')) return;
    setStoppingIngest(true);
    try {
      const res = await fetch('/api/pipeline/stop-ingest', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setScanResult(data.message || 'Ingestion stopped');
        await fetchItems();
        fetchGlobalStats();
      } else {
        setScanResult(data.error || 'Failed to stop ingestion');
      }
    } catch (err) {
      console.error('Stop ingest error:', err);
      setScanResult('Failed to stop ingestion');
    } finally {
      setStoppingIngest(false);
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

  const handleMove = async (recordId: string, categoryId: string) => {
    setMovingId(recordId);
    try {
      const res = await fetch('/api/pipeline/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId, categoryId }),
      });
      if (res.ok) {
        await fetchItems();
      } else {
        const err = await res.json();
        alert(`Move failed: ${err.error}`);
      }
    } catch (err) {
      console.error('Move error:', err);
      alert('Failed to move document');
    } finally {
      setMovingId(null);
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
    setShowReviewMoveMenu(false);
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
    if (filterStatus === 'processing') {
      return item.status === 'queued' || item.status === 'processing' || item.status === 'tier1_extracting' || item.status === 'tier2_validating';
    }
    return item.status === filterStatus;
  });

  const toggleSection = useCallback((key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

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
          {/* Move to category dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowReviewMoveMenu(!showReviewMoveMenu)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                showReviewMoveMenu
                  ? 'bg-blue-50 text-[#007aff]'
                  : 'text-[#999] hover:bg-[#f0f0f0] hover:text-[#555]'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              {categories.find(c => c.id === selectedItem.categoryId)?.label || 'Uncategorized'}
            </button>
            {showReviewMoveMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowReviewMoveMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-white rounded-xl shadow-lg border border-[#e8e8e8] py-1 min-w-[200px] max-h-[320px] overflow-y-auto">
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-[#999] uppercase tracking-wider">Move to category</div>
                  {categories.map((cat) => {
                    const isActive = selectedItem.categoryId === cat.id;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => {
                          if (!isActive) {
                            handleMove(selectedItem.id, cat.id);
                            setSelectedItem({ ...selectedItem, categoryId: cat.id });
                          }
                          setShowReviewMoveMenu(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-[13px] flex items-center gap-2 transition-colors ${
                          isActive
                            ? 'text-[#007aff] bg-blue-50/50 font-medium'
                            : 'text-[#555] hover:bg-[#f7f7f5]'
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          cat.priority === 'P1' ? 'bg-blue-400'
                            : cat.priority === 'P2' ? 'bg-amber-400'
                            : 'bg-gray-300'
                        }`} />
                        <span className="flex-1 truncate">{cat.label}</span>
                        {isActive && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
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
              <div className="ml-auto flex items-center gap-2 text-[10px] text-[#999]">
                <span className="flex items-center gap-0.5">🟢 ≥90%</span>
                <span className="flex items-center gap-0.5">🟡 70-89%</span>
                <span className="flex items-center gap-0.5">🔴 &lt;70%</span>
              </div>
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

                      const renderField = (fieldName: string, def: SkillFieldDef | null, extracted: { value: string | number | null; confidence: number } | null) => {
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
                      };

                      if (fieldDefs && fieldDefs.length > 0) {
                        const schemaFields = fieldDefs.map(fd => ({
                          name: fd.name,
                          def: fd,
                          extracted: extraction.fields?.[fd.name] || null,
                        }));
                        const extraFields = fieldEntries
                          .filter(([k]) => !fieldDefs.some(fd => fd.name === k))
                          .map(([k, v]) => ({ name: k, def: null as SkillFieldDef | null, extracted: v }));

                        return (
                          <>
                            <p className="text-[11px] font-semibold text-[#999] uppercase tracking-wider mb-2">
                              Schema Fields ({schemaFields.length})
                            </p>
                            {schemaFields.map(({ name, def, extracted }) => renderField(name, def, extracted))}
                            {extraFields.length > 0 && (
                              <>
                                <div className="border-t border-dashed border-[#e0e0e0] my-3" />
                                <p className="text-[11px] font-semibold text-[#999] uppercase tracking-wider mb-2">
                                  Discovered Fields ({extraFields.length})
                                </p>
                                {extraFields.map(({ name, def, extracted }) => renderField(name, def, extracted))}
                              </>
                            )}
                          </>
                        );
                      }

                      return (
                        <>
                          <p className="text-[11px] font-semibold text-[#999] uppercase tracking-wider mb-2">
                            Discovered Fields ({fieldEntries.length})
                          </p>
                          {fieldEntries.map(([fieldName, fieldData]) => renderField(fieldName, null, fieldData))}
                        </>
                      );
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

            {/* Drive settings button */}
            <button
              onClick={() => { setShowDriveSetup(!showDriveSetup); setDriveTestResult(null); }}
              className={`p-2 rounded-xl border transition-colors ${
                showDriveSetup
                  ? 'border-[#007aff] bg-[#007aff]/5 text-[#007aff]'
                  : 'border-[#e0e0e0] text-[#999] hover:bg-[#f7f7f5]'
              }`}
              title="Google Drive settings"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
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

        {/* Stats bar — use global stats for accurate totals */}
        {(globalStats || stats) && (
          <div className="flex flex-wrap gap-3 mb-3">
            <StatPill label="Pending Review" value={globalStats?.pendingReview ?? stats?.pendingReview ?? 0} color="blue" onClick={() => setFilterStatus('pending_review')} active={filterStatus === 'pending_review'} />
            <StatPill label="Flagged" value={globalStats?.flagged ?? stats?.flagged ?? 0} color="red" onClick={() => setFilterStatus('tier2_flagged')} active={filterStatus === 'tier2_flagged'} />
            <StatPill label="Processing" value={globalStats?.processing ?? stats?.processing ?? 0} color="amber" onClick={() => setFilterStatus('processing')} active={filterStatus === 'processing'} />
            <StatPill label="Approved" value={globalStats?.approved ?? stats?.approved ?? 0} color="green" onClick={() => setFilterStatus('approved')} active={filterStatus === 'approved'} />
            <StatPill label="Rejected" value={globalStats?.rejected ?? stats?.rejected ?? 0} color="gray" onClick={() => setFilterStatus('rejected')} active={filterStatus === 'rejected'} />
            <StatPill label="Failed" value={globalStats?.failed ?? 0} color="red" onClick={() => setFilterStatus('failed')} active={filterStatus === 'failed'} />
            <StatPill label="All" value={globalStats?.total ?? stats?.total ?? 0} color="slate" onClick={() => setFilterStatus('all')} active={filterStatus === 'all'} />
          </div>
        )}

        {/* View toggle */}
        <ViewToggle value={listView} onChange={setListView} />
      </div>

      {/* Drive setup panel */}
      <AnimatePresence>
        {showDriveSetup && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border-b border-[#e8e8e8] overflow-hidden"
          >
            <div className="px-6 py-4 bg-[#fafafa]">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#4285f4]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg width="16" height="16" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
                    <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                    <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" fill="#00ac47"/>
                    <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 9.85z" fill="#ea4335"/>
                    <path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                    <path d="m59.8 53H27.5l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
                    <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25l16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-[14px] font-semibold text-[#1a1a1a]">Google Drive Connection</h3>
                    {savedDriveFolderId && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Connected</span>
                    )}
                  </div>
                  {savedDriveFolderId && !driveFolderId && (
                    <p className="text-[12px] text-[#999] mb-3">
                      Current folder ID: <code className="text-[11px] bg-[#f0f0f0] px-1.5 py-0.5 rounded font-mono">{savedDriveFolderId}</code>
                    </p>
                  )}
                  <p className="text-[12px] text-[#777] mb-3">
                    {savedDriveFolderId
                      ? 'Update your Google Drive folder or reconnect with a new one.'
                      : 'Connect a Google Drive folder to scan documents automatically.'}
                  </p>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11px] font-medium text-[#555] mb-1">
                        1. Share your Google Drive folder with the service account:
                      </label>
                      <button
                        onClick={() => {
                          if (serviceAccountEmail) navigator.clipboard.writeText(serviceAccountEmail);
                        }}
                        className="text-[12px] text-[#007aff] bg-[#f0f0f0] rounded-lg px-2.5 py-1 font-mono hover:bg-[#e8e8e8] transition-colors select-all"
                      >
                        {serviceAccountEmail || '(loading...)'} <span className="text-[10px]">📋</span>
                      </button>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-[#555] mb-1">
                        2. Paste your Google Drive folder ID:
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={driveFolderId}
                          onChange={(e) => setDriveFolderId(e.target.value)}
                          placeholder={savedDriveFolderId || 'e.g. 1AbCdEfGhIjKlMnOpQrStUvWxYz'}
                          className="flex-1 px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-[#007aff]/30 bg-white"
                        />
                        <button
                          onClick={handleTestDrive}
                          disabled={!driveFolderId.trim() || testingDrive}
                          className="px-4 py-2 rounded-lg border border-[#e0e0e0] text-[13px] font-medium text-[#555] hover:bg-white transition-colors disabled:opacity-40"
                        >
                          {testingDrive ? 'Testing...' : 'Test'}
                        </button>
                        <button
                          onClick={handleSaveDrive}
                          disabled={!driveFolderId.trim() || !driveTestResult?.success || savingDrive}
                          className="px-4 py-2 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors disabled:opacity-40"
                        >
                          {savingDrive ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>

                    {/* Test result */}
                    {driveTestResult && (
                      <div className={`rounded-lg px-3 py-2.5 text-[12px] ${
                        driveTestResult.success
                          ? 'bg-green-50 border border-green-200 text-green-800'
                          : 'bg-red-50 border border-red-200 text-red-800'
                      }`}>
                        {driveTestResult.success ? (
                          <div>
                            <p className="font-medium">Connected to &ldquo;{driveTestResult.folderName}&rdquo;</p>
                            {driveTestResult.subfolders && driveTestResult.subfolders.length > 0 && (
                              <p className="mt-1 text-[11px] opacity-80">
                                Found {driveTestResult.subfolders.length} subfolder{driveTestResult.subfolders.length !== 1 ? 's' : ''}: {driveTestResult.subfolders.slice(0, 5).map(f => f.name).join(', ')}{driveTestResult.subfolders.length > 5 ? '...' : ''}
                              </p>
                            )}
                          </div>
                        ) : (
                          <p>{driveTestResult.error}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => { setShowDriveSetup(false); setDriveTestResult(null); }}
                  className="p-1.5 rounded-lg text-[#999] hover:text-[#1a1a1a] hover:bg-[#f0f0f0] transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* No Drive folder banner */}
      {savedDriveFolderId === null && !showDriveSetup && !loading && (
        <div className="px-6 py-3 bg-amber-50 border-b border-amber-200 flex items-center gap-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="text-[12px] text-amber-800 flex-1">
            No Google Drive folder connected. Click the settings icon next to &quot;Scan Drive&quot; to connect one.
          </span>
          <button
            onClick={() => setShowDriveSetup(true)}
            className="text-[12px] font-medium text-amber-700 hover:text-amber-900 underline"
          >
            Connect now
          </button>
        </div>
      )}

      {/* Test mode banner */}
      {testMode && (
        <div className="px-6 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
          <span className="text-[13px]">🧪</span>
          <span className="text-[12px] font-medium text-amber-800">
            Test Mode — approvals will NOT push data to Airtable tables. Toggle off when ready for production.
          </span>
        </div>
      )}

      {/* Ingestion progress bar — always show when stats available */}
      <AnimatePresence>
        {globalStats && globalStats.total > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border-b border-[#e8e8e8] overflow-hidden"
          >
            <IngestionProgressBar stats={globalStats} onStopIngest={handleStopIngest} stopping={stoppingIngest} />
          </motion.div>
        )}
      </AnimatePresence>

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
                      {uploadMode === 'file' ? 'Uploading...' : 'Extracting with AI...'}
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
        ) : listView === 'categories' ? (
          selectedCategoryId ? (
            <div>
              {/* Back button + project > category breadcrumb */}
              <div className="px-6 py-3 bg-[#f7f7f5] border-b border-[#e8e8e8] flex items-center gap-2">
                <button
                  onClick={() => {
                    if (selectedProject === '__uncategorized') {
                      setSelectedProject(null);
                      setSelectedCategoryId(null);
                    } else {
                      setSelectedCategoryId(null);
                    }
                    setCurrentPage(1);
                  }}
                  className="flex items-center gap-1.5 text-[13px] text-[#555] hover:text-[#1a1a1a] transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M19 12H5M12 19l-7-7 7-7" />
                  </svg>
                  Back
                </button>
                <span className="text-[12px] text-[#999]">/</span>
                <span className="text-[13px] text-[#999]">
                  {selectedProject === '__company_wide' ? 'Company-Wide' : selectedProject === '__no_project' ? 'No Project' : selectedProject === '__uncategorized' ? '' : selectedProject}
                </span>
                {selectedProject !== '__uncategorized' && <span className="text-[12px] text-[#999]">/</span>}
                <span className="text-[14px] font-semibold text-[#1a1a1a]">
                  {selectedCategoryId === '__uncategorized'
                    ? 'Uncategorized'
                    : categories.find(c => c.id === selectedCategoryId)?.label || 'Category'}
                </span>
                {pagination && (
                  <span className="text-[12px] text-[#999] ml-1">
                    {pagination.totalItems} document{pagination.totalItems !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {/* Document list for this project + category */}
              <div className="divide-y divide-[#f0f0f0]">
                <div className="px-6 py-2.5 flex items-center gap-4 bg-[#f7f7f5] border-b border-[#e8e8e8] text-[11px] font-semibold text-[#999] uppercase tracking-wider">
                  <div className="w-10 flex-shrink-0">Type</div>
                  <div className="flex-1 min-w-0">Document</div>
                  <div className="w-14 flex-shrink-0 text-right">Confidence</div>
                  <div className="w-24 flex-shrink-0 text-center">Status</div>
                  <div className="w-[104px] flex-shrink-0 text-center">Actions</div>
                </div>
                {filteredItems.map((item) => (
                  <DocumentRow
                    key={item.id}
                    item={item}
                    categories={categories}
                    openReview={openReview}
                    handleRetry={handleRetry}
                    handleMarkAsPushed={handleMarkAsPushed}
                    handleDelete={handleDelete}
                    handleMove={handleMove}
                    retryingId={retryingId}
                    markingPushedId={markingPushedId}
                    deletingId={deletingId}
                    movingId={movingId}
                  />
                ))}
              </div>
            </div>
          ) : selectedProject ? (
            <ProjectCategoryList
              projectName={selectedProject}
              categories={categories}
              projectCategoryCounts={globalStats?.projectCategoryCounts?.[selectedProject] || {}}
              onSelectCategory={(catId) => { setSelectedCategoryId(catId); setCurrentPage(1); }}
              onBack={() => { setSelectedProject(null); setCurrentPage(1); }}
            />
          ) : (
            <ProjectFolderList
              projectTotalCounts={globalStats?.projectTotalCounts || {}}
              companyWideTotalCount={globalStats?.companyWideTotalCount || 0}
              uncategorizedCount={globalStats?.uncategorizedCount || 0}
              onSelectProject={(proj) => {
                if (proj === '__uncategorized') {
                  setSelectedProject('__uncategorized');
                  setSelectedCategoryId('__uncategorized');
                } else {
                  setSelectedProject(proj);
                }
                setCurrentPage(1);
              }}
            />
          )
        ) : listView === 'drive' ? (
          selectedDrivePath ? (
            <div>
              {/* Back button + path name */}
              <div className="px-6 py-3 bg-[#f7f7f5] border-b border-[#e8e8e8] flex items-center gap-3">
                <button
                  onClick={() => setSelectedDrivePath(null)}
                  className="flex items-center gap-1.5 text-[13px] text-[#555] hover:text-[#1a1a1a] transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M19 12H5M12 19l-7-7 7-7" />
                  </svg>
                  Back
                </button>
                <div className="flex items-center gap-1.5 text-[13px] text-[#1a1a1a] font-medium min-w-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4285f4" strokeWidth="2" strokeLinecap="round">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                  </svg>
                  <span className="truncate">{selectedDrivePath}</span>
                </div>
                {pagination && (
                  <span className="text-[12px] text-[#999] flex-shrink-0">
                    {pagination.totalItems} document{pagination.totalItems !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {/* Document list for this drive path */}
              <div className="divide-y divide-[#f0f0f0]">
                <div className="px-6 py-2.5 flex items-center gap-4 bg-[#f7f7f5] border-b border-[#e8e8e8] text-[11px] font-semibold text-[#999] uppercase tracking-wider">
                  <div className="w-10 flex-shrink-0">Type</div>
                  <div className="flex-1 min-w-0">Document</div>
                  <div className="w-14 flex-shrink-0 text-right">Confidence</div>
                  <div className="w-24 flex-shrink-0 text-center">Status</div>
                  <div className="w-[104px] flex-shrink-0 text-center">Actions</div>
                </div>
                {filteredItems.map((item) => (
                  <DocumentRow
                    key={item.id}
                    item={item}
                    categories={categories}
                    openReview={openReview}
                    handleRetry={handleRetry}
                    handleMarkAsPushed={handleMarkAsPushed}
                    handleDelete={handleDelete}
                    handleMove={handleMove}
                    retryingId={retryingId}
                    markingPushedId={markingPushedId}
                    deletingId={deletingId}
                    movingId={movingId}
                  />
                ))}
              </div>
            </div>
          ) : (
            <DriveTreeView
              drivePathCounts={globalStats?.drivePathCounts || {}}
              onSelectPath={(path) => { setSelectedDrivePath(path); setCurrentPage(1); }}
            />
          )
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
              <DocumentRow
                key={item.id}
                item={item}
                categories={categories}
                openReview={openReview}
                handleRetry={handleRetry}
                handleMarkAsPushed={handleMarkAsPushed}
                handleDelete={handleDelete}
                handleMove={handleMove}
                retryingId={retryingId}
                markingPushedId={markingPushedId}
                deletingId={deletingId}
                movingId={movingId}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination controls — only show when viewing a document list, not folder listings */}
      {pagination && pagination.totalPages > 1 && !(
        (listView === 'categories' && !selectedCategoryId) ||
        (listView === 'drive' && !selectedDrivePath)
      ) && (
        <PaginationControls
          pagination={pagination}
          onPageChange={(p) => { setCurrentPage(p); fetchItems(p); }}
        />
      )}
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
    amber: { base: 'text-amber-600', active: 'bg-amber-100 text-amber-700' },
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

function ViewToggle({ value, onChange }: { value: ListView; onChange: (v: ListView) => void }) {
  const options: { key: ListView; label: string }[] = [
    { key: 'recent', label: 'Recent' },
    { key: 'categories', label: 'Categories' },
    { key: 'drive', label: 'Drive Folders' },
  ];

  return (
    <div className="flex gap-1 p-0.5 bg-[#f5f5f5] rounded-lg w-fit">
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
            value === opt.key
              ? 'bg-white text-[#1a1a1a] shadow-sm'
              : 'text-[#999] hover:text-[#666]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

interface DocumentRowProps {
  item: PipelineItem;
  categories: CategoryInfo[];
  openReview: (item: PipelineItem) => void;
  handleRetry: (recordId: string, e: React.MouseEvent) => void;
  handleMarkAsPushed: (recordId: string, fileName: string, e: React.MouseEvent) => void;
  handleDelete: (recordId: string, fileName: string, e: React.MouseEvent) => void;
  handleMove: (recordId: string, categoryId: string) => void;
  retryingId: string | null;
  markingPushedId: string | null;
  deletingId: string | null;
  movingId: string | null;
}

function DocumentRow({
  item,
  categories,
  openReview,
  handleRetry,
  handleMarkAsPushed,
  handleDelete,
  handleMove,
  retryingId,
  markingPushedId,
  deletingId,
  movingId,
}: DocumentRowProps) {
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={() => openReview(item)}
      role="button"
      tabIndex={0}
      className="w-full text-left px-6 py-4 hover:bg-[#fafafa] transition-colors flex items-center gap-4 cursor-pointer"
    >
      <DocTypeBadge type={item.documentType} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-[#1a1a1a] truncate">{item.fileName}</span>
          {item.driveWebViewLink && (
            <a
              href={item.driveWebViewLink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="opacity-0 group-hover:opacity-100 text-[#999] hover:text-[#007aff] transition-opacity flex-shrink-0"
              title="Open in Google Drive"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
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

      {item.overallConfidence != null && (
        <span className={`text-[12px] font-medium px-2.5 py-1 rounded-lg flex-shrink-0 ${getConfidenceColor(item.overallConfidence)}`}>
          {Math.round(item.overallConfidence * 100)}%
        </span>
      )}

      <StatusBadge status={item.status} />

      {(item.status === 'queued' || item.status === 'processing') && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <svg className="animate-spin w-3.5 h-3.5 text-yellow-600" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
      )}

      {item.status === 'failed' && (
        <button
          onClick={(e) => handleRetry(item.id, e)}
          disabled={retryingId === item.id}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-colors flex-shrink-0 disabled:opacity-50"
          title="Retry processing"
        >
          {retryingId === item.id ? (
            <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 4v6h6" />
              <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
            </svg>
          )}
          Retry
        </button>
      )}

      {item.status === 'stored_only' && (
        <button
          onClick={(e) => handleRetry(item.id, e)}
          disabled={retryingId === item.id}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition-colors flex-shrink-0 disabled:opacity-50"
          title={`Process this large document (${item.pageCount ? item.pageCount + ' pages' : 'large PDF'})`}
        >
          {retryingId === item.id ? (
            <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          )}
          Process Now{item.pageCount ? ` (${item.pageCount}p)` : ''}
        </button>
      )}

      {item.status !== 'pushed' && item.status !== 'rejected' && item.status !== 'queued' && item.status !== 'processing' && item.status !== 'failed' && item.status !== 'stored_only' && (
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

      {/* Move category dropdown */}
      <div className="relative flex-shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); setShowMoveMenu(!showMoveMenu); }}
          disabled={movingId === item.id}
          className={`p-1.5 rounded-lg transition-colors disabled:opacity-50 ${
            showMoveMenu
              ? 'text-[#007aff] bg-blue-50'
              : 'text-[#ccc] hover:text-[#007aff] hover:bg-blue-50'
          }`}
          title="Move to category"
        >
          {movingId === item.id ? (
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
          )}
        </button>
        {showMoveMenu && (
          <>
            <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setShowMoveMenu(false); }} />
            <div className="absolute right-0 top-full mt-1 z-20 bg-white rounded-xl shadow-lg border border-[#e8e8e8] py-1 min-w-[200px] max-h-[320px] overflow-y-auto">
              <div className="px-3 py-1.5 text-[10px] font-semibold text-[#999] uppercase tracking-wider">Move to category</div>
              {categories.map((cat) => {
                const isActive = item.categoryId === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isActive) handleMove(item.id, cat.id);
                      setShowMoveMenu(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-[13px] flex items-center gap-2 transition-colors ${
                      isActive
                        ? 'text-[#007aff] bg-blue-50/50 font-medium'
                        : 'text-[#555] hover:bg-[#f7f7f5]'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      cat.priority === 'P1' ? 'bg-blue-400'
                        : cat.priority === 'P2' ? 'bg-amber-400'
                        : 'bg-gray-300'
                    }`} />
                    <span className="flex-1 truncate">{cat.label}</span>
                    {isActive && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

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

      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </motion.div>
  );
}

function CollapsibleSection({
  sectionKey,
  label,
  icon,
  count,
  borderColor,
  expanded,
  onToggle,
  children,
}: {
  sectionKey: string;
  label: string;
  icon: React.ReactNode;
  count: number;
  borderColor: string;
  expanded: boolean;
  onToggle: (key: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`border-l-2 ${borderColor}`}>
      <button
        onClick={() => onToggle(sectionKey)}
        className="w-full flex items-center gap-3 px-6 py-3 hover:bg-[#fafafa] transition-colors text-left"
      >
        {icon}
        <span className="text-[14px] font-semibold text-[#1a1a1a] flex-1">{label}</span>
        <span className="text-[11px] font-medium text-[#999] bg-[#f0f0f0] rounded-full px-2 py-0.5">{count}</span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#999"
          strokeWidth="2"
          strokeLinecap="round"
          className={`flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
      {expanded && (
        <div className="divide-y divide-[#f0f0f0]">
          {children}
        </div>
      )}
    </div>
  );
}

const PRIORITY_BORDER_COLORS: Record<string, string> = {
  P1: 'border-blue-400',
  P2: 'border-amber-400',
  P3: 'border-gray-300',
};

function CategoryFolderView({
  items,
  categories,
  expandedSections,
  toggleSection,
  openReview,
  handleRetry,
  handleMarkAsPushed,
  handleDelete,
  handleMove,
  retryingId,
  markingPushedId,
  deletingId,
  movingId,
}: {
  items: PipelineItem[];
  categories: CategoryInfo[];
  expandedSections: Set<string>;
  toggleSection: (key: string) => void;
  openReview: (item: PipelineItem) => void;
  handleRetry: (recordId: string, e: React.MouseEvent) => void;
  handleMarkAsPushed: (recordId: string, fileName: string, e: React.MouseEvent) => void;
  handleDelete: (recordId: string, fileName: string, e: React.MouseEvent) => void;
  handleMove: (recordId: string, categoryId: string) => void;
  retryingId: string | null;
  markingPushedId: string | null;
  deletingId: string | null;
  movingId: string | null;
}) {
  const grouped = new Map<string, PipelineItem[]>();

  for (const item of items) {
    const key = item.categoryId || '__uncategorized';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }

  const sortedCategories = categories
    .filter(c => grouped.has(c.id))
    .sort((a, b) => a.sort_order - b.sort_order);

  const uncategorized = grouped.get('__uncategorized');

  return (
    <div className="divide-y divide-[#e8e8e8]">
      {sortedCategories.map((cat) => {
        const catItems = grouped.get(cat.id) || [];
        return (
          <CollapsibleSection
            key={cat.id}
            sectionKey={`cat-${cat.id}`}
            label={cat.label}
            icon={
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[12px] ${
                cat.priority === 'P1' ? 'bg-blue-100 text-blue-600'
                  : cat.priority === 'P2' ? 'bg-amber-100 text-amber-600'
                  : 'bg-gray-100 text-gray-500'
              }`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                </svg>
              </div>
            }
            count={catItems.length}
            borderColor={PRIORITY_BORDER_COLORS[cat.priority] || 'border-gray-300'}
            expanded={expandedSections.has(`cat-${cat.id}`)}
            onToggle={toggleSection}
          >
            {catItems.map((item) => (
              <DocumentRow
                key={item.id}
                item={item}
                categories={categories}
                openReview={openReview}
                handleRetry={handleRetry}
                handleMarkAsPushed={handleMarkAsPushed}
                handleDelete={handleDelete}
                handleMove={handleMove}
                retryingId={retryingId}
                markingPushedId={markingPushedId}
                deletingId={deletingId}
                movingId={movingId}
              />
            ))}
          </CollapsibleSection>
        );
      })}

      {uncategorized && uncategorized.length > 0 && (
        <CollapsibleSection
          sectionKey="cat-uncategorized"
          label="Uncategorized"
          icon={
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-gray-100 text-gray-400 text-[12px]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
          }
          count={uncategorized.length}
          borderColor="border-gray-200"
          expanded={expandedSections.has('cat-uncategorized')}
          onToggle={toggleSection}
        >
          {uncategorized.map((item) => (
            <DocumentRow
              key={item.id}
              item={item}
              categories={categories}
              openReview={openReview}
              handleRetry={handleRetry}
              handleMarkAsPushed={handleMarkAsPushed}
              handleDelete={handleDelete}
              handleMove={handleMove}
              retryingId={retryingId}
              markingPushedId={markingPushedId}
              deletingId={deletingId}
              movingId={movingId}
            />
          ))}
        </CollapsibleSection>
      )}
    </div>
  );
}

const PRIORITY_BORDER_COLORS_LIST: Record<string, string> = {
  P1: 'border-l-blue-500',
  P2: 'border-l-amber-500',
  P3: 'border-l-gray-300',
};

function ProjectFolderList({
  projectTotalCounts,
  companyWideTotalCount,
  uncategorizedCount,
  onSelectProject,
}: {
  projectTotalCounts: Record<string, number>;
  companyWideTotalCount: number;
  uncategorizedCount: number;
  onSelectProject: (project: string) => void;
}) {
  const sortedProjects = Object.entries(projectTotalCounts)
    .filter(([key]) => key !== '__no_project')
    .sort((a, b) => a[0].localeCompare(b[0]));
  const noProjectCount = projectTotalCounts['__no_project'] || 0;

  return (
    <div className="divide-y divide-[#e8e8e8]">
      {sortedProjects.map(([project, count]) => (
        <button
          key={project}
          onClick={() => onSelectProject(project)}
          className="w-full px-6 py-3 flex items-center gap-3 hover:bg-[#f7f7f5] transition-colors text-left border-l-3 border-l-blue-500"
        >
          <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-blue-100 text-blue-600 text-[12px]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <span className="flex-1 text-[14px] font-medium text-[#1a1a1a]">{project}</span>
          {count > 0 && (
            <span className="text-[12px] text-[#999] bg-[#f0f0f0] px-2.5 py-0.5 rounded-full font-medium">{count}</span>
          )}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="2" strokeLinecap="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      ))}

      {companyWideTotalCount > 0 && (
        <button
          onClick={() => onSelectProject('__company_wide')}
          className="w-full px-6 py-3 flex items-center gap-3 hover:bg-[#f7f7f5] transition-colors text-left border-l-3 border-l-amber-500"
        >
          <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-amber-100 text-amber-600 text-[12px]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
              <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
            </svg>
          </div>
          <span className="flex-1 text-[14px] font-medium text-[#1a1a1a]">Company-Wide</span>
          <span className="text-[12px] text-[#999] bg-[#f0f0f0] px-2.5 py-0.5 rounded-full font-medium">{companyWideTotalCount}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="2" strokeLinecap="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      )}

      {noProjectCount > 0 && (
        <button
          onClick={() => onSelectProject('__no_project')}
          className="w-full px-6 py-3 flex items-center gap-3 hover:bg-[#f7f7f5] transition-colors text-left border-l-3 border-l-gray-300"
        >
          <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-gray-100 text-gray-500 text-[12px]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
          </div>
          <span className="flex-1 text-[14px] font-medium text-[#777]">No Project</span>
          <span className="text-[12px] text-[#999] bg-[#f0f0f0] px-2.5 py-0.5 rounded-full font-medium">{noProjectCount}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="2" strokeLinecap="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      )}

      {uncategorizedCount > 0 && (
        <button
          onClick={() => onSelectProject('__uncategorized')}
          className="w-full px-6 py-3 flex items-center gap-3 hover:bg-[#f7f7f5] transition-colors text-left border-l-3 border-l-gray-200"
        >
          <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-gray-100 text-gray-400 text-[12px]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <span className="flex-1 text-[14px] font-medium text-[#777]">Uncategorized</span>
          <span className="text-[12px] text-[#999] bg-[#f0f0f0] px-2.5 py-0.5 rounded-full font-medium">{uncategorizedCount}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="2" strokeLinecap="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      )}

      {sortedProjects.length === 0 && companyWideTotalCount === 0 && noProjectCount === 0 && uncategorizedCount === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-[14px] font-medium text-[#1a1a1a]">No projects yet</p>
          <p className="text-[13px] text-[#999] mt-1">
            Scan Google Drive or upload documents to see projects here
          </p>
        </div>
      )}
    </div>
  );
}

function ProjectCategoryList({
  projectName,
  categories,
  projectCategoryCounts,
  onSelectCategory,
  onBack,
}: {
  projectName: string;
  categories: CategoryInfo[];
  projectCategoryCounts: Record<string, number>;
  onSelectCategory: (catId: string) => void;
  onBack: () => void;
}) {
  const isCompanyWide = projectName === '__company_wide';
  const displayName = isCompanyWide ? 'Company-Wide' : projectName === '__no_project' ? 'No Project' : projectName;

  const COMPANY_WIDE_KEYS = new Set(['20_financials', '21_bid_log', '22_gc_contacts', '23_employee_roster', '24_insurance_and_bonding', '25_equipment']);
  const filteredCategories = isCompanyWide
    ? categories.filter(c => COMPANY_WIDE_KEYS.has(c.key))
    : categories.filter(c => !COMPANY_WIDE_KEYS.has(c.key));

  const sorted = [...filteredCategories].sort((a, b) => a.sort_order - b.sort_order);
  const totalDocs = Object.values(projectCategoryCounts).reduce((sum, n) => sum + n, 0);

  return (
    <div>
      <div className="px-6 py-3 bg-[#f7f7f5] border-b border-[#e8e8e8] flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[13px] text-[#555] hover:text-[#1a1a1a] transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <span className="text-[14px] font-semibold text-[#1a1a1a]">{displayName}</span>
        <span className="text-[12px] text-[#999]">
          {totalDocs} document{totalDocs !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="divide-y divide-[#e8e8e8]">
        {sorted.map((cat) => {
          const count = projectCategoryCounts[cat.id] || 0;
          return (
            <button
              key={cat.id}
              onClick={() => onSelectCategory(cat.id)}
              className={`w-full px-6 py-3 flex items-center gap-3 hover:bg-[#f7f7f5] transition-colors text-left border-l-3 ${
                PRIORITY_BORDER_COLORS_LIST[cat.priority] || 'border-l-gray-200'
              }`}
            >
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[12px] ${
                cat.priority === 'P1' ? 'bg-blue-100 text-blue-600'
                  : cat.priority === 'P2' ? 'bg-amber-100 text-amber-600'
                  : 'bg-gray-100 text-gray-500'
              }`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                </svg>
              </div>
              <span className="flex-1 text-[14px] font-medium text-[#1a1a1a]">{cat.label}</span>
              {count > 0 && (
                <span className="text-[12px] text-[#999] bg-[#f0f0f0] px-2.5 py-0.5 rounded-full font-medium">{count}</span>
              )}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="2" strokeLinecap="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          );
        })}

        {sorted.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-[13px] text-[#999]">No categorized documents in this project</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Drive Tree View (nested folder structure) ────────────────

interface TreeNode {
  name: string;
  fullPath: string;
  directCount: number;
  totalCount: number;
  children: TreeNode[];
}

function buildDriveTree(pathCounts: Record<string, number>): TreeNode[] {
  const root: TreeNode[] = [];
  const nodeMap = new Map<string, TreeNode>();

  const sortedPaths = Object.keys(pathCounts).sort();

  for (const fullPath of sortedPaths) {
    const segments = fullPath.split(' / ');
    let currentPath = '';

    for (let i = 0; i < segments.length; i++) {
      const prevPath = currentPath;
      currentPath = i === 0 ? segments[i] : `${currentPath} / ${segments[i]}`;

      if (!nodeMap.has(currentPath)) {
        const node: TreeNode = {
          name: segments[i],
          fullPath: currentPath,
          directCount: 0,
          totalCount: 0,
          children: [],
        };
        nodeMap.set(currentPath, node);

        if (i === 0) {
          root.push(node);
        } else {
          const parent = nodeMap.get(prevPath);
          if (parent) parent.children.push(node);
        }
      }
    }

    const node = nodeMap.get(fullPath);
    if (node) {
      node.directCount = pathCounts[fullPath];
    }
  }

  function computeTotals(node: TreeNode): number {
    let total = node.directCount;
    for (const child of node.children) {
      total += computeTotals(child);
    }
    node.totalCount = total;
    return total;
  }

  for (const rootNode of root) {
    computeTotals(rootNode);
  }

  return root;
}

function DriveTreeView({
  drivePathCounts,
  onSelectPath,
}: {
  drivePathCounts: Record<string, number>;
  onSelectPath: (path: string) => void;
}) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildDriveTree(drivePathCounts), [drivePathCounts]);

  const toggleExpand = useCallback((path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  if (tree.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-[14px] font-medium text-[#1a1a1a]">No Drive files</p>
        <p className="text-[13px] text-[#999] mt-1">
          Scan Google Drive to see folder structure here
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[#e8e8e8]">
      {tree.map((node) => (
        <DriveTreeNode
          key={node.fullPath}
          node={node}
          depth={0}
          expandedNodes={expandedNodes}
          toggleExpand={toggleExpand}
          onSelectPath={onSelectPath}
        />
      ))}
    </div>
  );
}

function DriveTreeNode({
  node,
  depth,
  expandedNodes,
  toggleExpand,
  onSelectPath,
}: {
  node: TreeNode;
  depth: number;
  expandedNodes: Set<string>;
  toggleExpand: (path: string, e: React.MouseEvent) => void;
  onSelectPath: (path: string) => void;
}) {
  const isExpanded = expandedNodes.has(node.fullPath);
  const hasChildren = node.children.length > 0;

  return (
    <>
      <div
        className="flex items-center gap-2 hover:bg-[#f7f7f5] transition-colors cursor-pointer"
        style={{ paddingLeft: `${24 + depth * 20}px`, paddingRight: 24, paddingTop: 10, paddingBottom: 10 }}
      >
        {/* Expand/collapse toggle */}
        {hasChildren ? (
          <button
            onClick={(e) => toggleExpand(node.fullPath, e)}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-[#e8e8e8] transition-colors flex-shrink-0"
          >
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round"
              className={`transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        ) : (
          <div className="w-5 h-5 flex-shrink-0" />
        )}

        {/* Folder icon */}
        <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${
          depth === 0 ? 'bg-[#4285f4]/10 text-[#4285f4]' : 'bg-gray-100 text-gray-400'
        }`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
        </div>

        {/* Folder name — clicking navigates to see docs */}
        <button
          onClick={() => node.directCount > 0 ? onSelectPath(node.fullPath) : toggleExpand(node.fullPath, { stopPropagation: () => {} } as React.MouseEvent)}
          className="flex-1 text-left min-w-0"
        >
          <span className={`text-[13px] truncate block ${
            depth === 0 ? 'font-semibold text-[#1a1a1a]' : 'font-medium text-[#333]'
          }`}>
            {node.name}
          </span>
        </button>

        {/* Counts */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {node.directCount > 0 && (
            <button
              onClick={() => onSelectPath(node.fullPath)}
              className="text-[11px] text-[#4285f4] bg-[#4285f4]/8 px-2 py-0.5 rounded-full font-medium hover:bg-[#4285f4]/15 transition-colors"
            >
              {node.directCount} file{node.directCount !== 1 ? 's' : ''}
            </button>
          )}
          {hasChildren && (
            <span className="text-[11px] text-[#999] bg-[#f0f0f0] px-2 py-0.5 rounded-full font-medium">
              {node.totalCount} total
            </span>
          )}
        </div>

        {/* Chevron for navigation */}
        {node.directCount > 0 && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0">
            <path d="M9 18l6-6-6-6" />
          </svg>
        )}
      </div>

      {/* Children (when expanded) */}
      {isExpanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <DriveTreeNode
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              expandedNodes={expandedNodes}
              toggleExpand={toggleExpand}
              onSelectPath={onSelectPath}
            />
          ))}
        </div>
      )}
    </>
  );
}

function DrivePathFolderView({
  items,
  categories,
  expandedSections,
  toggleSection,
  openReview,
  handleRetry,
  handleMarkAsPushed,
  handleDelete,
  handleMove,
  retryingId,
  markingPushedId,
  deletingId,
  movingId,
}: {
  items: PipelineItem[];
  categories: CategoryInfo[];
  expandedSections: Set<string>;
  toggleSection: (key: string) => void;
  openReview: (item: PipelineItem) => void;
  handleRetry: (recordId: string, e: React.MouseEvent) => void;
  handleMarkAsPushed: (recordId: string, fileName: string, e: React.MouseEvent) => void;
  handleDelete: (recordId: string, fileName: string, e: React.MouseEvent) => void;
  handleMove: (recordId: string, categoryId: string) => void;
  retryingId: string | null;
  markingPushedId: string | null;
  deletingId: string | null;
  movingId: string | null;
}) {
  const grouped = new Map<string, PipelineItem[]>();

  for (const item of items) {
    const key = item.driveFolderPath || '__manual';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }

  const sortedPaths = Array.from(grouped.keys())
    .filter(k => k !== '__manual')
    .sort((a, b) => a.localeCompare(b));

  const manualItems = grouped.get('__manual');

  return (
    <div className="divide-y divide-[#e8e8e8]">
      {sortedPaths.map((folderPath) => {
        const pathItems = grouped.get(folderPath) || [];
        return (
          <CollapsibleSection
            key={folderPath}
            sectionKey={`drive-${folderPath}`}
            label={folderPath}
            icon={
              <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-[#4285f4]/10 text-[#4285f4] text-[12px]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                </svg>
              </div>
            }
            count={pathItems.length}
            borderColor="border-[#4285f4]/40"
            expanded={expandedSections.has(`drive-${folderPath}`)}
            onToggle={toggleSection}
          >
            {pathItems.map((item) => (
              <DocumentRow
                key={item.id}
                item={item}
                categories={categories}
                openReview={openReview}
                handleRetry={handleRetry}
                handleMarkAsPushed={handleMarkAsPushed}
                handleDelete={handleDelete}
                handleMove={handleMove}
                retryingId={retryingId}
                markingPushedId={markingPushedId}
                deletingId={deletingId}
                movingId={movingId}
              />
            ))}
          </CollapsibleSection>
        );
      })}

      {manualItems && manualItems.length > 0 && (
        <CollapsibleSection
          sectionKey="drive-manual"
          label="Manual Uploads"
          icon={
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-gray-100 text-gray-500 text-[12px]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 15V19a2 2 0 01-2 2H5a2 2 0 01-2-2V15" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
          }
          count={manualItems.length}
          borderColor="border-gray-200"
          expanded={expandedSections.has('drive-manual')}
          onToggle={toggleSection}
        >
          {manualItems.map((item) => (
            <DocumentRow
              key={item.id}
              item={item}
              categories={categories}
              openReview={openReview}
              handleRetry={handleRetry}
              handleMarkAsPushed={handleMarkAsPushed}
              handleDelete={handleDelete}
              handleMove={handleMove}
              retryingId={retryingId}
              markingPushedId={markingPushedId}
              deletingId={deletingId}
              movingId={movingId}
            />
          ))}
        </CollapsibleSection>
      )}
    </div>
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
          i++;
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
    cells.push(current);
    rows.push(cells);
  }

  return rows;
}

// ─── Ingestion Progress Bar ─────────────────────────────────

function IngestionProgressBar({ stats, onStopIngest, stopping }: { stats: GlobalStats; onStopIngest: () => void; stopping?: boolean }) {
  const done = stats.completed + stats.failed + stats.storedOnly;
  const inFlight = stats.processing;
  const total = stats.total;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const byStatus = stats.byStatus || {};
  const isActive = inFlight > 0;

  return (
    <div className={`px-6 py-3 ${isActive ? 'bg-gradient-to-r from-blue-50 to-indigo-50' : 'bg-[#f8f9fa]'}`}>
      <div className="flex items-center gap-4 mb-2">
        <div className="flex items-center gap-2">
          {isActive && (
            <div className="relative w-4 h-4">
              <svg className="animate-spin w-4 h-4 text-blue-600" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </div>
          )}
          <span className="text-[13px] font-semibold text-[#1a1a1a]">
            {isActive ? 'Ingesting documents' : 'Ingestion Summary'}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[12px] text-[#555]">
          {isActive && (
            <>
              <span>
                <span className="font-bold text-blue-700">{inFlight}</span> processing
              </span>
              <span className="text-[#ccc]">&middot;</span>
            </>
          )}
          <span>
            <span className="font-bold text-green-700">{stats.completed}</span> completed
          </span>
          {(byStatus.failed || 0) > 0 && (
            <>
              <span className="text-[#ccc]">&middot;</span>
              <span>
                <span className="font-bold text-red-600">{byStatus.failed}</span> failed
              </span>
            </>
          )}
          {stats.storedOnly > 0 && (
            <>
              <span className="text-[#ccc]">&middot;</span>
              <span>
                <span className="font-bold text-indigo-600">{stats.storedOnly}</span> stored (large)
              </span>
            </>
          )}
          <span className="text-[#ccc]">&middot;</span>
          <span>
            <span className="font-bold text-[#333]">{total}</span> total
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[12px] font-bold text-blue-700">{pct}%</span>
          {isActive && (
            <button
              onClick={onStopIngest}
              disabled={stopping}
              className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-red-100 text-red-700 hover:bg-red-200 transition-colors border border-red-200 disabled:opacity-50"
            >
              {stopping ? 'Stopping...' : 'Stop Ingest'}
            </button>
          )}
        </div>
      </div>
      <div className="h-2 bg-white/60 rounded-full overflow-hidden border border-blue-100">
        <div className="h-full flex transition-all duration-700 ease-out">
          {/* Completed portion */}
          <div
            className="bg-gradient-to-r from-green-400 to-green-500 transition-all duration-700"
            style={{ width: `${total > 0 ? (stats.completed / total) * 100 : 0}%` }}
          />
          {/* Failed portion */}
          {(byStatus.failed || 0) > 0 && (
            <div
              className="bg-red-400 transition-all duration-700"
              style={{ width: `${(byStatus.failed / total) * 100}%` }}
            />
          )}
          {/* Stored only portion */}
          {stats.storedOnly > 0 && (
            <div
              className="bg-indigo-300 transition-all duration-700"
              style={{ width: `${(stats.storedOnly / total) * 100}%` }}
            />
          )}
          {/* Processing portion (animated) */}
          {isActive && (
            <div
              className="bg-gradient-to-r from-blue-400 to-blue-500 animate-pulse transition-all duration-700"
              style={{ width: `${total > 0 ? (inFlight / total) * 100 : 0}%` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Pagination Controls ────────────────────────────────────

function PaginationControls({
  pagination,
  onPageChange,
}: {
  pagination: PaginationInfo;
  onPageChange: (page: number) => void;
}) {
  const { page, totalPages, totalItems, pageSize } = pagination;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);

  const pageNumbers = (() => {
    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('ellipsis');
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
        pages.push(i);
      }
      if (page < totalPages - 2) pages.push('ellipsis');
      pages.push(totalPages);
    }
    return pages;
  })();

  return (
    <div className="px-6 py-3 border-t border-[#e8e8e8] bg-[#fafafa] flex items-center justify-between">
      <span className="text-[12px] text-[#999]">
        Showing {from}–{to} of {totalItems.toLocaleString()} documents
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-[#555] hover:bg-white hover:shadow-sm border border-transparent hover:border-[#e0e0e0] transition-all disabled:opacity-30 disabled:pointer-events-none"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        {pageNumbers.map((p, i) =>
          p === 'ellipsis' ? (
            <span key={`e-${i}`} className="px-1 text-[12px] text-[#999]">&hellip;</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`min-w-[32px] px-2 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                p === page
                  ? 'bg-[#1a1a1a] text-white shadow-sm'
                  : 'text-[#555] hover:bg-white hover:shadow-sm border border-transparent hover:border-[#e0e0e0]'
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-[#555] hover:bg-white hover:shadow-sm border border-transparent hover:border-[#e0e0e0] transition-all disabled:opacity-30 disabled:pointer-events-none"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
