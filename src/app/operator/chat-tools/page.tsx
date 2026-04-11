'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

interface ChatTool {
  id: string;
  tool_name: string;
  display_name: string;
  description: string;
  implementation_type: string;
  sample_prompts: string[];
  is_active: boolean;
  created_at: string;
}

interface PromptTemplate {
  id: string;
  template_name: string;
  trigger_description: string;
  trigger_keywords: string[];
  system_instructions: string;
  sample_prompts: string[];
  is_active: boolean;
  created_at: string;
}

interface Project {
  projectId: string;
  projectName: string;
}

const TYPE_LABELS: Record<string, string> = {
  sql_query: 'SQL Query',
  rag_search: 'RAG Search',
  api_call: 'API Call',
  composite: 'Composite',
};

const TYPE_COLORS: Record<string, string> = {
  sql_query: 'bg-[#dbeafe] text-[#1e40af]',
  rag_search: 'bg-[#dcfce7] text-[#166534]',
  api_call: 'bg-[#f3e8ff] text-[#6b21a8]',
  composite: 'bg-[#fef3c7] text-[#92400e]',
};

function OperatorNav() {
  const pathname = usePathname();
  const tabs = [
    { label: 'Skills', href: '/operator/skills' },
    { label: 'Field Catalog', href: '/operator/fields' },
    { label: 'Doc Links', href: '/operator/doc-links' },
    { label: 'Chat Tools', href: '/operator/chat-tools' },
    { label: 'Context Cards', href: '/operator/context-cards' },
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

export default function ChatToolsPage() {
  const [activeTab, setActiveTab] = useState<'tools' | 'templates'>('tools');
  const [tools, setTools] = useState<ChatTool[]>([]);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [embedLoading, setEmbedLoading] = useState(false);
  const [embedResult, setEmbedResult] = useState<{ embedded: number; skipped: number; total: number; errors?: string[] } | null>(null);
  const [includePending, setIncludePending] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [toolsRes, templatesRes, projectsRes] = await Promise.all([
        fetch('/api/chat-tools'),
        fetch('/api/chat-tools/templates'),
        fetch('/api/projects'),
      ]);
      if (toolsRes.ok) {
        const d = await toolsRes.json();
        setTools(d.tools || []);
      }
      if (templatesRes.ok) {
        const d = await templatesRes.json();
        setTemplates(d.templates || []);
      }
      if (projectsRes.ok) {
        const d = await projectsRes.json();
        setProjects(d.projects || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const saved = localStorage.getItem('cortex-include-pending');
    if (saved !== null) setIncludePending(saved === 'true');
  }, []);

  const toggleIncludePending = () => {
    const next = !includePending;
    setIncludePending(next);
    localStorage.setItem('cortex-include-pending', String(next));
  };

  const toggleToolActive = async (tool: ChatTool) => {
    await fetch(`/api/chat-tools/${tool.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !tool.is_active }),
    });
    fetchData();
  };

  const toggleTemplateActive = async (tpl: PromptTemplate) => {
    await fetch(`/api/chat-tools/templates/${tpl.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !tpl.is_active }),
    });
    fetchData();
  };

  const createNewTool = async () => {
    const res = await fetch('/api/chat-tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolName: `tool_${Date.now()}`,
        displayName: 'New Tool',
        description: 'Describe what this tool does...',
        implementationType: 'sql_query',
        implementationConfig: { table: '', select: '*', limit: 50, params_mapping: {} },
        inputSchema: { properties: {}, required: [] },
      }),
    });
    if (res.ok) {
      const data = await res.json();
      router.push(`/operator/chat-tools/${data.tool.id}`);
    }
  };

  const createNewTemplate = async () => {
    const res = await fetch('/api/chat-tools/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateName: `template_${Date.now()}`,
        triggerDescription: 'Describe when this template should activate...',
        triggerKeywords: [],
        systemInstructions: 'Additional instructions for Claude when this template matches...',
      }),
    });
    if (res.ok) {
      const data = await res.json();
      router.push(`/operator/chat-tools/templates/${data.template.id}`);
    }
  };

  const generateTestEmbeddings = async () => {
    if (!selectedProject) return;
    setEmbedLoading(true);
    setEmbedResult(null);
    try {
      const res = await fetch('/api/chat-tools/generate-embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedProject }),
      });
      if (res.ok) {
        const data = await res.json();
        setEmbedResult(data);
      } else {
        const err = await res.json();
        setEmbedResult({ embedded: 0, skipped: 0, total: 0, errors: [err.error || 'Request failed'] });
      }
    } catch (err) {
      setEmbedResult({ embedded: 0, skipped: 0, total: 0, errors: [String(err)] });
    }
    setEmbedLoading(false);
  };

  return (
    <div className="min-h-screen bg-white">
      <OperatorNav />

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[20px] font-semibold text-[#1a1a1a]">Chat Intelligence</h1>
            <p className="text-[13px] text-[#999] mt-1">
              Define callable tools and prompt templates that shape how the AI chat responds to queries.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 mb-6">
          <button
            onClick={() => setActiveTab('tools')}
            className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${
              activeTab === 'tools'
                ? 'bg-[#1a1a1a] text-white'
                : 'text-[#6b6b6b] hover:bg-[#f0f0f0]'
            }`}
          >
            Tools ({tools.length})
          </button>
          <button
            onClick={() => setActiveTab('templates')}
            className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${
              activeTab === 'templates'
                ? 'bg-[#1a1a1a] text-white'
                : 'text-[#6b6b6b] hover:bg-[#f0f0f0]'
            }`}
          >
            Prompt Templates ({templates.length})
          </button>
          <div className="flex-1" />
          {activeTab === 'tools' ? (
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  await fetch('/api/chat-tools/seed', { method: 'POST' });
                  fetchData();
                }}
                className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#f0f0f0] text-[#666] hover:bg-[#e0e0e0] transition-colors"
              >
                {tools.length === 0 ? 'Seed Defaults' : 'Sync Defaults'}
              </button>
              <button
                onClick={createNewTool}
                className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#007aff] text-white hover:bg-[#0066dd] transition-colors"
              >
                + New Tool
              </button>
            </div>
          ) : (
            <button
              onClick={createNewTemplate}
              className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#007aff] text-white hover:bg-[#0066dd] transition-colors"
            >
              + New Template
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-[14px] text-[#999]">
            <svg className="animate-spin w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            Loading...
          </div>
        ) : activeTab === 'tools' ? (
          tools.length === 0 ? (
            <div className="text-center py-20 text-[14px] text-[#999]">
              No tools defined yet. Create one to give the chat AI the ability to query your data.
            </div>
          ) : (
            <div className="border border-[#e8e8e8] rounded-lg overflow-hidden">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-[#fafafa] border-b border-[#e8e8e8]">
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[50px]">Active</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Name</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Type</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Description</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[80px]">Prompts</th>
                  </tr>
                </thead>
                <tbody>
                  {tools.map(tool => (
                    <tr
                      key={tool.id}
                      className={`border-b border-[#f0f0f0] last:border-b-0 hover:bg-[#fafafa] transition-colors cursor-pointer ${
                        !tool.is_active ? 'opacity-40' : ''
                      }`}
                      onClick={() => router.push(`/operator/chat-tools/${tool.id}`)}
                    >
                      <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => toggleToolActive(tool)}
                          className={`w-3.5 h-3.5 rounded-full border-2 ${
                            tool.is_active ? 'bg-[#16a34a] border-[#16a34a]' : 'bg-white border-[#ddd]'
                          }`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-[#1a1a1a]">{tool.display_name}</div>
                        <div className="text-[10px] text-[#999] font-mono">{tool.tool_name}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${TYPE_COLORS[tool.implementation_type] || 'bg-[#f0f0f0] text-[#666]'}`}>
                          {TYPE_LABELS[tool.implementation_type] || tool.implementation_type}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[#666] max-w-[300px] truncate">{tool.description}</td>
                      <td className="px-3 py-2 text-[#999] text-center">{tool.sample_prompts?.length || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          templates.length === 0 ? (
            <div className="text-center py-20 text-[14px] text-[#999]">
              No prompt templates defined yet. Create one to inject domain-specific instructions into chat responses.
            </div>
          ) : (
            <div className="border border-[#e8e8e8] rounded-lg overflow-hidden">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-[#fafafa] border-b border-[#e8e8e8]">
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[50px]">Active</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Name</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Trigger Keywords</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Description</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[80px]">Prompts</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map(tpl => (
                    <tr
                      key={tpl.id}
                      className={`border-b border-[#f0f0f0] last:border-b-0 hover:bg-[#fafafa] transition-colors cursor-pointer ${
                        !tpl.is_active ? 'opacity-40' : ''
                      }`}
                      onClick={() => router.push(`/operator/chat-tools/templates/${tpl.id}`)}
                    >
                      <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => toggleTemplateActive(tpl)}
                          className={`w-3.5 h-3.5 rounded-full border-2 ${
                            tpl.is_active ? 'bg-[#16a34a] border-[#16a34a]' : 'bg-white border-[#ddd]'
                          }`}
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-[#1a1a1a]">{tpl.template_name}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {tpl.trigger_keywords.map(kw => (
                            <span key={kw} className="text-[10px] px-1.5 py-0.5 rounded bg-[#f5f5f5] text-[#888] font-mono">{kw}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[#666] max-w-[300px] truncate">{tpl.trigger_description}</td>
                      <td className="px-3 py-2 text-[#999] text-center">{tpl.sample_prompts?.length || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* Debug: Generate Test Embeddings */}
        <div className="mt-10 border border-dashed border-[#e0c97f] rounded-lg p-5 bg-[#fffdf5]">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[#b8960c] bg-[#fef3c7] px-2 py-0.5 rounded">Debug</span>
            <h3 className="text-[14px] font-semibold text-[#1a1a1a]">Generate Test Embeddings</h3>
          </div>
          <p className="text-[12px] text-[#888] mb-4">
            Push unapproved pipeline records to the vector store with <span className="font-mono text-[11px] bg-[#f5f5f5] px-1 rounded">pending</span> status so you can test chat and RAG search tools before formal approval. Records will be re-embedded when approved.
          </p>

          <div className="flex items-center justify-between mb-4 p-3 bg-white rounded-md border border-[#e8e8e8]">
            <div>
              <div className="text-[13px] font-medium text-[#1a1a1a]">Include pending records in chat</div>
              <div className="text-[11px] text-[#999] mt-0.5">When enabled, chat and tool searches will include records that haven&apos;t been formally approved yet.</div>
            </div>
            <button
              onClick={toggleIncludePending}
              className={`relative w-10 h-[22px] rounded-full transition-colors flex-shrink-0 ml-4 ${
                includePending ? 'bg-[#16a34a]' : 'bg-[#d4d4d4]'
              }`}
            >
              <span className={`absolute top-[3px] w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
                includePending ? 'left-[22px]' : 'left-[3px]'
              }`} />
            </button>
          </div>

          <div className="flex items-end gap-3">
            <div className="flex-1 max-w-xs">
              <label className="block text-[11px] font-medium text-[#666] mb-1">Project</label>
              <select
                value={selectedProject}
                onChange={e => { setSelectedProject(e.target.value); setEmbedResult(null); }}
                className="w-full border border-[#ddd] rounded-md px-3 py-1.5 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff]"
              >
                <option value="">Select a project...</option>
                {projects.map(p => (
                  <option key={p.projectId} value={p.projectId}>{p.projectName}</option>
                ))}
              </select>
            </div>

            <button
              onClick={generateTestEmbeddings}
              disabled={!selectedProject || embedLoading}
              className="px-4 py-1.5 rounded-md text-[13px] font-medium bg-[#b8960c] text-white hover:bg-[#a0820a] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {embedLoading && (
                <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              )}
              {embedLoading ? 'Generating...' : 'Generate Embeddings'}
            </button>
          </div>

          {embedResult && (
            <div className={`mt-4 p-3 rounded-md text-[12px] ${embedResult.errors?.length ? 'bg-[#fef2f2] border border-[#fecaca] text-[#991b1b]' : 'bg-[#f0fdf4] border border-[#bbf7d0] text-[#166534]'}`}>
              {embedResult.embedded > 0 ? (
                <p>Embedded <strong>{embedResult.embedded}</strong> of {embedResult.total} records (skipped {embedResult.skipped}). These are now searchable in chat with <span className="font-mono bg-white/50 px-1 rounded">pending</span> status.</p>
              ) : embedResult.total === 0 ? (
                <p>No un-pushed pipeline records found for this project. Upload and extract documents first.</p>
              ) : (
                <p>Embedded 0 records. Skipped {embedResult.skipped} of {embedResult.total}.</p>
              )}
              {embedResult.errors && embedResult.errors.length > 0 && (
                <ul className="mt-2 list-disc list-inside">
                  {embedResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
