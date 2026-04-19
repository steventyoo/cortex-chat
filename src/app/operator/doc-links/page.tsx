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

type LinkStatus = 'complete' | 'partial' | 'missing' | 'not_applicable';

interface LinkTypeCoverage {
  linkTypeKey: string;
  displayName: string;
  sourceSkill: string;
  targetSkill: string;
  sourceDocs: number;
  targetDocs: number;
  actualLinks: number;
  avgConfidence: number;
  status: LinkStatus;
}

interface ChainCoverage {
  chainName: string;
  linkTypes: LinkTypeCoverage[];
  overallStatus: LinkStatus;
  completionPct: number;
}

interface ProjectCoverage {
  projectId: string;
  projectName: string;
  docCount: number;
  skillBreakdown: Record<string, number>;
  chains: ChainCoverage[];
  overallCompletionPct: number;
}

type ActiveTab = 'types' | 'chains';

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
    { label: 'Field Catalog', href: '/operator/fields' },
    { label: 'Doc Links', href: '/operator/doc-links' },
    { label: 'Chat Tools', href: '/operator/chat-tools' },
    { label: 'Context Cards', href: '/operator/context-cards' },
    { label: 'Evals', href: '/operator/evals' },
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

const STATUS_BADGE: Record<LinkStatus, { bg: string; text: string; label: string }> = {
  complete: { bg: 'bg-[#dcfce7]', text: 'text-[#166534]', label: 'Complete' },
  partial: { bg: 'bg-[#fef3c7]', text: 'text-[#92400e]', label: 'Partial' },
  missing: { bg: 'bg-[#fecaca]', text: 'text-[#991b1b]', label: 'Missing' },
  not_applicable: { bg: 'bg-[#f0f0f0]', text: 'text-[#999]', label: 'N/A' },
};

