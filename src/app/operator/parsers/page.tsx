'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface CachedParser {
  id: string;
  skill_id: string;
  format_fingerprint: string;
  parser_hash: string;
  identity_score: number;
  quality_score: number | null;
  checks_passed: number;
  checks_total: number;
  validated_count: number;
  failure_count: number;
  last_validated_at: string;
  is_active: boolean;
  created_at: string;
}

function OperatorNav() {
  const pathname = usePathname();
  const tabs = [
    { label: 'Skills', href: '/operator/skills' },
    { label: 'Field Catalog', href: '/operator/fields' },
    { label: 'Doc Links', href: '/operator/doc-links' },
    { label: 'Chat Tools', href: '/operator/chat-tools' },
    { label: 'Context Cards', href: '/operator/context-cards' },
    { label: 'Evals', href: '/operator/evals' },
    { label: 'Derived Fields', href: '/operator/derived-fields' },
    { label: 'Checks', href: '/operator/checks' },
    { label: 'Parsers', href: '/operator/parsers' },
  ];
  return (
    <nav className="border-b border-[#e8e8e8] bg-[#fafafa]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center h-12 gap-8">
          <Link href="/operator/skills" className="text-[15px] font-semibold text-[#1a1a1a] tracking-tight">Operator Workbench</Link>
          <div className="flex items-center gap-1">
            {tabs.map(tab => (
              <Link key={tab.href} href={tab.href} className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${pathname.startsWith(tab.href) ? 'bg-[#1a1a1a] text-white' : 'text-[#6b6b6b] hover:text-[#1a1a1a] hover:bg-[#f0f0f0]'}`}>{tab.label}</Link>
            ))}
          </div>
          <div className="flex-1" />
        </div>
      </div>
    </nav>
  );
}

function ScoreBadge({ score, label }: { score: number; label: string }) {
  const color = score === 100 ? 'bg-green-100 text-green-800' : score >= 80 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
  return <span className={`${color} text-[11px] font-medium px-2 py-0.5 rounded-full`}>{label}: {score}%</span>;
}

export default function ParsersPage() {
  const [parsers, setParsers] = useState<CachedParser[]>([]);
  const [loading, setLoading] = useState(true);
  const [skillFilter, setSkillFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = skillFilter ? `/api/parser-cache?skill_id=${skillFilter}` : '/api/parser-cache';
      const res = await fetch(url);
      const data = await res.json();
      setParsers(Array.isArray(data.parsers) ? data.parsers : []);
    } catch { setParsers([]); }
    setLoading(false);
  }, [skillFilter]);

  useEffect(() => { load(); }, [load]);

  const toggleActive = async (id: string, isActive: boolean) => {
    await fetch('/api/parser-cache', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: !isActive }),
    });
    load();
  };

  const skills = Array.from(new Set(parsers.map(p => p.skill_id)));

  return (
    <div className="min-h-screen bg-white text-[#1a1a1a]">
      <OperatorNav />
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Parser Cache</h1>
            <p className="text-[13px] text-[#6b6b6b] mt-1">
              Validated parsers cached for reuse. Only promoted when identity score = 100%.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={skillFilter}
              onChange={e => setSkillFilter(e.target.value)}
              className="text-[13px] border border-[#e0e0e0] rounded-md px-3 py-1.5 bg-white"
            >
              <option value="">All Skills</option>
              {skills.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-[#999]">Loading...</div>
        ) : parsers.length === 0 ? (
          <div className="text-center py-12 text-[#999]">
            No cached parsers yet. Parsers are automatically promoted when they achieve 100% identity score.
          </div>
        ) : (
          <div className="border border-[#e8e8e8] rounded-lg overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-[#fafafa] border-b border-[#e8e8e8]">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-[#666]">Skill / Format</th>
                  <th className="text-center px-4 py-2.5 font-medium text-[#666]">Identity</th>
                  <th className="text-center px-4 py-2.5 font-medium text-[#666]">Quality</th>
                  <th className="text-center px-4 py-2.5 font-medium text-[#666]">Checks</th>
                  <th className="text-center px-4 py-2.5 font-medium text-[#666]">Validated</th>
                  <th className="text-center px-4 py-2.5 font-medium text-[#666]">Failures</th>
                  <th className="text-center px-4 py-2.5 font-medium text-[#666]">Active</th>
                  <th className="text-left px-4 py-2.5 font-medium text-[#666]">Last Validated</th>
                </tr>
              </thead>
              <tbody>
                {parsers.map(p => (
                  <tr
                    key={p.id}
                    className={`border-b border-[#f0f0f0] hover:bg-[#fafafa] cursor-pointer ${!p.is_active ? 'opacity-50' : ''}`}
                    onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{p.skill_id}</div>
                      <div className="text-[11px] text-[#999] font-mono">{p.format_fingerprint}</div>
                    </td>
                    <td className="text-center px-4 py-3">
                      <ScoreBadge score={p.identity_score} label="ID" />
                    </td>
                    <td className="text-center px-4 py-3">
                      {p.quality_score != null ? <ScoreBadge score={p.quality_score} label="Q" /> : <span className="text-[#ccc]">-</span>}
                    </td>
                    <td className="text-center px-4 py-3">
                      <span className="text-[12px]">{p.checks_passed}/{p.checks_total}</span>
                    </td>
                    <td className="text-center px-4 py-3">
                      <span className="bg-blue-50 text-blue-700 text-[11px] font-medium px-2 py-0.5 rounded-full">{p.validated_count}</span>
                    </td>
                    <td className="text-center px-4 py-3">
                      {p.failure_count > 0 ? (
                        <span className="bg-red-50 text-red-700 text-[11px] font-medium px-2 py-0.5 rounded-full">{p.failure_count}</span>
                      ) : (
                        <span className="text-[#ccc]">0</span>
                      )}
                    </td>
                    <td className="text-center px-4 py-3">
                      <button
                        onClick={e => { e.stopPropagation(); toggleActive(p.id, p.is_active); }}
                        className={`w-10 h-5 rounded-full transition-colors relative ${p.is_active ? 'bg-green-500' : 'bg-[#ddd]'}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${p.is_active ? 'left-5' : 'left-0.5'}`} />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-[#999]">
                      {new Date(p.last_validated_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-8 p-4 bg-[#f8f9fa] rounded-lg border border-[#e8e8e8]">
          <h3 className="text-[14px] font-semibold mb-2">How Parser Cache Works</h3>
          <div className="text-[12px] text-[#666] space-y-1">
            <p><strong>Promotion:</strong> A parser is cached only when all identity checks (accounting equations) pass at 100%.</p>
            <p><strong>Reuse:</strong> On the next document with the same format fingerprint, the cached parser runs first, skipping expensive LLM calls.</p>
            <p><strong>Validation:</strong> Each successful reuse increments the validated count. Three consecutive failures deactivate a parser.</p>
            <p><strong>Identity vs Quality:</strong> Identity score gates promotion (strict). Quality score includes structural checks (informational).</p>
          </div>
        </div>
      </div>
    </div>
  );
}
