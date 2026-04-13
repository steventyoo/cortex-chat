'use client';

import { useState, useEffect, useCallback } from 'react';
import type { OrgSkillConfig } from '@/lib/schemas/skills.schema';

interface OrgInfo {
  org_id: string;
  name: string;
}

interface Props {
  skillId: string;
  currentVersion: number;
}

export default function SkillOrgConfigTab({ skillId, currentVersion }: Props) {
  const [configs, setConfigs] = useState<OrgSkillConfig[]>([]);
  const [orgs, setOrgs] = useState<OrgInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [configRes, orgRes] = await Promise.all([
        fetch(`/api/skills/${skillId}/org-configs`),
        fetch('/api/org/list'),
      ]);
      if (configRes.ok) {
        const data = await configRes.json();
        setConfigs(data.configs || []);
      }
      if (orgRes.ok) {
        const data = await orgRes.json();
        setOrgs((data.orgs || []).map((o: { orgId: string; orgName: string }) => ({ org_id: o.orgId, name: o.orgName })));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [skillId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const saveConfig = async (orgId: string, updates: { pinned_version?: number | null; document_aliases?: string[]; hidden_fields?: string[] }) => {
    setSaving(orgId);
    try {
      await fetch(`/api/skills/${skillId}/org-configs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, ...updates }),
      });
      fetchData();
    } catch { /* ignore */ }
    setSaving(null);
  };

  const addOrg = async (orgId: string) => {
    await saveConfig(orgId, { pinned_version: null, document_aliases: [], hidden_fields: [] });
    setShowAdd(false);
  };

  const removeConfig = async (orgId: string) => {
    try {
      await fetch(`/api/skills/${skillId}/org-configs`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      });
      fetchData();
    } catch { /* ignore */ }
  };

  const unlinkedOrgs = orgs.filter(o => !configs.some(c => c.org_id === o.org_id));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[14px] text-[#999]">
        <svg className="animate-spin w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
          <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        Loading...
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[16px] font-semibold text-[#1a1a1a]">Organization Configuration</h2>
          <p className="text-[13px] text-[#999] mt-0.5">
            By default all orgs use the latest version (v{currentVersion}). Pin an org to a specific version or customize aliases.
          </p>
        </div>
        {unlinkedOrgs.length > 0 && (
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-1.5 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors"
          >
            + Add Org Override
          </button>
        )}
      </div>

      {showAdd && unlinkedOrgs.length > 0 && (
        <div className="mb-4 border border-[#007aff] rounded-lg p-4 bg-[#f8faff]">
          <p className="text-[12px] font-medium text-[#999] mb-2">Select organization:</p>
          <div className="flex flex-wrap gap-2">
            {unlinkedOrgs.map(org => (
              <button
                key={org.org_id}
                onClick={() => addOrg(org.org_id)}
                className="px-3 py-1.5 rounded-lg border border-[#e0e0e0] text-[13px] hover:bg-[#f0f0f0] transition-colors"
              >
                {org.name}
              </button>
            ))}
          </div>
          <button onClick={() => setShowAdd(false)} className="text-[12px] text-[#999] mt-2 hover:underline">Cancel</button>
        </div>
      )}

      {/* Default behavior callout */}
      <div className="mb-4 px-4 py-3 rounded-lg bg-[#f0fdf4] border border-[#bbf7d0] text-[13px] text-[#166534]">
        All organizations without overrides below use <strong>v{currentVersion}</strong> (latest).
      </div>

      {configs.length === 0 ? (
        <div className="text-center py-12 text-[14px] text-[#999]">
          No per-org overrides. All organizations use the latest version.
        </div>
      ) : (
        <div className="space-y-3">
          {configs.map(config => {
            const orgName = orgs.find(o => o.org_id === config.org_id)?.name || config.org_id;
            return (
              <OrgConfigRow
                key={config.org_id}
                config={config}
                orgName={orgName}
                currentVersion={currentVersion}
                saving={saving === config.org_id}
                onSave={(updates) => saveConfig(config.org_id, updates)}
                onRemove={() => removeConfig(config.org_id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function OrgConfigRow({ config, orgName, currentVersion, saving, onSave, onRemove }: {
  config: OrgSkillConfig;
  orgName: string;
  currentVersion: number;
  saving: boolean;
  onSave: (updates: { pinned_version?: number | null; document_aliases?: string[] }) => void;
  onRemove: () => void;
}) {
  const [pinnedVersion, setPinnedVersion] = useState<string>(
    config.pinned_version !== null ? String(config.pinned_version) : ''
  );
  const [aliases, setAliases] = useState(config.document_aliases?.join(', ') || '');

  const handleSave = () => {
    onSave({
      pinned_version: pinnedVersion ? Number(pinnedVersion) : null,
      document_aliases: aliases.split(',').map(s => s.trim()).filter(Boolean),
    });
  };

  return (
    <div className="border border-[#e8e8e8] rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-[4px] bg-[#e8e8e8] flex items-center justify-center text-[10px] font-bold text-[#666]">
            {orgName.charAt(0).toUpperCase()}
          </div>
          <span className="text-[14px] font-medium text-[#1a1a1a]">{orgName}</span>
          {config.pinned_version !== null && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#fef3c7] text-[#92400e] font-medium">
              Pinned v{config.pinned_version}
            </span>
          )}
        </div>
        <button onClick={onRemove} className="text-[11px] text-[#dc2626] hover:underline">Remove</button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">
            Pinned Version (blank = latest v{currentVersion})
          </label>
          <input
            type="number"
            min="1"
            max={currentVersion}
            value={pinnedVersion}
            onChange={e => setPinnedVersion(e.target.value)}
            placeholder={`Latest (v${currentVersion})`}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff]"
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">
            Document Aliases (comma-separated)
          </label>
          <input
            value={aliases}
            onChange={e => setAliases(e.target.value)}
            placeholder="e.g. Sub Agreement, Subcontract"
            className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff]"
          />
        </div>
      </div>

      <div className="mt-3 flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors disabled:opacity-40"
        >
          {saving ? 'Saving...' : 'Save Config'}
        </button>
      </div>
    </div>
  );
}