function StatusBadge({ status }: { status: LinkStatus }) {
  const s = STATUS_BADGE[status];
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

function CompletionRing({ pct }: { pct: number }) {
  const r = 18;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const color = pct >= 75 ? '#16a34a' : pct >= 25 ? '#d97706' : pct > 0 ? '#dc2626' : '#e0e0e0';
  return (
    <svg width="48" height="48" className="flex-shrink-0">
      <circle cx="24" cy="24" r={r} fill="none" stroke="#e8e8e8" strokeWidth="3" />
      <circle cx="24" cy="24" r={r} fill="none" stroke={color} strokeWidth="3"
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        transform="rotate(-90 24 24)" />
      <text x="24" y="24" textAnchor="middle" dominantBaseline="central"
        className="text-[10px] font-semibold" fill="#1a1a1a">
        {pct}%
      </text>
    </svg>
  );
}

function ChainsTab() {
  const [projects, setProjects] = useState<ProjectCoverage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<string>('all');
  const [expandedChain, setExpandedChain] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkResult, setLinkResult] = useState<string | null>(null);

  const fetchCoverage = useCallback(async (projId?: string) => {
    setLoading(true);
    try {
      const url = projId && projId !== 'all'
        ? `/api/doc-links/coverage?projectId=${projId}`
        : '/api/doc-links/coverage';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchCoverage(selectedProject === 'all' ? undefined : selectedProject);
  }, [fetchCoverage, selectedProject]);

  const runLinking = async () => {
    setLinking(true);
    setLinkResult(null);
    try {
      const body = selectedProject !== 'all' ? { projectId: selectedProject } : {};
      const res = await fetch('/api/pipeline/link-docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setLinkResult(`Created ${data.linksCreated} links, skipped ${data.linksSkipped} duplicates`);
        fetchCoverage(selectedProject === 'all' ? undefined : selectedProject);
      } else {
        setLinkResult(`Error: ${data.error || 'Linking failed'}`);
      }
    } catch {
      setLinkResult('Error: Network request failed');
    }
    setLinking(false);
  };

  const currentProject = selectedProject !== 'all'
    ? projects.find(p => p.projectId === selectedProject)
    : null;

  const chainsToShow = currentProject?.chains || [];

  return (
    <div>
      {/* Controls row */}
      <div className="flex items-center gap-3 mb-6">
        <select
          value={selectedProject}
          onChange={e => { setSelectedProject(e.target.value); setExpandedChain(null); }}
          className="px-3 py-1.5 rounded-lg border border-[#e0e0e0] text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/20"
        >
          <option value="all">All Projects ({projects.length})</option>
          {projects.map(p => (
            <option key={p.projectId} value={p.projectId}>
              {p.projectName} ({p.docCount} docs)
            </option>
          ))}
        </select>
        <button
          onClick={runLinking}
          disabled={linking}
          className="px-3 py-1.5 rounded-lg text-[13px] font-medium bg-[#1a1a1a] text-white hover:bg-[#333] disabled:opacity-50 transition-colors"
        >
          {linking ? 'Running...' : 'Run Linking'}
        </button>
        {linkResult && (
          <span className={`text-[12px] ${linkResult.startsWith('Error') ? 'text-[#dc2626]' : 'text-[#16a34a]'}`}>
            {linkResult}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-[14px] text-[#999]">
          <svg className="animate-spin w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Loading chain coverage...
        </div>
      ) : selectedProject === 'all' ? (
        <PortfolioTable projects={projects} onSelectProject={setSelectedProject} />
      ) : currentProject ? (
        <>
          {/* Skill breakdown bar */}
          <div className="border border-[#e8e8e8] rounded-lg p-4 mb-6 bg-[#fafafa]">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[13px] font-semibold text-[#1a1a1a]">{currentProject.projectName}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#dbeafe] text-[#1e40af] font-medium">
                {currentProject.docCount} documents
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#dcfce7] text-[#166534] font-medium">
                {currentProject.overallCompletionPct}% chain coverage
              </span>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {Object.entries(currentProject.skillBreakdown).map(([skill, count]) => (
                <span key={skill} className="text-[11px] px-2 py-1 rounded bg-white border border-[#e8e8e8] text-[#666]">
                  {SKILL_LABELS[skill] || skill}: <span className="font-mono font-medium text-[#1a1a1a]">{count}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Missing document types alert */}
          {(() => {
            const missingSkills = new Map<string, string[]>();
            for (const chain of chainsToShow) {
              for (const lt of chain.linkTypes) {
                if (lt.sourceDocs === 0 && lt.sourceSkill) {
                  const arr = missingSkills.get(lt.sourceSkill) || [];
                  if (!arr.includes(chain.chainName)) arr.push(chain.chainName);
                  missingSkills.set(lt.sourceSkill, arr);
                }
                if (lt.targetDocs === 0 && lt.targetSkill) {
                  const arr = missingSkills.get(lt.targetSkill) || [];
                  if (!arr.includes(chain.chainName)) arr.push(chain.chainName);
                  missingSkills.set(lt.targetSkill, arr);
                }
              }
            }
            if (missingSkills.size === 0) return null;
            return (
              <div className="border border-[#fecaca] rounded-lg p-4 mb-6 bg-[#fef2f2]">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-4 h-4 text-[#dc2626]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                  <span className="text-[13px] font-semibold text-[#991b1b]">
                    {missingSkills.size} document type{missingSkills.size > 1 ? 's' : ''} missing from this project
                  </span>
                </div>
                <p className="text-[12px] text-[#7f1d1d] mb-3">
                  These document types are required by chain relationships but have 0 documents ingested. Upload them to enable full coverage analysis.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[...missingSkills.entries()].map(([skill, chains]) => (
                    <div key={skill} className="flex items-start gap-2 bg-white border border-[#fecaca] rounded px-3 py-2">
                      <span className="text-[12px] font-semibold text-[#1a1a1a] whitespace-nowrap">
                        {SKILL_LABELS[skill] || skill}
                      </span>
                      <span className="text-[11px] text-[#999] leading-relaxed">
                        — blocks {chains.join(', ')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Chain summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {chainsToShow.map(chain => (
              <button
                key={chain.chainName}
                onClick={() => setExpandedChain(expandedChain === chain.chainName ? null : chain.chainName)}
                className={`text-left border rounded-lg p-4 transition-colors ${
                  expandedChain === chain.chainName
                    ? 'border-[#1a1a1a] bg-[#fafafa]'
                    : 'border-[#e8e8e8] bg-white hover:border-[#ccc]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <CompletionRing pct={chain.completionPct} />
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-[#1a1a1a] truncate">{chain.chainName}</div>
                    <div className="text-[11px] text-[#999] mt-0.5">
                      {chain.linkTypes.filter(lt => lt.status !== 'not_applicable').length} of {chain.linkTypes.length} link types active
                    </div>
                    <div className="mt-1"><StatusBadge status={chain.overallStatus} /></div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Expanded chain detail */}
          {expandedChain && (() => {
            const chain = chainsToShow.find(c => c.chainName === expandedChain);
            if (!chain) return null;
            return (
              <div className="border border-[#e8e8e8] rounded-lg overflow-hidden mb-6">
                <div className="bg-[#fafafa] border-b border-[#e8e8e8] px-4 py-2">
                  <span className="text-[13px] font-semibold text-[#1a1a1a]">{chain.chainName}</span>
                </div>
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-[#fafafa] border-b border-[#e8e8e8]">
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Source</th>
                      <th className="text-center px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[40px]" />
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Target</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Src Docs</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Tgt Docs</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Links</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Avg Conf</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chain.linkTypes.map(lt => (
                      <tr key={lt.linkTypeKey} className={`border-b border-[#f0f0f0] last:border-b-0 ${
                        lt.status === 'missing' ? 'bg-[#fff8f8]' : ''
                      }`}>
                        <td className="px-3 py-2 font-medium text-[#1a1a1a] whitespace-nowrap">
                          <Link href={`/operator/skills/${lt.sourceSkill}`} className="hover:underline">
                            {SKILL_LABELS[lt.sourceSkill] || lt.sourceSkill}
                          </Link>
                        </td>
                        <td className="px-2 py-2 text-center text-[#ccc]">→</td>
                        <td className="px-3 py-2 font-medium text-[#1a1a1a] whitespace-nowrap">
                          <Link href={`/operator/skills/${lt.targetSkill}`} className="hover:underline">
                            {SKILL_LABELS[lt.targetSkill] || lt.targetSkill}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-[#666]">{lt.sourceDocs}</td>
                        <td className="px-3 py-2 text-right font-mono text-[#666]">{lt.targetDocs}</td>
                        <td className="px-3 py-2 text-right font-mono text-[#666]">{lt.actualLinks}</td>
                        <td className="px-3 py-2 text-right font-mono text-[#666]">
                          {lt.avgConfidence > 0 ? lt.avgConfidence.toFixed(2) : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={lt.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {chain.linkTypes.some(lt => lt.status === 'missing') && (
                  <div className="border-t border-[#e8e8e8] px-4 py-3 bg-[#fff8f8]">
                    {chain.linkTypes.filter(lt => lt.status === 'missing').map(lt => (
                      <p key={lt.linkTypeKey} className="text-[11px] text-[#991b1b] mb-1 last:mb-0">
                        ⚠ 0 {SKILL_LABELS[lt.sourceSkill] || lt.sourceSkill} → {SKILL_LABELS[lt.targetSkill] || lt.targetSkill} links found.
                        {' '}{lt.sourceDocs} source docs and {lt.targetDocs} target docs exist — run linking to detect connections.
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </>
      ) : (
        <div className="text-center py-20 text-[14px] text-[#999]">No project data found.</div>
      )}
    </div>
  );
}

function PortfolioTable({ projects, onSelectProject }: { projects: ProjectCoverage[]; onSelectProject: (id: string) => void }) {
  if (projects.length === 0) {
    return <div className="text-center py-20 text-[14px] text-[#999]">No projects found.</div>;
  }

  function chainPct(proj: ProjectCoverage, chainName: string): number {
    const chain = proj.chains.find(c => c.chainName === chainName);
    return chain?.completionPct ?? 0;
  }

  return (
    <div className="border border-[#e8e8e8] rounded-lg overflow-hidden">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="bg-[#fafafa] border-b border-[#e8e8e8]">
            <th className="text-left px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Project</th>
            <th className="text-right px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Docs</th>
            <th className="text-right px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Revenue</th>
            <th className="text-right px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Feedback</th>
            <th className="text-right px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">JCR Hub</th>
            <th className="text-right px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Overall</th>
          </tr>
        </thead>
        <tbody>
          {projects.map(proj => (
            <tr
              key={proj.projectId}
              onClick={() => onSelectProject(proj.projectId)}
              className="border-b border-[#f0f0f0] last:border-b-0 hover:bg-[#fafafa] cursor-pointer transition-colors"
            >
              <td className="px-3 py-2 font-medium text-[#1a1a1a]">{proj.projectName}</td>
              <td className="px-3 py-2 text-right font-mono text-[#666]">{proj.docCount}</td>
              <td className="px-3 py-2 text-right font-mono text-[#666]">{chainPct(proj, 'Revenue Pipeline')}%</td>
              <td className="px-3 py-2 text-right font-mono text-[#666]">{chainPct(proj, 'Estimating Feedback')}%</td>
              <td className="px-3 py-2 text-right font-mono text-[#666]">{chainPct(proj, 'JCR Hub')}%</td>
              <td className="px-3 py-2 text-right">
                <span className={`font-mono font-medium ${
                  proj.overallCompletionPct >= 75 ? 'text-[#16a34a]' :
                  proj.overallCompletionPct >= 25 ? 'text-[#d97706]' :
                  proj.overallCompletionPct > 0 ? 'text-[#dc2626]' : 'text-[#999]'
                }`}>
                  {proj.overallCompletionPct}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DocLinksPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('types');
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
            {activeTab === 'types' && (
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
            )}
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 mb-6 border-b border-[#e8e8e8]">
          <button
            onClick={() => setActiveTab('types')}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors -mb-px ${
              activeTab === 'types'
                ? 'border-[#1a1a1a] text-[#1a1a1a]'
                : 'border-transparent text-[#999] hover:text-[#666]'
            }`}
          >
            Types
          </button>
          <button
            onClick={() => setActiveTab('chains')}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors -mb-px ${
              activeTab === 'chains'
                ? 'border-[#1a1a1a] text-[#1a1a1a]'
                : 'border-transparent text-[#999] hover:text-[#666]'
            }`}
          >
            Chains
          </button>
        </div>

        {activeTab === 'types' ? (
          <>
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
                      items.map((lt) => (
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
                            <Link href={`/operator/skills/${lt.source_skill}`} className="hover:underline">
                              {SKILL_LABELS[lt.source_skill] || lt.source_skill}
                            </Link>
                          </td>
                          <td className="px-2 py-1.5 text-center text-[#ccc]">→</td>
                          <td className="px-2 py-1.5 font-medium text-[#1a1a1a] whitespace-nowrap">
                            <Link href={`/operator/skills/${lt.target_skill}`} className="hover:underline">
                              {SKILL_LABELS[lt.target_skill] || lt.target_skill}
                            </Link>
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
          </>
        ) : (
          <ChainsTab />
        )}
      </div>
    </div>
  );
}
