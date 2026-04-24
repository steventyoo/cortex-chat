'use client';

import { useState, useEffect, useCallback } from 'react';
import { PROVIDERS, listProviders, type SourceProviderDef, type ConfigField } from '@/lib/source-registry';
import type { SourceKind, ProviderName } from '@/lib/schemas/enums';

interface Source {
  id: string;
  projectId: string;
  orgId: string;
  kind: SourceKind;
  provider: ProviderName;
  config: Record<string, unknown>;
  label: string;
  active: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
}

export default function ProjectSources({ projectId }: { projectId: string }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [scanning, setScanning] = useState<string | null>(null);

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/sources`);
      if (res.ok) {
        const data = await res.json();
        setSources(data.sources || []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const handleRemove = async (sourceId: string) => {
    if (!confirm('Remove this source?')) return;
    const res = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/sources?sourceId=${sourceId}`,
      { method: 'DELETE' }
    );
    if (res.ok) {
      setSources((prev) => prev.filter((s) => s.id !== sourceId));
    }
  };

  const handleScanNow = async (source: Source) => {
    if (source.provider !== 'gdrive' || !source.config.folder_id) return;
    setScanning(source.id);
    try {
      await fetch(
        `/api/pipeline/scan-drive?folderId=${encodeURIComponent(String(source.config.folder_id))}&projectId=${encodeURIComponent(source.projectId)}`
      );
      await fetchSources();
    } catch {
      /* ignore */
    } finally {
      setScanning(null);
    }
  };

  const providerLabel = (provider: ProviderName) => PROVIDERS[provider]?.label || provider;

  const configSummary = (source: Source) => {
    if (source.provider === 'gdrive') {
      const fid = String(source.config.folder_id || '');
      const sub = source.config.subpath ? ` / ${source.config.subpath}` : '';
      return `${fid.slice(0, 12)}...${sub}`;
    }
    if (source.config.bucket) {
      return `${source.config.bucket}${source.config.prefix ? '/' + source.config.prefix : ''}`;
    }
    return JSON.stringify(source.config).slice(0, 40);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-[#e8e8e8] p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-5 w-32 bg-[#f0f0f0] rounded" />
          <div className="h-4 w-48 bg-[#f0f0f0] rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-[#e8e8e8] p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-[16px] font-semibold text-[#1a1a1a]">Data Sources</h3>
          <p className="text-[13px] text-[#999] mt-0.5">
            Connect file storage or integrations to this project
          </p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-3 py-1.5 text-[13px] font-medium rounded-lg bg-[#1a1a1a] text-white hover:bg-[#333] transition-colors"
        >
          {showAdd ? 'Cancel' : '+ Add Source'}
        </button>
      </div>

      {showAdd && (
        <AddSourceForm
          projectId={projectId}
          onAdded={(source) => {
            setSources((prev) => [...prev, source]);
            setShowAdd(false);
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {sources.length === 0 && !showAdd && (
        <div className="py-8 text-center">
          <p className="text-[14px] text-[#999]">No sources connected</p>
          <p className="text-[12px] text-[#ccc] mt-1">
            Add a Google Drive folder or other file source to start importing documents.
          </p>
        </div>
      )}

      {sources.length > 0 && (
        <div className="space-y-2">
          {sources.map((source) => (
            <div
              key={source.id}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[#eee] hover:border-[#ddd] transition-colors"
            >
              <ProviderIcon provider={source.provider} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-[#1a1a1a] truncate">
                    {source.label || providerLabel(source.provider)}
                  </span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#f0f0f0] text-[#666]">
                    {source.kind}
                  </span>
                </div>
                <p className="text-[12px] text-[#999] truncate font-mono">
                  {configSummary(source)}
                </p>
                {source.lastSyncedAt && (
                  <p className="text-[11px] text-[#ccc] mt-0.5">
                    Last synced: {new Date(source.lastSyncedAt).toLocaleString()}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                {source.provider === 'gdrive' && !!source.config.folder_id && (
                  <button
                    onClick={() => handleScanNow(source)}
                    disabled={scanning === source.id}
                    className="px-2 py-1 text-[11px] rounded-md border border-[#ddd] text-[#666] hover:bg-[#f7f7f5] transition-colors disabled:opacity-40"
                  >
                    {scanning === source.id ? 'Scanning...' : 'Scan Now'}
                  </button>
                )}
                <button
                  onClick={() => handleRemove(source.id)}
                  className="px-2 py-1 text-[11px] rounded-md text-[#dc2626] hover:bg-[#fff5f5] transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderIcon({ provider }: { provider: string }) {
  const icons: Record<string, string> = {
    gdrive: 'G',
    s3: 'S3',
    gcs: 'GC',
    azure_blob: 'Az',
  };
  return (
    <div className="w-8 h-8 rounded-lg bg-[#f0f0f0] flex items-center justify-center text-[11px] font-bold text-[#555] flex-shrink-0">
      {icons[provider] || provider.slice(0, 2).toUpperCase()}
    </div>
  );
}

function AddSourceForm({
  projectId,
  onAdded,
  onCancel,
}: {
  projectId: string;
  onAdded: (source: Source) => void;
  onCancel: () => void;
}) {
  const allProviders = listProviders();
  const [selectedProvider, setSelectedProvider] = useState<ProviderName>('gdrive');
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const providerDef = PROVIDERS[selectedProvider];
  const schema = providerDef?.configSchema || {};

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');

    const config: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(schema)) {
      const val = configValues[key];
      if (field.type === 'boolean') {
        config[key] = val === 'true';
      } else if (val) {
        config[key] = val;
      }
    }

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: selectedProvider, config, label: label || undefined }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to add source');
        return;
      }
      onAdded(data.source);
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mb-4 p-4 rounded-xl border border-[#e0e0e0] bg-[#fafafa]">
      {/* Provider picker */}
      <div className="mb-3">
        <label className="block text-[12px] font-medium text-[#555] mb-1">Provider</label>
        <div className="flex flex-wrap gap-2">
          {allProviders.map((p) => (
            <button
              key={p.name}
              onClick={() => {
                if (p.implemented) {
                  setSelectedProvider(p.name as ProviderName);
                  setConfigValues({});
                }
              }}
              disabled={!p.implemented}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                selectedProvider === p.name
                  ? 'bg-[#1a1a1a] text-white'
                  : p.implemented
                  ? 'bg-white border border-[#ddd] text-[#555] hover:border-[#999]'
                  : 'bg-[#f0f0f0] text-[#bbb] cursor-not-allowed'
              }`}
            >
              {p.label}
              {!p.implemented && <span className="ml-1 text-[10px]">(Soon)</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Config fields */}
      <div className="space-y-2 mb-3">
        {Object.entries(schema).map(([key, field]: [string, ConfigField]) => (
          <div key={key}>
            <label className="block text-[12px] font-medium text-[#555] mb-1">
              {field.label} {field.required && '*'}
            </label>
            {field.type === 'boolean' ? (
              <label className="flex items-center gap-2 text-[13px] text-[#37352f]">
                <input
                  type="checkbox"
                  checked={configValues[key] === 'true'}
                  onChange={(e) =>
                    setConfigValues((prev) => ({ ...prev, [key]: String(e.target.checked) }))
                  }
                  className="w-4 h-4 rounded border-[#ccc]"
                />
                {field.label}
              </label>
            ) : (
              <input
                type="text"
                value={configValues[key] || ''}
                onChange={(e) =>
                  setConfigValues((prev) => ({ ...prev, [key]: e.target.value }))
                }
                placeholder={field.placeholder || ''}
                className="w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/30 focus:border-[#007aff] font-mono"
              />
            )}
          </div>
        ))}
      </div>

      {/* Label */}
      <div className="mb-3">
        <label className="block text-[12px] font-medium text-[#555] mb-1">
          Label (optional)
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Project 1705 Contracts"
          className="w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/30 focus:border-[#007aff]"
        />
      </div>

      {error && (
        <div className="mb-3 p-2.5 rounded-lg bg-[#fff5f5] border border-[#fecaca] text-[12px] text-[#dc2626]">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 py-2 rounded-lg text-[13px] text-[#666] hover:bg-[#f0f0f0] transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="flex-1 py-2 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors disabled:opacity-40"
        >
          {submitting ? 'Connecting...' : 'Test & Connect'}
        </button>
      </div>
    </div>
  );
}
