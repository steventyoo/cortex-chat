'use client';

import { useState, useEffect, useCallback } from 'react';

interface KnowledgeDoc {
  id: string;
  title: string;
  file_name: string;
  mime_type: string;
  chunk_count: number;
  created_at: string;
}

interface Props {
  referenceDocIds: string[];
  setReferenceDocIds: (ids: string[]) => void;
  markDirty: () => void;
}

export default function SkillReferencesTab({ referenceDocIds, setReferenceDocIds, markDirty }: Props) {
  const [allDocs, setAllDocs] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/knowledge');
      if (res.ok) {
        const data = await res.json();
        setAllDocs(data.documents || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError('');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', file.name.replace(/\.[^.]+$/, ''));

    try {
      const res = await fetch('/api/knowledge/upload', { method: 'POST', body: formData });
      if (!res.ok) {
        const data = await res.json();
        setUploadError(data.error || 'Upload failed');
      } else {
        const data = await res.json();
        setAllDocs(prev => [data.document, ...prev]);
        // Auto-link to this skill
        if (data.document?.id && !referenceDocIds.includes(data.document.id)) {
          setReferenceDocIds([...referenceDocIds, data.document.id]);
          markDirty();
        }
      }
    } catch {
      setUploadError('Network error');
    }
    setUploading(false);
    e.target.value = '';
  };

  const toggleLink = (docId: string) => {
    if (referenceDocIds.includes(docId)) {
      setReferenceDocIds(referenceDocIds.filter(id => id !== docId));
    } else {
      setReferenceDocIds([...referenceDocIds, docId]);
    }
    markDirty();
  };

  const deleteDoc = async (docId: string) => {
    try {
      await fetch(`/api/knowledge/${docId}`, { method: 'DELETE' });
      setAllDocs(prev => prev.filter(d => d.id !== docId));
      if (referenceDocIds.includes(docId)) {
        setReferenceDocIds(referenceDocIds.filter(id => id !== docId));
        markDirty();
      }
    } catch { /* ignore */ }
  };

  const linked = allDocs.filter(d => referenceDocIds.includes(d.id));
  const unlinked = allDocs.filter(d => !referenceDocIds.includes(d.id));

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[16px] font-semibold text-[#1a1a1a]">Reference Documents</h2>
          <p className="text-[13px] text-[#999] mt-0.5">
            Upload domain reference materials (specs, manuals, textbooks). Relevant chunks are retrieved
            during extraction to provide context.
          </p>
        </div>
        <label className={`px-3 py-1.5 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
          {uploading ? 'Uploading...' : '+ Upload'}
          <input type="file" className="hidden" onChange={handleUpload} accept=".pdf,.docx,.doc,.xlsx,.txt,.csv" />
        </label>
      </div>

      {uploadError && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-[#fef2f2] text-[#dc2626] text-[13px]">{uploadError}</div>
      )}

      {/* Linked documents */}
      {linked.length > 0 && (
        <div className="mb-6">
          <p className="text-[12px] font-medium text-[#999] uppercase tracking-wide mb-2">
            Linked to this skill ({linked.length})
          </p>
          <div className="space-y-2">
            {linked.map(doc => (
              <DocRow key={doc.id} doc={doc} isLinked onToggle={() => toggleLink(doc.id)} onDelete={() => deleteDoc(doc.id)} />
            ))}
          </div>
        </div>
      )}

      {/* Available documents */}
      {!loading && unlinked.length > 0 && (
        <div>
          <p className="text-[12px] font-medium text-[#999] uppercase tracking-wide mb-2">
            Available ({unlinked.length})
          </p>
          <div className="space-y-2">
            {unlinked.map(doc => (
              <DocRow key={doc.id} doc={doc} isLinked={false} onToggle={() => toggleLink(doc.id)} onDelete={() => deleteDoc(doc.id)} />
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="py-12 text-center text-[14px] text-[#999]">Loading documents...</div>
      )}

      {!loading && allDocs.length === 0 && (
        <div className="py-12 text-center text-[14px] text-[#999]">
          No reference documents yet. Upload PDFs, Word docs, or spreadsheets.
        </div>
      )}
    </div>
  );
}

function DocRow({ doc, isLinked, onToggle, onDelete }: {
  doc: KnowledgeDoc; isLinked: boolean;
  onToggle: () => void; onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border border-[#e8e8e8] rounded-lg px-4 py-3 hover:border-[#ddd] transition-colors">
      <button
        onClick={onToggle}
        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
          isLinked ? 'bg-[#1a1a1a] border-[#1a1a1a]' : 'border-[#d0d0d0] hover:border-[#999]'
        }`}
      >
        {isLinked && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        )}
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-[#1a1a1a] truncate">{doc.title || doc.file_name}</p>
        <div className="flex items-center gap-2 text-[11px] text-[#b4b4b4] mt-0.5">
          <span>{doc.file_name}</span>
          <span>&middot;</span>
          <span>{doc.chunk_count} chunks</span>
        </div>
      </div>
      <button onClick={onDelete} className="text-[11px] text-[#dc2626] hover:underline flex-shrink-0">
        Delete
      </button>
    </div>
  );
}
