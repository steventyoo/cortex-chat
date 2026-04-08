'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

interface Skill {
  id: string;
  skill_id: string;
  display_name: string;
  status: string;
  version: number;
  field_definitions: Array<{ name: string; type: string; tier: number; required: boolean; description: string }>;
  classifier_hints: { description: string; keywords: string[] } | null;
  sample_extractions: Array<{ inputSnippet: string; expectedOutput: Record<string, unknown> }>;
  system_prompt: string;
  extraction_instructions: string;
  reference_doc_ids: string[];
  created_at: string;
  updated_at: string;
}

function OperatorNav() {
  const pathname = usePathname();
  const tabs = [
    { label: 'Skills', href: '/operator/skills' },
    { label: 'Doc Links', href: '/operator/doc-links' },
    { label: 'Chat Tools', href: '/operator/chat-tools' },
  ];

  return (
    <nav className="border-b border-[#e8e8e8] bg-[#fafafa]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center h-12 gap-8">
          <Link href="/operator/skills" className="text-[15px] font-semibold text-[#1a1a1a] tracking-tight">
            Operator Workbench
          </Link>
          <div className="flex items-center gap-1">
            {tabs.map(tab => (
              <Link
                key={tab.href}
                href={tab.href}
                className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                  pathname.startsWith(tab.href)
                    ? 'bg-[#1a1a1a] text-white'
                    : 'text-[#6b6b6b] hover:text-[#1a1a1a] hover:bg-[#f0f0f0]'
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </div>
          <div className="flex-1" />
          <Link href="/" className="text-[12px] text-[#999] hover:text-[#666] transition-colors">
            Back to App
          </Link>
        </div>
      </div>
    </nav>
  );
}

function CreateSkillModal({ onClose, onCreated }: { onClose: () => void; onCreated: (skillId: string) => void }) {
  const [skillId, setSkillId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // Auto-generate mode
  const [mode, setMode] = useState<'manual' | 'generate'>('manual');
  const [generating, setGenerating] = useState(false);
  const [generatedFields, setGeneratedFields] = useState<Array<{ name: string; type: string; tier: number; required: boolean; description: string }> | null>(null);

  const autoSkillId = displayName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_');

  const handleCreate = async () => {
    const finalSkillId = skillId || autoSkillId;
    if (!finalSkillId || !displayName) {
      setError('Display name is required');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skillId: finalSkillId,
          displayName,
          fieldDefinitions: generatedFields || [],
          status: 'draft',
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to create skill');
        return;
      }
      onCreated(finalSkillId);
    } catch {
      setError('Network error');
    }
    setCreating(false);
  };

  const handleGenerate = async (file: File) => {
    setGenerating(true);
    setError('');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/skills/generate', { method: 'POST', body: formData });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Generation failed');
        setGenerating(false);
        return;
      }
      const data = await res.json();
      if (data.displayName) setDisplayName(data.displayName);
      if (data.description) setDescription(data.description);
      if (data.fieldDefinitions) setGeneratedFields(data.fieldDefinitions);
      if (data.skillId) setSkillId(data.skillId);
    } catch {
      setError('Network error');
    }
    setGenerating(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-[#f0f0f0]">
          <h2 className="text-[17px] font-semibold text-[#1a1a1a]">Create New Skill</h2>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Mode toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setMode('manual')}
              className={`flex-1 py-2 rounded-lg text-[13px] font-medium transition-colors border ${
                mode === 'manual' ? 'bg-[#1a1a1a] text-white border-[#1a1a1a]' : 'text-[#666] border-[#e0e0e0] hover:bg-[#f8f8f8]'
              }`}
            >
              Manual
            </button>
            <button
              onClick={() => setMode('generate')}
              className={`flex-1 py-2 rounded-lg text-[13px] font-medium transition-colors border ${
                mode === 'generate' ? 'bg-[#1a1a1a] text-white border-[#1a1a1a]' : 'text-[#666] border-[#e0e0e0] hover:bg-[#f8f8f8]'
              }`}
            >
              Auto-generate from Document
            </button>
          </div>

          {mode === 'generate' && !generatedFields && (
            <div className="border-2 border-dashed border-[#e0e0e0] rounded-xl py-8 text-center">
              {generating ? (
                <div className="flex items-center justify-center gap-2 text-[14px] text-[#999]">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Analyzing document with Claude...
                </div>
              ) : (
                <label className="cursor-pointer">
                  <p className="text-[14px] text-[#999]">Upload a sample document</p>
                  <p className="text-[12px] text-[#ccc] mt-1">Claude will propose a schema based on its contents</p>
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.docx,.doc,.xlsx,.txt,.csv,.png,.jpg,.jpeg"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleGenerate(f); e.target.value = ''; }}
                  />
                </label>
              )}
            </div>
          )}

          {generatedFields && (
            <div className="px-3 py-2 rounded-lg bg-[#f0fdf4] border border-[#bbf7d0] text-[13px] text-[#166534]">
              Generated {generatedFields.length} fields from document. Review and edit below.
            </div>
          )}

          <div>
            <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Display Name</label>
            <input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff]"
              placeholder="e.g. Purchase Order"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Skill ID (auto-generated)</label>
            <input
              value={skillId || autoSkillId}
              onChange={e => setSkillId(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff]"
              placeholder="purchase_order"
            />
          </div>

          {generatedFields && (
            <div>
              <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide mb-1 block">
                Proposed Fields ({generatedFields.length})
              </label>
              <div className="max-h-[200px] overflow-y-auto border border-[#e8e8e8] rounded-lg">
                {generatedFields.map((f, i) => (
                  <div key={i} className={`flex items-center gap-2 px-3 py-2 text-[12px] ${i > 0 ? 'border-t border-[#f0f0f0]' : ''}`}>
                    <span className="font-medium text-[#1a1a1a] w-[140px] truncate">{f.name}</span>
                    <span className="text-[#999] font-mono">{f.type}</span>
                    <span className={`text-[10px] px-1 rounded ${f.tier === 1 ? 'bg-[#dbeafe] text-[#1e40af]' : 'bg-[#f0f0f0] text-[#888]'}`}>T{f.tier}</span>
                    {f.required && <span className="text-[10px] text-[#dc2626]">req</span>}
                    <span className="flex-1 text-[#b4b4b4] truncate">{f.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="px-4 py-2 rounded-lg bg-[#fef2f2] text-[#dc2626] text-[13px]">{error}</div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#f0f0f0] flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-[13px] text-[#666] hover:bg-[#f0f0f0] transition-colors">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!displayName.trim() || creating}
            className="px-4 py-2 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors disabled:opacity-40"
          >
            {creating ? 'Creating...' : 'Create Skill'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OperatorSkillsPage() {
  const router = useRouter();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'draft' | 'archived'>('all');
  const [showCreate, setShowCreate] = useState(false);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/skills?status=${filter}`);
      if (res.ok) {
        const data = await res.json();
        setSkills(data.skills || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [filter]);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  const filtered = skills;

  return (
    <div className="min-h-screen bg-white">
      <OperatorNav />

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-[22px] font-semibold text-[#1a1a1a] tracking-tight">Document Skills</h1>
            <p className="text-[14px] text-[#999] mt-1">
              Configure how the system classifies, extracts, and understands each document type.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors"
          >
            + Create Skill
          </button>
        </div>

        {showCreate && (
          <CreateSkillModal
            onClose={() => setShowCreate(false)}
            onCreated={(sid) => { setShowCreate(false); router.push(`/operator/skills/${sid}`); }}
          />
        )}

        {/* Filter tabs */}
        <div className="flex items-center gap-1 mb-6">
          {(['all', 'active', 'draft', 'archived'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors capitalize ${
                filter === f
                  ? 'bg-[#f0f0f0] text-[#1a1a1a]'
                  : 'text-[#999] hover:text-[#666] hover:bg-[#fafafa]'
              }`}
            >
              {f}
            </button>
          ))}
          <span className="text-[12px] text-[#ccc] ml-2">{filtered.length} skill{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex items-center gap-3 text-[14px] text-[#999]">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              Loading skills...
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-[14px] text-[#999]">No skills found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(skill => (
              <Link
                key={skill.id}
                href={`/operator/skills/${skill.skill_id}`}
                className="block border border-[#e8e8e8] rounded-xl p-5 hover:border-[#ccc] hover:shadow-sm transition-all group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-[15px] font-semibold text-[#1a1a1a] group-hover:text-[#007aff] transition-colors">
                      {skill.display_name}
                    </h3>
                    <p className="text-[12px] text-[#b4b4b4] font-mono mt-0.5">{skill.skill_id}</p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wide ${
                    skill.status === 'active' ? 'bg-[#dcfce7] text-[#166534]' :
                    skill.status === 'draft' ? 'bg-[#fef3c7] text-[#92400e]' :
                    'bg-[#f0f0f0] text-[#999]'
                  }`}>
                    {skill.status}
                  </span>
                </div>

                {skill.classifier_hints?.description && (
                  <p className="text-[13px] text-[#6b6b6b] mb-3 line-clamp-2">
                    {skill.classifier_hints.description}
                  </p>
                )}

                <div className="flex items-center gap-4 text-[12px] text-[#b4b4b4]">
                  <span>{skill.field_definitions?.length || 0} fields</span>
                  <span>v{skill.version}</span>
                  <span>{skill.sample_extractions?.length || 0} examples</span>
                </div>

                {skill.classifier_hints?.keywords && skill.classifier_hints.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-3">
                    {skill.classifier_hints.keywords.slice(0, 5).map((kw, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-md bg-[#f5f5f5] text-[#888]">
                        {kw}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
