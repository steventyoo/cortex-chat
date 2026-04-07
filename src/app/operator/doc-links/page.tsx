'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface LinkType {
  id: string;
  link_type_key: string;
  display_name: string;
  source_skill: string;
  target_skill: string;
  relationship: string;
  match_fields: string[];
  description: string;
  is_active: boolean;
  created_at: string;
}

const SKILL_LABELS: Record<string, string> = {
  rfi: 'RFI',
  change_order: 'Change Order',
  contract: 'Contract',
  design_change: 'Design Change',
  estimate: 'Estimate',
  sub_bid: 'Sub Bid',
  submittal: 'Submittal',
  daily_report: 'Daily Report',
  production_activity: 'Production Activity',
  safety_inspection: 'Safety & Inspection',
  project_admin: 'Project Admin',
  job_cost_report: 'Job Cost Report',
};

const RELATIONSHIP_COLORS: Record<string, string> = {
  triggers: 'bg-[#dbeafe] text-[#1e40af]',
  generates: 'bg-[#dcfce7] text-[#166534]',
  originates: 'bg-[#dbeafe] text-[#1e40af]',
  rolled_into: 'bg-[#fef3c7] text-[#92400e]',
  billed_via: 'bg-[#f3e8ff] text-[#6b21a8]',
  feedback_loop: 'bg-[#fce7f3] text-[#9d174d]',
  contingency_check: 'bg-[#fef3c7] text-[#92400e]',
  performance_check: 'bg-[#fecaca] text-[#991b1b]',
  budget_comparison: 'bg-[#fef3c7] text-[#92400e]',
  cost_allocation: 'bg-[#f3e8ff] text-[#6b21a8]',
  labor_reconciliation: 'bg-[#fce7f3] text-[#9d174d]',
  cost_verification: 'bg-[#fef3c7] text-[#92400e]',
  productivity_impact: 'bg-[#fecaca] text-[#991b1b]',
  weather_impact: 'bg-[#f0f0f0] text-[#666]',
  cross_reference: 'bg-[#f0f0f0] text-[#666]',
  clause_reference: 'bg-[#fef3c7] text-[#92400e]',
  spec_reference: 'bg-[#dbeafe] text-[#1e40af]',
  references: 'bg-[#f0f0f0] text-[#666]',
  billing_verification: 'bg-[#f3e8ff] text-[#6b21a8]',
  supersedes: 'bg-[#fecaca] text-[#991b1b]',
};

function OperatorNav() {
  const pathname = usePathname();
  const tabs = [
    { label: 'Skills', href: '/operator/skills' },
    { label: 'Doc Links', href: '/operator/doc-links' },
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
          <Link href="/" className="text-[12px] text-[#999] hover:text-[#666]">
            Back to App
          </Link>
        </div>
      </div>
    </nav>
  );
}

type GroupKey = string;

