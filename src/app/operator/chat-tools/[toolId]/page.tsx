'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useParams } from 'next/navigation';

interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  description: string;
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
          <Link href="/operator/skills" className="text-[15px] font-semibold text-[#1a1a1a] tracking-tight">Operator Workbench</Link>
          <div className="flex items-center gap-1">
            {tabs.map(tab => (
              <Link key={tab.href} href={tab.href} className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${pathname.startsWith(tab.href) ? 'bg-[#1a1a1a] text-white' : 'text-[#6b6b6b] hover:text-[#1a1a1a] hover:bg-[#f0f0f0]'}`}>
                {tab.label}
              </Link>
            ))}
          </div>
          <div className="flex-1" />
          <Link href="/" className="text-[12px] text-[#999] hover:text-[#666]">Back to App</Link>
        </div>
      </div>
    </nav>
  );
}

export default function ToolEditorPage() {
  const { toolId } = useParams<{ toolId: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toolName, setToolName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [implementationType, setImplementationType] = useState('sql_query');
  const [implementationConfig, setImplementationConfig] = useState<Record<string, unknown>>({});
  const [schemaFields, setSchemaFields] = useState<SchemaField[]>([]);
  const [samplePrompts, setSamplePrompts] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [newPrompt, setNewPrompt] = useState('');

  const fetchTool = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/chat-tools/${toolId}`);
      if (!res.ok) { router.push('/operator/chat-tools'); return; }
      const { tool } = await res.json();
      setToolName(tool.tool_name);
      setDisplayName(tool.display_name);
      setDescription(tool.description);
      setImplementationType(tool.implementation_type);
      setImplementationConfig(tool.implementation_config || {});
      setIsActive(tool.is_active);
      setSamplePrompts(tool.sample_prompts || []);

      const schema = tool.input_schema || {};
      const props = schema.properties || {};
      const required = schema.required || [];
      setSchemaFields(
        Object.entries(props).map(([name, def]) => ({
          name,
          type: (def as Record<string, string>).type || 'string',
          required: required.includes(name),
          description: (def as Record<string, string>).description || '',
        }))
      );
    } catch { router.push('/operator/chat-tools'); }
    setLoading(false);
  }, [toolId, router]);

  useEffect(() => { fetchTool(); }, [fetchTool]);

  const buildInputSchema = () => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const f of schemaFields) {
      properties[f.name] = { type: f.type, description: f.description };
      if (f.required) required.push(f.name);
    }
    return { properties, required };
  };

  const save = async () => {
    setSaving(true);
    await fetch(`/api/chat-tools/${toolId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName,
        description,
        implementationType,
        implementationConfig,
        inputSchema: buildInputSchema(),
        samplePrompts,
        isActive,
      }),
    });
    setSaving(false);
  };

  const deleteTool = async () => {
    if (!confirm('Delete this tool?')) return;
    await fetch(`/api/chat-tools/${toolId}`, { method: 'DELETE' });
    router.push('/operator/chat-tools');
  };

  const addField = () => {
    setSchemaFields([...schemaFields, { name: '', type: 'string', required: false, description: '' }]);
  };

  const updateField = (idx: number, patch: Partial<SchemaField>) => {
    const updated = [...schemaFields];
    updated[idx] = { ...updated[idx], ...patch };
    setSchemaFields(updated);
  };

  const removeField = (idx: number) => {
    setSchemaFields(schemaFields.filter((_, i) => i !== idx));
  };

  const addPrompt = () => {
    if (!newPrompt.trim()) return;
    setSamplePrompts([...samplePrompts, newPrompt.trim()]);
    setNewPrompt('');
  };

  const updateConfig = (key: string, value: unknown) => {
    setImplementationConfig({ ...implementationConfig, [key]: value });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white">
        <OperatorNav />
        <div className="flex items-center justify-center py-20 text-[14px] text-[#999]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <OperatorNav />

      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/operator/chat-tools" className="text-[13px] text-[#999] hover:text-[#666]">&larr; Back</Link>
          <div className="flex-1" />
          <button onClick={() => setIsActive(!isActive)} className={`px-3 py-1.5 rounded-lg text-[12px] font-medium ${isActive ? 'bg-[#dcfce7] text-[#166534]' : 'bg-[#f0f0f0] text-[#999]'}`}>
            {isActive ? 'Active' : 'Inactive'}
          </button>
          <button onClick={save} disabled={saving} className="px-4 py-1.5 rounded-lg text-[12px] font-medium bg-[#007aff] text-white hover:bg-[#0066dd] disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={deleteTool} className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-[#dc2626] hover:bg-[#fef2f2]">
            Delete
          </button>
        </div>

        <div className="space-y-6">
          {/* Basic info */}
          <div className="border border-[#e8e8e8] rounded-lg p-4 space-y-3">
            <div>
              <label className="text-[11px] font-semibold text-[#999] uppercase tracking-wide">Display Name</label>
              <input value={displayName} onChange={e => setDisplayName(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg border border-[#e0e0e0] text-[14px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-[#999] uppercase tracking-wide">Tool Name (slug)</label>
              <div className="mt-1 px-3 py-2 rounded-lg bg-[#fafafa] text-[13px] font-mono text-[#666]">{toolName}</div>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-[#999] uppercase tracking-wide">Description</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="w-full mt-1 px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 resize-none" />
            </div>
          </div>

          {/* Implementation */}
          <div className="border border-[#e8e8e8] rounded-lg p-4 space-y-3">
            <h3 className="text-[13px] font-semibold text-[#1a1a1a]">Implementation</h3>
            <div>
              <label className="text-[11px] font-semibold text-[#999] uppercase tracking-wide">Type</label>
              <select value={implementationType} onChange={e => setImplementationType(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/20">
                <option value="sql_query">SQL Query</option>
                <option value="rag_search">RAG Search</option>
                <option value="api_call">API Call</option>
                <option value="composite">Composite</option>
              </select>
            </div>

            {implementationType === 'sql_query' && (
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-semibold text-[#999] uppercase tracking-wide">Table Name</label>
                  <input value={String(implementationConfig.table || '')} onChange={e => updateConfig('table', e.target.value)} placeholder="e.g. job_costs" className="w-full mt-1 px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-[#007aff]/20" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-[#999] uppercase tracking-wide">Select Columns</label>
                  <input value={String(implementationConfig.select || '*')} onChange={e => updateConfig('select', e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-[#007aff]/20" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-[#999] uppercase tracking-wide">Row Limit</label>
                  <input type="number" value={Number(implementationConfig.limit || 50)} onChange={e => updateConfig('limit', Number(e.target.value))} className="w-32 mt-1 px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-[#999] uppercase tracking-wide">Query Template (for reference)</label>
                  <input value={String(implementationConfig.query_template || '')} onChange={e => updateConfig('query_template', e.target.value)} placeholder="Optional SQL template" className="w-full mt-1 px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-[#007aff]/20" />
                </div>
              </div>
            )}

            {implementationType === 'rag_search' && (
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-semibold text-[#999] uppercase tracking-wide">Skill ID Filter (optional)</label>
                  <input value={String(implementationConfig.skill_id || '')} onChange={e => updateConfig('skill_id', e.target.value)} placeholder="e.g. change_order" className="w-full mt-1 px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-[#007aff]/20" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-[#999] uppercase tracking-wide">Similarity Threshold</label>
                  <input type="number" step="0.05" min="0" max="1" value={Number(implementationConfig.similarity_threshold || 0.4)} onChange={e => updateConfig('similarity_threshold', Number(e.target.value))} className="w-32 mt-1 px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-[#999] uppercase tracking-wide">Max Results</label>
                  <input type="number" value={Number(implementationConfig.match_count || 10)} onChange={e => updateConfig('match_count', Number(e.target.value))} className="w-32 mt-1 px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20" />
                </div>
              </div>
            )}

            {implementationType === 'api_call' && (
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-semibold text-[#999] uppercase tracking-wide">Endpoint</label>
                  <input value={String(implementationConfig.endpoint || '')} onChange={e => updateConfig('endpoint', e.target.value)} placeholder="/api/dashboard" className="w-full mt-1 px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-[#007aff]/20" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-[#999] uppercase tracking-wide">Method</label>
                  <select value={String(implementationConfig.method || 'POST')} onChange={e => updateConfig('method', e.target.value)} className="mt-1 px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/20">
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                  </select>
                </div>
              </div>
            )}

            {implementationType === 'composite' && (
              <div className="text-[12px] text-[#999] bg-[#fafafa] rounded-lg p-3">
                Composite tools chain multiple steps. Edit the raw config below:
                <textarea
                  value={JSON.stringify(implementationConfig, null, 2)}
                  onChange={e => { try { setImplementationConfig(JSON.parse(e.target.value)); } catch { /* ignore parse errors while typing */ } }}
                  rows={8}
                  className="w-full mt-2 px-3 py-2 rounded-lg border border-[#e0e0e0] text-[12px] font-mono focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 resize-none"
                />
              </div>
            )}
          </div>

          {/* Input Schema */}
          <div className="border border-[#e8e8e8] rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-[#1a1a1a]">Input Schema</h3>
              <button onClick={addField} className="text-[12px] text-[#007aff] hover:text-[#0066dd] font-medium">+ Add Field</button>
            </div>
            <p className="text-[11px] text-[#999]">Define the parameters Claude will pass when invoking this tool.</p>

            {schemaFields.length === 0 ? (
              <div className="text-[12px] text-[#999] text-center py-4">No fields defined. Claude will call this tool with no parameters.</div>
            ) : (
              <div className="space-y-2">
                {schemaFields.map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={f.name} onChange={e => updateField(i, { name: e.target.value })} placeholder="field_name" className="flex-1 px-2 py-1.5 rounded border border-[#e0e0e0] text-[12px] font-mono focus:outline-none focus:ring-2 focus:ring-[#007aff]/20" />
                    <select value={f.type} onChange={e => updateField(i, { type: e.target.value })} className="px-2 py-1.5 rounded border border-[#e0e0e0] text-[12px] bg-white focus:outline-none">
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="boolean">boolean</option>
                    </select>
                    <label className="flex items-center gap-1 text-[11px] text-[#666]">
                      <input type="checkbox" checked={f.required} onChange={e => updateField(i, { required: e.target.checked })} className="rounded" />
                      Req
                    </label>
                    <input value={f.description} onChange={e => updateField(i, { description: e.target.value })} placeholder="Description..." className="flex-[2] px-2 py-1.5 rounded border border-[#e0e0e0] text-[12px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20" />
                    <button onClick={() => removeField(i)} className="text-[#dc2626] text-[11px] hover:bg-[#fef2f2] px-1.5 py-1 rounded">x</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sample Prompts */}
          <div className="border border-[#e8e8e8] rounded-lg p-4 space-y-3">
            <h3 className="text-[13px] font-semibold text-[#1a1a1a]">Sample Prompts</h3>
            <p className="text-[11px] text-[#999]">Example user messages that should trigger this tool. Helps Claude understand when to use it.</p>
            <div className="space-y-1">
              {samplePrompts.map((p, i) => (
                <div key={i} className="flex items-center gap-2 text-[12px]">
                  <span className="flex-1 px-2 py-1 rounded bg-[#fafafa] text-[#666]">&ldquo;{p}&rdquo;</span>
                  <button onClick={() => setSamplePrompts(samplePrompts.filter((_, j) => j !== i))} className="text-[#dc2626] text-[11px] hover:bg-[#fef2f2] px-1.5 py-1 rounded">x</button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newPrompt} onChange={e => setNewPrompt(e.target.value)} onKeyDown={e => e.key === 'Enter' && addPrompt()} placeholder="Type a sample prompt..." className="flex-1 px-3 py-1.5 rounded-lg border border-[#e0e0e0] text-[12px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20" />
              <button onClick={addPrompt} className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#f0f0f0] hover:bg-[#e0e0e0]">Add</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
