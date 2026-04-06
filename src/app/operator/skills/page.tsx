'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

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

export default function OperatorSkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'draft' | 'archived'>('all');

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
        </div>

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