export default function DocLinksPage() {
  const [linkTypes, setLinkTypes] = useState<LinkType[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  const fetchLinkTypes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/link-types');
      if (res.ok) {
        const data = await res.json();
        setLinkTypes(data.linkTypes || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchLinkTypes(); }, [fetchLinkTypes]);

  const toggleActive = async (lt: LinkType) => {
    await fetch(`/api/link-types/${lt.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !lt.is_active }),
    });
    fetchLinkTypes();
  };

  const skills = Array.from(new Set(linkTypes.flatMap(lt => [lt.source_skill, lt.target_skill]))).sort();

  const filtered = filter === 'all'
    ? linkTypes
    : linkTypes.filter(lt => lt.source_skill === filter || lt.target_skill === filter);

  const grouped = filtered.reduce<Record<GroupKey, LinkType[]>>((acc, lt) => {
    const key = `${lt.source_skill} → ${lt.target_skill}`;
    (acc[key] ||= []).push(lt);
    return acc;
  }, {});

  const jcrLinks = linkTypes.filter(lt => lt.source_skill === 'job_cost_report' || lt.target_skill === 'job_cost_report');

  return (
    <div className="min-h-screen bg-white">
      <OperatorNav />

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[20px] font-semibold text-[#1a1a1a]">Cross-Document Relationships</h1>
            <p className="text-[13px] text-[#999] mt-1">
              {linkTypes.length} relationship types define how documents connect across the taxonomy.
              These power the coverage analysis engine.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-[#e0e0e0] text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/20"
            >
              <option value="all">All Skills ({linkTypes.length})</option>
              {skills.map(s => (
                <option key={s} value={s}>
                  {SKILL_LABELS[s] || s} ({linkTypes.filter(lt => lt.source_skill === s || lt.target_skill === s).length})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* JCR Hub Summary */}
        <div className="border border-[#e8e8e8] rounded-lg p-4 mb-6 bg-[#fafafa]">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[13px] font-semibold text-[#1a1a1a]">JCR Hub</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#dbeafe] text-[#1e40af] font-medium">
              {jcrLinks.length} connections
            </span>
          </div>
          <p className="text-[12px] text-[#999] mb-3">
            The Job Cost Report is the anchor document. These relationships power the coverage analysis.
          </p>
          <div className="flex flex-wrap gap-2">
            {jcrLinks.map(lt => (
              <span
                key={lt.id}
                className="text-[11px] px-2 py-1 rounded bg-white border border-[#e8e8e8] text-[#666]"
              >
                {SKILL_LABELS[lt.source_skill] || lt.source_skill} → {SKILL_LABELS[lt.target_skill] || lt.target_skill}
              </span>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-[14px] text-[#999]">
            <svg className="animate-spin w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            Loading relationship types...
          </div>
        ) : (
          <div className="border border-[#e8e8e8] rounded-lg overflow-hidden">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-[#fafafa] border-b border-[#e8e8e8]">
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[60px]">Active</th>
                  <th className="text-left px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Source</th>
                  <th className="text-center px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[40px]" />
                  <th className="text-left px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Target</th>
                  <th className="text-left px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Relationship</th>
                  <th className="text-left px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Match Fields</th>
                  <th className="text-left px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Description</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(grouped).map(([groupKey, items]) => (
                  items.map((lt, idx) => (
                    <tr
                      key={lt.id}
                      className={`border-b border-[#f0f0f0] last:border-b-0 hover:bg-[#fafafa] transition-colors ${
                        !lt.is_active ? 'opacity-40' : ''
                      }`}
                    >
                      <td className="px-3 py-1.5 text-center">
                        <button
                          onClick={() => toggleActive(lt)}
                          className={`w-3.5 h-3.5 rounded-full border-2 ${
                            lt.is_active ? 'bg-[#16a34a] border-[#16a34a]' : 'bg-white border-[#ddd]'
                          }`}
                          title={lt.is_active ? 'Active — click to disable' : 'Inactive — click to enable'}
                        />
                      </td>
                      <td className="px-2 py-1.5 font-medium text-[#1a1a1a] whitespace-nowrap">
                        {SKILL_LABELS[lt.source_skill] || lt.source_skill}
                      </td>
                      <td className="px-2 py-1.5 text-center text-[#ccc]">→</td>
                      <td className="px-2 py-1.5 font-medium text-[#1a1a1a] whitespace-nowrap">
                        {SKILL_LABELS[lt.target_skill] || lt.target_skill}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          RELATIONSHIP_COLORS[lt.relationship] || 'bg-[#f0f0f0] text-[#666]'
                        }`}>
                          {lt.relationship}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-[#888]">
                        <div className="flex flex-wrap gap-1">
                          {lt.match_fields.map((f: string) => (
                            <span key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-[#f5f5f5] text-[#888] font-mono">
                              {f}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-[#999] max-w-[280px] truncate">{lt.description}</td>
                    </tr>
                  ))
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
