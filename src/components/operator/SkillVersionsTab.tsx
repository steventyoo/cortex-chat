'use client';

import { useState, useEffect, useCallback } from 'react';

interface VersionEntry {
  id: string;
  version: number;
  change_summary: string;
  changed_by: string;
  created_at: string;
  snapshot: Record<string, unknown>;
}

interface Props {
  skillId: string;
  currentVersion: number;
  onRollback: () => void;
}

export default function SkillVersionsTab({ skillId, currentVersion, onRollback }: Props) {
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [rolling, setRolling] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchVersions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/skills/${skillId}/versions`);
      if (res.ok) {
        const data = await res.json();
        setVersions(data.versions || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [skillId]);

  useEffect(() => { fetchVersions(); }, [fetchVersions]);

  const handleRollback = async (version: number) => {
    if (!confirm(`Roll back to version ${version}? This creates a new version with that snapshot.`)) return;
    setRolling(version);
    try {
      const res = await fetch(`/api/skills/${skillId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      if (res.ok) {
        onRollback();
        fetchVersions();
      }
    } catch { /* ignore */ }
    setRolling(null);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[14px] text-[#999]">
        <svg className="animate-spin w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
          <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        Loading version history...
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h2 className="text-[16px] font-semibold text-[#1a1a1a]">Version History</h2>
        <p className="text-[13px] text-[#999] mt-0.5">
          Each save creates a version snapshot. Roll back to any previous version.
        </p>
      </div>

      {versions.length === 0 ? (
        <div className="text-center py-12 text-[14px] text-[#999]">
          No version history yet. Versions are recorded when you save changes.
        </div>
      ) : (
        <div className="space-y-2">
          {versions.map((v) => {
            const isCurrent = v.version === currentVersion;
            const isExpanded = expandedId === v.id;
            const snapshot = v.snapshot as Record<string, unknown>;
            const fieldDefs = (snapshot.field_definitions as Array<{ name: string }>) || [];

            return (
              <div
                key={v.id}
                className={`border rounded-lg transition-colors ${
                  isCurrent ? 'border-[#007aff] bg-[#f8faff]' : 'border-[#e8e8e8]'
                }`}
              >
                <div className="flex items-center gap-4 px-4 py-3">
                  <div className="flex-shrink-0">
                    <span className={`text-[14px] font-mono font-semibold ${
                      isCurrent ? 'text-[#007aff]' : 'text-[#999]'
                    }`}>
                      v{v.version}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-[#1a1a1a]">
                      {v.change_summary || 'No summary'}
                      {isCurrent && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-[#007aff] text-white font-medium">
                          Current
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-[#b4b4b4] mt-0.5">
                      {v.changed_by || 'System'} &middot; {formatDate(v.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : v.id)}
                      className="text-[12px] text-[#007aff] hover:underline"
                    >
                      {isExpanded ? 'Hide' : 'View'}
                    </button>
                    {!isCurrent && (
                      <button
                        onClick={() => handleRollback(v.version)}
                        disabled={rolling === v.version}
                        className="px-3 py-1 rounded-md bg-[#f0f0f0] text-[12px] font-medium text-[#666] hover:bg-[#e8e8e8] transition-colors disabled:opacity-40"
                      >
                        {rolling === v.version ? 'Rolling back...' : 'Rollback'}
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-[#f0f0f0] px-4 py-3 bg-[#fafafa] rounded-b-lg">
                    <div className="grid grid-cols-2 gap-4 text-[12px]">
                      <div>
                        <p className="font-medium text-[#999] uppercase tracking-wide mb-1">Fields ({fieldDefs.length})</p>
                        <div className="space-y-0.5">
                          {fieldDefs.slice(0, 10).map((f, i) => (
                            <p key={i} className="text-[#666] font-mono">{f.name}</p>
                          ))}
                          {fieldDefs.length > 10 && (
                            <p className="text-[#ccc]">+{fieldDefs.length - 10} more</p>
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="font-medium text-[#999] uppercase tracking-wide mb-1">Status</p>
                        <p className="text-[#666]">{String(snapshot.status || 'active')}</p>
                        <p className="font-medium text-[#999] uppercase tracking-wide mb-1 mt-2">System Prompt</p>
                        <p className="text-[#666] line-clamp-3">{String(snapshot.system_prompt || '').slice(0, 200)}...</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
