'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import SkillFieldsTab from '@/components/operator/SkillFieldsTab';
import SkillPromptTab from '@/components/operator/SkillPromptTab';
import SkillClassifierTab from '@/components/operator/SkillClassifierTab';
import SkillFewShotTab from '@/components/operator/SkillFewShotTab';
import SkillReferencesTab from '@/components/operator/SkillReferencesTab';
import SkillTestTab from '@/components/operator/SkillTestTab';
import SkillVersionsTab from '@/components/operator/SkillVersionsTab';
import SkillOrgConfigTab from '@/components/operator/SkillOrgConfigTab';

export interface FieldDef {
  name: string;
  type: 'string' | 'number' | 'date' | 'enum' | 'boolean' | 'array';
  tier: 1 | 2 | 3;
  required: boolean;
  description: string;
  options?: string[];
  disambiguationRules?: string;
}

export interface SkillData {
  id: string;
  skill_id: string;
  display_name: string;
  status: string;
  version: number;
  system_prompt: string;
  extraction_instructions: string;
  field_definitions: FieldDef[];
  classifier_hints: { description: string; keywords: string[] } | null;
  sample_extractions: Array<{ inputSnippet: string; expectedOutput: Record<string, unknown> }>;
  reference_doc_ids: string[];
  target_table: string;
  column_mapping: Record<string, string>;
  created_at: string;
  updated_at: string;
}

type TabId = 'fields' | 'prompt' | 'classifier' | 'fewshot' | 'references' | 'test' | 'versions' | 'orgs';

const TABS: { id: TabId; label: string }[] = [
  { id: 'fields', label: 'Fields' },
  { id: 'prompt', label: 'Prompt' },
  { id: 'classifier', label: 'Classifier' },
  { id: 'fewshot', label: 'Few-shot' },
  { id: 'references', label: 'Reference Docs' },
  { id: 'test', label: 'Test' },
  { id: 'versions', label: 'Versions' },
  { id: 'orgs', label: 'Orgs' },
];

export default function SkillDetailPage() {
  const params = useParams();
  const router = useRouter();
  const skillId = params.skillId as string;

  const [skill, setSkill] = useState<SkillData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('fields');
  const [dirty, setDirty] = useState(false);

  // Local editable state
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [extractionInstructions, setExtractionInstructions] = useState('');
  const [classifierHints, setClassifierHints] = useState<{ description: string; keywords: string[] }>({ description: '', keywords: [] });
  const [sampleExtractions, setSampleExtractions] = useState<Array<{ inputSnippet: string; expectedOutput: Record<string, unknown> }>>([]);
  const [referenceDocIds, setReferenceDocIds] = useState<string[]>([]);

  const fetchSkill = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/skills/${skillId}`);
      if (!res.ok) { router.push('/operator/skills'); return; }
      const data = await res.json();
      const s = data.skill as SkillData;
      setSkill(s);
      setFields(s.field_definitions || []);
      setSystemPrompt(s.system_prompt || '');
      setExtractionInstructions(s.extraction_instructions || '');
      setClassifierHints(s.classifier_hints || { description: '', keywords: [] });
      setSampleExtractions(s.sample_extractions || []);
      setReferenceDocIds(s.reference_doc_ids || []);
      setDirty(false);
    } catch { router.push('/operator/skills'); }
    setLoading(false);
  }, [skillId, router]);

  useEffect(() => { fetchSkill(); }, [fetchSkill]);

  const handleSave = async () => {
    if (!skill) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/skills/${skillId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fieldDefinitions: fields,
          systemPrompt,
          extractionInstructions,
          classifierHints,
          sampleExtractions,
          referenceDocIds,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSkill(data.skill);
        setDirty(false);
      }
    } catch { /* ignore */ }
    setSaving(false);
  };

  const markDirty = () => setDirty(true);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="flex items-center gap-3 text-[14px] text-[#999]">
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Loading skill...
        </div>
      </div>
    );
  }

  if (!skill) return null;

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="border-b border-[#e8e8e8] bg-[#fafafa]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center h-12 gap-4">
            <Link href="/operator/skills" className="text-[13px] text-[#999] hover:text-[#666] transition-colors">
              Skills
            </Link>
            <span className="text-[#ddd]">/</span>
            <span className="text-[14px] font-semibold text-[#1a1a1a]">{skill.display_name}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wide ${
              skill.status === 'active' ? 'bg-[#dcfce7] text-[#166534]' :
              skill.status === 'draft' ? 'bg-[#fef3c7] text-[#92400e]' :
              'bg-[#f0f0f0] text-[#999]'
            }`}>
              {skill.status} v{skill.version}
            </span>
            <div className="flex-1" />
            {dirty && (
              <span className="text-[12px] text-[#f59e0b] font-medium">Unsaved changes</span>
            )}
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="px-4 py-1.5 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors disabled:opacity-40"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-[#e8e8e8]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center gap-1 -mb-px">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 text-[13px] font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-[#1a1a1a] text-[#1a1a1a]'
                    : 'border-transparent text-[#999] hover:text-[#666]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {activeTab === 'fields' && (
          <SkillFieldsTab fields={fields} setFields={setFields} markDirty={markDirty} />
        )}
        {activeTab === 'prompt' && (
          <SkillPromptTab
            systemPrompt={systemPrompt}
            setSystemPrompt={setSystemPrompt}
            extractionInstructions={extractionInstructions}
            setExtractionInstructions={setExtractionInstructions}
            markDirty={markDirty}
          />
        )}
        {activeTab === 'classifier' && (
          <SkillClassifierTab
            classifierHints={classifierHints}
            setClassifierHints={setClassifierHints}
            markDirty={markDirty}
          />
        )}
        {activeTab === 'fewshot' && (
          <SkillFewShotTab
            sampleExtractions={sampleExtractions}
            setSampleExtractions={setSampleExtractions}
            markDirty={markDirty}
          />
        )}
        {activeTab === 'references' && (
          <SkillReferencesTab
            referenceDocIds={referenceDocIds}
            setReferenceDocIds={setReferenceDocIds}
            markDirty={markDirty}
          />
        )}
        {activeTab === 'test' && (
          <SkillTestTab
            skillId={skillId}
            fields={fields}
            systemPrompt={systemPrompt}
            extractionInstructions={extractionInstructions}
            sampleExtractions={sampleExtractions}
            referenceDocIds={referenceDocIds}
          />
        )}
        {activeTab === 'versions' && (
          <SkillVersionsTab
            skillId={skillId}
            currentVersion={skill.version}
            onRollback={fetchSkill}
          />
        )}
        {activeTab === 'orgs' && (
          <SkillOrgConfigTab
            skillId={skillId}
            currentVersion={skill.version}
          />
        )}
      </div>
    </div>
  );
}
