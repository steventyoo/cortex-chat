'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface SubFolder {
  id: string;
  name: string;
}

const STEPS = ['Connect Drive', 'Select Projects', 'Create Project', 'Invite Team', 'Done'];

export default function OnboardingWizard({
  orgName,
  serviceAccountEmail,
}: {
  orgName: string;
  serviceAccountEmail: string;
}) {
  const [step, setStep] = useState(0);

  // Step 0: Connect Drive
  const [folderId, setFolderId] = useState('');
  const [testing, setTesting] = useState(false);
  const [driveError, setDriveError] = useState('');
  const [folderName, setFolderName] = useState('');
  const [subfolders, setSubfolders] = useState<SubFolder[]>([]);

  // Step 1: Select Projects
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);

  // Step 2: Create Project (manual)
  const [manualProjectName, setManualProjectName] = useState('');
  const [manualProjectAddress, setManualProjectAddress] = useState('');
  const [manualProjectTrade, setManualProjectTrade] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [createProjectError, setCreateProjectError] = useState('');
  const [manualProjectCreated, setManualProjectCreated] = useState(false);

  // Step 3: Invite
  const [copied, setCopied] = useState(false);

  // ─── Step 1: Test Drive Connection ────────────────────────
  const handleTestDrive = useCallback(async () => {
    if (!folderId.trim()) return;
    setTesting(true);
    setDriveError('');

    try {
      const res = await fetch('/api/onboarding/test-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: folderId.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setDriveError(data.error || 'Connection failed');
        return;
      }

      setFolderName(data.folderName);
      setSubfolders(data.subfolders || []);

      // Auto-select all subfolders
      setSelectedFolders(new Set(data.subfolders.map((f: SubFolder) => f.id)));

      // Save the folder ID to the org
      await fetch('/api/onboarding/save-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: folderId.trim() }),
      }).catch(() => {}); // Non-critical

      setStep(1);
    } catch {
      setDriveError('Network error — please try again');
    } finally {
      setTesting(false);
    }
  }, [folderId]);

  // ─── Step 1: Import Selected Projects ─────────────────────
  const handleImportProjects = useCallback(async () => {
    const selected = subfolders.filter((f) => selectedFolders.has(f.id));
    if (selected.length === 0) {
      setStep(2);
      return;
    }

    setImporting(true);
    try {
      const res = await fetch('/api/onboarding/import-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projects: selected.map((f) => ({
            name: f.name,
            driveFolderId: f.id,
          })),
        }),
      });

      const data = await res.json();
      setImportedCount(data.created || 0);
      setStep(3);
    } catch {
      setStep(3);
    } finally {
      setImporting(false);
    }
  }, [subfolders, selectedFolders]);

  // ─── Step 2: Create Project Manually ────────────────────────
  const handleCreateProject = useCallback(async () => {
    if (!manualProjectName.trim()) return;
    setCreatingProject(true);
    setCreateProjectError('');

    try {
      const res = await fetch('/api/onboarding/import-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projects: [{
            name: manualProjectName.trim(),
            address: manualProjectAddress.trim() || undefined,
            trade: manualProjectTrade.trim() || undefined,
          }],
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setCreateProjectError(data.error || 'Failed to create project');
        return;
      }

      setManualProjectCreated(true);
      setStep(3);
    } catch {
      setCreateProjectError('Network error — please try again');
    } finally {
      setCreatingProject(false);
    }
  }, [manualProjectName, manualProjectAddress, manualProjectTrade]);

  // ─── Step 3: Copy Invite Link ─────────────────────────────
  const inviteUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/signup?org=${encodeURIComponent(orgName)}`
      : '';

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [inviteUrl]);

  // ─── Step 4: Complete ─────────────────────────────────────
  const handleComplete = useCallback(async () => {
    await fetch('/api/onboarding/complete', { method: 'POST' }).catch(() => {});
    window.location.href = '/';
  }, []);

  const toggleFolder = (id: string) => {
    setSelectedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="min-h-dvh bg-[#fafafa] flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-[#1a1a1a] flex items-center justify-center mx-auto mb-4">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="text-[22px] font-bold text-[#1a1a1a] mb-1">
            Set up {orgName}
          </h1>
          <p className="text-[14px] text-[#999]">
            Connect your project files to get started
          </p>
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`w-2.5 h-2.5 rounded-full transition-colors ${
                  i <= step ? 'bg-[#1a1a1a]' : 'bg-[#ddd]'
                }`}
              />
              {i < STEPS.length - 1 && (
                <div className={`w-8 h-px ${i < step ? 'bg-[#1a1a1a]' : 'bg-[#ddd]'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Steps */}
        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div
              key="step0"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="bg-white rounded-2xl border border-[#e8e8e8] p-6 shadow-sm"
            >
              <h2 className="text-[16px] font-semibold text-[#1a1a1a] mb-1">
                Connect Google Drive
              </h2>
              <p className="text-[13px] text-[#999] mb-5">
                Share your project folder with our service account, then paste the folder ID below.
              </p>

              {/* Instructions */}
              <div className="bg-[#f7f7f5] rounded-xl p-4 mb-5 space-y-3">
                <div className="flex items-start gap-3">
                  <span className="text-[12px] font-bold text-white bg-[#1a1a1a] rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
                  <div>
                    <p className="text-[13px] text-[#37352f]">
                      Open your Google Drive project folder
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-[12px] font-bold text-white bg-[#1a1a1a] rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
                  <div>
                    <p className="text-[13px] text-[#37352f]">
                      Right-click → Share → Add:
                    </p>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(serviceAccountEmail);
                      }}
                      className="text-[12px] text-[#007aff] bg-[#ebebea] rounded-lg px-2 py-1 mt-1 font-mono hover:bg-[#ddd] transition-colors"
                    >
                      {serviceAccountEmail} <span className="text-[10px]">📋</span>
                    </button>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-[12px] font-bold text-white bg-[#1a1a1a] rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
                  <div>
                    <p className="text-[13px] text-[#37352f]">
                      Copy the folder ID from the URL
                    </p>
                    <p className="text-[11px] text-[#999] mt-0.5">
                      drive.google.com/drive/folders/<span className="text-[#007aff] font-medium">THIS_PART</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Folder ID input */}
              <div className="mb-4">
                <input
                  type="text"
                  value={folderId}
                  onChange={(e) => { setFolderId(e.target.value); setDriveError(''); }}
                  placeholder="Paste folder ID here..."
                  className="w-full px-4 py-3 rounded-xl border border-[#e0e0e0] text-[14px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/30 focus:border-[#007aff] font-mono"
                />
              </div>

              {driveError && (
                <div className="mb-4 p-3 rounded-xl bg-[#fff5f5] border border-[#fecaca] text-[13px] text-[#dc2626]">
                  {driveError}
                </div>
              )}

              <button
                onClick={handleTestDrive}
                disabled={!folderId.trim() || testing}
                className="w-full py-3 rounded-xl bg-[#1a1a1a] text-white text-[14px] font-medium hover:bg-[#333] transition-colors disabled:opacity-40"
              >
                {testing ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    Testing connection...
                  </span>
                ) : (
                  'Test Connection'
                )}
              </button>

              <button
                onClick={() => setStep(2)}
                className="w-full mt-3 py-2 text-[13px] text-[#999] hover:text-[#666] transition-colors"
              >
                Skip — I&apos;ll do this later
              </button>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="bg-white rounded-2xl border border-[#e8e8e8] p-6 shadow-sm"
            >
              <h2 className="text-[16px] font-semibold text-[#1a1a1a] mb-1">
                Select Projects
              </h2>
              <p className="text-[13px] text-[#999] mb-1">
                Connected to: <span className="font-medium text-[#37352f]">{folderName}</span>
              </p>
              <p className="text-[13px] text-[#999] mb-5">
                {subfolders.length} subfolder{subfolders.length !== 1 ? 's' : ''} found. Select the ones that are projects.
              </p>

              {subfolders.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-[14px] text-[#999] mb-1">No subfolders found</p>
                  <p className="text-[12px] text-[#ccc]">
                    You can add projects manually later from the dashboard.
                  </p>
                </div>
              ) : (
                <div className="space-y-1 mb-5 max-h-[300px] overflow-y-auto">
                  {subfolders.map((f) => (
                    <label
                      key={f.id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#f7f7f5] cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedFolders.has(f.id)}
                        onChange={() => toggleFolder(f.id)}
                        className="w-4 h-4 rounded border-[#ccc] text-[#1a1a1a] focus:ring-[#1a1a1a]"
                      />
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5">
                          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                        </svg>
                        <span className="text-[13px] text-[#37352f] truncate">{f.name}</span>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => setStep(0)}
                  className="flex-1 py-3 rounded-xl text-[13px] text-[#666] hover:bg-[#f0f0f0] transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleImportProjects}
                  disabled={importing}
                  className="flex-1 py-3 rounded-xl bg-[#1a1a1a] text-white text-[14px] font-medium hover:bg-[#333] transition-colors disabled:opacity-40"
                >
                  {importing ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                        <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      Importing...
                    </span>
                  ) : (
                    `Import ${selectedFolders.size} project${selectedFolders.size !== 1 ? 's' : ''}`
                  )}
                </button>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="bg-white rounded-2xl border border-[#e8e8e8] p-6 shadow-sm"
            >
              <h2 className="text-[16px] font-semibold text-[#1a1a1a] mb-1">
                Create Your First Project
              </h2>
              <p className="text-[13px] text-[#999] mb-5">
                Add a project so you can start uploading and organizing documents.
              </p>

              <div className="space-y-3 mb-5">
                <div>
                  <label className="block text-[12px] font-medium text-[#555] mb-1">Project Name *</label>
                  <input
                    type="text"
                    value={manualProjectName}
                    onChange={(e) => { setManualProjectName(e.target.value); setCreateProjectError(''); }}
                    placeholder="e.g. Northgate Medical Center"
                    className="w-full px-4 py-3 rounded-xl border border-[#e0e0e0] text-[14px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/30 focus:border-[#007aff]"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#555] mb-1">Address (optional)</label>
                  <input
                    type="text"
                    value={manualProjectAddress}
                    onChange={(e) => setManualProjectAddress(e.target.value)}
                    placeholder="e.g. 123 Main St, Austin TX"
                    className="w-full px-4 py-3 rounded-xl border border-[#e0e0e0] text-[14px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/30 focus:border-[#007aff]"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#555] mb-1">Trade (optional)</label>
                  <input
                    type="text"
                    value={manualProjectTrade}
                    onChange={(e) => setManualProjectTrade(e.target.value)}
                    placeholder="e.g. Plumbing, Electrical, General"
                    className="w-full px-4 py-3 rounded-xl border border-[#e0e0e0] text-[14px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/30 focus:border-[#007aff]"
                  />
                </div>
              </div>

              {createProjectError && (
                <div className="mb-4 p-3 rounded-xl bg-[#fff5f5] border border-[#fecaca] text-[13px] text-[#dc2626]">
                  {createProjectError}
                </div>
              )}

              <button
                onClick={handleCreateProject}
                disabled={!manualProjectName.trim() || creatingProject}
                className="w-full py-3 rounded-xl bg-[#1a1a1a] text-white text-[14px] font-medium hover:bg-[#333] transition-colors disabled:opacity-40"
              >
                {creatingProject ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    Creating...
                  </span>
                ) : (
                  'Create Project'
                )}
              </button>

              <button
                onClick={() => setStep(3)}
                className="w-full mt-3 py-2 text-[13px] text-[#999] hover:text-[#666] transition-colors"
              >
                Skip — I&apos;ll add projects later
              </button>
              <p className="text-[11px] text-[#ccc] text-center mt-1">
                You&apos;ll need at least one project to upload documents.
              </p>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="bg-white rounded-2xl border border-[#e8e8e8] p-6 shadow-sm"
            >
              <h2 className="text-[16px] font-semibold text-[#1a1a1a] mb-1">
                Invite Your Team
              </h2>
              <p className="text-[13px] text-[#999] mb-5">
                Share this link with your team so they can create their accounts.
              </p>

              {importedCount > 0 && (
                <div className="bg-[#f0fdf4] border border-[#bbf7d0] rounded-xl p-3 mb-5 text-[13px] text-[#15803d]">
                  {importedCount} project{importedCount !== 1 ? 's' : ''} imported successfully
                </div>
              )}

              {manualProjectCreated && (
                <div className="bg-[#f0fdf4] border border-[#bbf7d0] rounded-xl p-3 mb-5 text-[13px] text-[#15803d]">
                  Project created successfully
                </div>
              )}

              <div className="relative mb-5">
                <input
                  type="text"
                  readOnly
                  value={inviteUrl}
                  className="w-full px-4 py-3 pr-20 rounded-xl border border-[#e0e0e0] text-[13px] font-mono bg-[#f7f7f5] text-[#37352f]"
                />
                <button
                  onClick={handleCopy}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-[#1a1a1a] text-white text-[12px] font-medium hover:bg-[#333] transition-colors"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>

              <p className="text-[12px] text-[#999] mb-5">
                Team members will join your <strong>{orgName}</strong> organization automatically.
              </p>

              <div className="flex gap-2">
                <button
                  onClick={() => setStep(2)}
                  className="flex-1 py-3 rounded-xl text-[13px] text-[#666] hover:bg-[#f0f0f0] transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(4)}
                  className="flex-1 py-3 rounded-xl bg-[#1a1a1a] text-white text-[14px] font-medium hover:bg-[#333] transition-colors"
                >
                  Continue
                </button>
              </div>

              <button
                onClick={() => setStep(4)}
                className="w-full mt-3 py-2 text-[13px] text-[#999] hover:text-[#666] transition-colors"
              >
                Skip — I&apos;ll invite later
              </button>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div
              key="step4"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="bg-white rounded-2xl border border-[#e8e8e8] p-6 shadow-sm text-center"
            >
              <div className="w-16 h-16 rounded-full bg-[#f0fdf4] flex items-center justify-center mx-auto mb-4">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <h2 className="text-[18px] font-semibold text-[#1a1a1a] mb-2">
                You&apos;re all set!
              </h2>
              <p className="text-[14px] text-[#999] mb-6">
                {orgName} is ready. Your AI project manager awaits.
              </p>

              <button
                onClick={handleComplete}
                className="w-full py-3 rounded-xl bg-[#1a1a1a] text-white text-[15px] font-medium hover:bg-[#333] transition-colors"
              >
                Go to Dashboard →
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
