'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface BackupArchive {
  id: string;
  createdAt: string;
  status: string;
  totalSizeBytes: number;
  databaseSizeBytes: number;
  documentsCount: number;
  documentsSizeBytes: number;
  formatVersion: string;
  isVerified?: boolean;
}

interface PreviewSummary {
  backupId: string;
  createdAt: string;
  appVersion: string;
  schemaVersion: string;
  isValid: boolean;
  errors: string[];
  warnings: string[];
  counts: {
    providers: number;
    organizations: number;
    affiliations: number;
    payerEnrollments: number;
    users: number;
    documents: number;
    auditLogs: number;
    tasks: number;
    notes: number;
    totalTables: number;
  };
  conflicts?: {
    existingProvidersByNpi: Array<{ npi: string; name: string }>;
    existingOrganizationsByNpi: Array<{ npi: string; name: string }>;
    existingUsersByEmail: Array<{ email: string; role: string }>;
  };
  supportedModes: Array<'full' | 'selective'>;
}

export default function SystemAdministrationPage() {
  const [activeTab, setActiveTab] = useState<'export' | 'restore' | 'reset'>('export');
  const [backups, setBackups] = useState<BackupArchive[]>([]);
  const [canRestoreOrReset, setCanRestoreOrReset] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [alert, setAlert] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; message: string } | null>(null);

  // Restore State
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [selectedServerBackupId, setSelectedServerBackupId] = useState<string>('');
  const [validationLoading, setValidationLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewSummary | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [restoreMode, setRestoreMode] = useState<'full' | 'selective'>('full');
  const [selectedEntities, setSelectedEntities] = useState<string[]>([
    'providers',
    'organizations',
    'enrollments',
    'documents',
  ]);
  const [conflictResolution, setConflictResolution] = useState<'skip_existing' | 'overwrite_existing'>('skip_existing');
  const [restoreConfirmInput, setRestoreConfirmInput] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreMfaCode, setRestoreMfaCode] = useState('');
  const [restoreResultReport, setRestoreResultReport] = useState<any | null>(null);

  // Reset State
  const [resetModalType, setResetModalType] = useState<'business_data' | 'fresh_install' | null>(null);
  const [resetConfirmInput, setResetConfirmInput] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetMfaCode, setResetMfaCode] = useState('');
  const [resetting, setResetting] = useState(false);

  const fetchBackups = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/admin/system/export');
      if (res.ok) {
        const data = await res.json();
        setBackups(data.backups || []);
      } else if (res.status === 403) {
        setAlert({
          type: 'error',
          message: 'Access Denied: Administrator privileges are required to view System Administration.',
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    fetchBackups();
    fetch('/api/v1/auth/me', { cache: 'no-store' })
      .then(async (res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (isMounted) setCanRestoreOrReset(data?.user?.role === 'super_admin');
      })
      .catch(() => {
        if (isMounted) setCanRestoreOrReset(false);
      });
    return () => {
      isMounted = false;
    };
  }, [fetchBackups]);

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  // 1. Export Complete Backup ZIP
  const handleTriggerExport = async () => {
    try {
      setActionLoading(true);
      setAlert(null);
      const res = await fetch('/api/v1/admin/system/export', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Export failed.');
      }
      setAlert({
        type: 'success',
        message: `Complete ZIP export '${data.backup.backupId}' created successfully (${formatBytes(
          data.backup.database.sizeBytes + data.backup.documents.sizeBytes
        )}, 29 tables, ${data.backup.documents.count} documents).`,
      });
      fetchBackups();
    } catch (err: unknown) {
      setAlert({
        type: 'error',
        message: err instanceof Error ? err.message : 'Export failed.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  // 2. Download Archive
  const handleDownload = (backupId: string) => {
    window.location.href = `/api/v1/admin/system/export/${backupId}/download`;
  };

  // 3. Stage 1 & 2: Validate Archive
  const handleValidateArchive = async () => {
    try {
      setValidationLoading(true);
      setValidationErrors([]);
      setPreview(null);
      setRestoreResultReport(null);
      setAlert(null);

      let res: Response;

      if (uploadedFile) {
        const formData = new FormData();
        formData.append('file', uploadedFile);
        res = await fetch('/api/v1/admin/system/restore/validate', {
          method: 'POST',
          body: formData,
        });
      } else if (selectedServerBackupId) {
        res = await fetch('/api/v1/admin/system/restore/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ backupId: selectedServerBackupId }),
        });
      } else {
        throw new Error('Please select an uploaded ZIP file or an existing server backup to validate.');
      }

      const data = await res.json();
      if (!res.ok || !data.isValid) {
        setValidationErrors(data.errors || [data.message || 'Validation failed']);
        setAlert({
          type: 'error',
          message: 'ZIP archive validation failed. Review the security and integrity errors below.',
        });
      } else {
        setPreview(data.preview);
        setAlert({
          type: 'success',
          message: `Archive '${data.preview.backupId}' passed integrity verification and is ready for preview.`,
        });
      }
    } catch (err: unknown) {
      setAlert({
        type: 'error',
        message: err instanceof Error ? err.message : 'Validation error.',
      });
    } finally {
      setValidationLoading(false);
    }
  };

  // 4. Stage 3 & 4: Execute Restore
  const handleExecuteRestore = async () => {
    if (!preview) return;
    try {
      setActionLoading(true);
      setAlert(null);

      let payload: any = {
        mode: restoreMode,
        confirmPhrase: restoreConfirmInput.trim(),
        sudoPassword: restorePassword.trim(),
        mfaCode: restoreMfaCode.trim(),
      };

      if (restoreMode === 'selective') {
        payload.entityTypes = selectedEntities;
        payload.conflictResolution = conflictResolution;
      }

      let res: Response;

      if (uploadedFile) {
        const formData = new FormData();
        formData.append('file', uploadedFile);
        formData.append('mode', restoreMode);
        formData.append('confirmPhrase', restoreConfirmInput.trim());
        formData.append('sudoPassword', restorePassword.trim());
        formData.append('mfaCode', restoreMfaCode.trim());
        formData.append('entityTypes', JSON.stringify(selectedEntities));
        formData.append('conflictResolution', conflictResolution);
        res = await fetch('/api/v1/admin/system/restore/execute', {
          method: 'POST',
          body: formData,
        });
      } else {
        payload.backupId = selectedServerBackupId || preview.backupId;
        res = await fetch('/api/v1/admin/system/restore/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Restore failed.');
      }

      setRestoreResultReport(data.report);
      const restoreHasWarnings = data.report?.success === false || (data.report?.warnings?.length ?? 0) > 0;
      setAlert({
        type: restoreHasWarnings ? 'warning' : 'success',
        message: data.message || 'System restore completed successfully.',
      });
      fetchBackups();
    } catch (err: unknown) {
      setAlert({
        type: 'error',
        message: err instanceof Error ? err.message : 'Restore execution error.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  // 5. Execute Reset
  const handleExecuteReset = async () => {
    if (!resetModalType) return;
    try {
      setResetting(true);
      setAlert(null);

      const expectedPhrase =
        resetModalType === 'fresh_install' ? 'RESET FRESH INSTALL' : 'RESET BUSINESS DATA';

      if (resetConfirmInput.trim() !== expectedPhrase) {
        throw new Error(`You must type exactly "${expectedPhrase}" to confirm.`);
      }

      const res = await fetch('/api/v1/admin/system/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: resetModalType,
          confirmPhrase: resetConfirmInput.trim(),
          sudoPassword: resetPassword.trim(),
          mfaCode: resetMfaCode.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Reset failed.');
      }

      setAlert({
        type: 'success',
        message: `${data.message} Verified safety backup '${data.report?.backupId}' saved.`,
      });

      setResetModalType(null);
      setResetConfirmInput('');
      setResetPassword('');
      setResetMfaCode('');
      fetchBackups();
    } catch (err: unknown) {
      setAlert({
        type: 'error',
        message: err instanceof Error ? err.message : 'Reset execution error.',
      });
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12" id="system-admin-root">
      {/* Top Header */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-6 text-white shadow-xl border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-300 text-xs font-semibold uppercase tracking-wider mb-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>Production Admin Center</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">System Administration & Data Portability</h1>
            <p className="text-sm text-slate-300 mt-1 max-w-2xl">
              Perform complete application exports to downloadable ZIP archives, validated data restorations,
              and safeguarded dependency-safe application resets.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="px-3 py-1.5 bg-slate-800/80 border border-slate-700/80 rounded-lg text-xs font-mono text-slate-300">
              AES-256-GCM
            </span>
            <span className="px-3 py-1.5 bg-slate-800/80 border border-slate-700/80 rounded-lg text-xs font-mono text-slate-300">
              PostgreSQL (29 Tables)
            </span>
            <span className="px-3 py-1.5 bg-slate-800/80 border border-slate-700/80 rounded-lg text-xs font-mono text-slate-300">
              MinIO S3
            </span>
          </div>
        </div>
      </div>

      {/* Alert Notification Banner */}
      {alert && (
        <div
          id="system-alert-banner"
          className={`p-4 rounded-xl text-sm border flex items-center justify-between shadow-sm transition-all ${
            alert.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : alert.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-900'
              : alert.type === 'warning'
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-blue-50 border-blue-200 text-blue-900'
          }`}
        >
          <div className="flex items-center space-x-3">
            <span className="text-lg">
              {alert.type === 'success' ? '✓' : alert.type === 'error' ? '✕' : 'ℹ'}
            </span>
            <span>{alert.message}</span>
          </div>
          <button
            onClick={() => setAlert(null)}
            className="text-slate-400 hover:text-slate-600 text-xs font-semibold px-2 py-1 rounded"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Segmented Controller / Tabs */}
      <div className="flex space-x-2 bg-slate-200/80 p-1.5 rounded-xl border border-slate-300/80">
        <button
          id="tab-btn-export"
          onClick={() => setActiveTab('export')}
          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all flex items-center justify-center space-x-2 ${
            activeTab === 'export'
              ? 'bg-white text-blue-700 shadow-sm border border-slate-200'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <span>💾</span>
          <span>1. Backup & Complete ZIP Export</span>
        </button>

        {canRestoreOrReset && (
          <>
            <button
              id="tab-btn-restore"
              onClick={() => setActiveTab('restore')}
              className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all flex items-center justify-center space-x-2 ${
                activeTab === 'restore'
                  ? 'bg-white text-indigo-700 shadow-sm border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>📥</span>
              <span>2. Restore & ZIP Import</span>
            </button>

            <button
              id="tab-btn-reset"
              onClick={() => setActiveTab('reset')}
              className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all flex items-center justify-center space-x-2 ${
                activeTab === 'reset'
                  ? 'bg-white text-rose-700 shadow-sm border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>⚠️</span>
              <span>3. Application Reset</span>
            </button>
          </>
        )}
      </div>

      {/* TAB 1: BACKUP & COMPLETE ZIP EXPORT */}
      {activeTab === 'export' && (
        <div className="space-y-6" id="tab-content-export">
          {/* Action Header Card */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Coordinated Backup & ZIP Archive Generator</h2>
              <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                Packages all 29 PostgreSQL database tables (SQL & JSON), all MinIO document storage files across
                buckets, and a cryptographically verified SHA-256 manifest into a portable ZIP archive.
              </p>
              <div className="flex items-center space-x-4 mt-3 text-xs text-slate-500">
                <span>🛡️ Secrets Excluded (.env, Keys, Passwords)</span>
                <span>•</span>
                <span>📋 Manifest Checked (SHA-256)</span>
                <span>•</span>
                <span>🗄️ MinIO Bundled</span>
              </div>
            </div>

            <button
              id="btn-create-zip-export"
              onClick={handleTriggerExport}
              disabled={actionLoading}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-xl shadow-md transition flex items-center space-x-2 whitespace-nowrap"
            >
              {actionLoading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>Generating Complete Archive...</span>
                </>
              ) : (
                <>
                  <span>📦</span>
                  <span>Export Complete Backup ZIP</span>
                </>
              )}
            </button>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Total Available Backups
              </span>
              <div className="text-2xl font-bold text-slate-900 mt-1">{backups.length}</div>
              <div className="text-xs text-slate-400 mt-1">Stored in protected backups/ directory</div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Latest Archive
              </span>
              <div className="text-sm font-mono font-medium text-slate-900 mt-1 truncate">
                {backups.length > 0 ? backups[0].id : 'No backups created yet'}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                {backups.length > 0 ? new Date(backups[0].createdAt).toLocaleString() : 'N/A'}
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Total Archive Storage Size
              </span>
              <div className="text-2xl font-bold text-slate-900 mt-1">
                {formatBytes(backups.reduce((acc, b) => acc + (b.totalSizeBytes || 0), 0))}
              </div>
              <div className="text-xs text-slate-400 mt-1">Compressed archives & manifest reports</div>
            </div>
          </div>

          {/* Backups List Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Available Backup Archives</h3>
              <button
                onClick={fetchBackups}
                className="text-xs text-blue-600 hover:text-blue-800 font-semibold"
              >
                ↻ Refresh List
              </button>
            </div>

            <table className="min-w-full divide-y divide-slate-200 text-sm" id="table-backup-archives">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-3 px-6 text-left">Backup Identifier / Timestamp</th>
                  <th className="py-3 px-6 text-left">Format</th>
                  <th className="py-3 px-6 text-left">Database Size</th>
                  <th className="py-3 px-6 text-left">Documents</th>
                  <th className="py-3 px-6 text-left">Total Size</th>
                  <th className="py-3 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      Loading backup archives...
                    </td>
                  </tr>
                ) : backups.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      No backup archives found. Click &quot;Export Complete Backup ZIP&quot; to generate an archive.
                    </td>
                  </tr>
                ) : (
                  backups.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50 transition">
                      <td className="py-3 px-6">
                        <div className="font-mono text-xs font-bold text-slate-900">{b.id}</div>
                        <div className="text-[11px] text-slate-400">
                          {new Date(b.createdAt).toLocaleString()}
                        </div>
                      </td>
                      <td className="py-3 px-6">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          ZIP v{b.formatVersion || '2.0'}
                        </span>
                      </td>
                      <td className="py-3 px-6 text-xs font-mono">{formatBytes(b.databaseSizeBytes)}</td>
                      <td className="py-3 px-6 text-xs">
                        <div>{b.documentsCount} files</div>
                        <div className="text-slate-400 font-mono text-[11px]">
                          {formatBytes(b.documentsSizeBytes)}
                        </div>
                      </td>
                      <td className="py-3 px-6 text-xs font-bold text-slate-900">
                        {formatBytes(b.totalSizeBytes)}
                      </td>
                      <td className="py-3 px-6 text-right space-x-2">
                        <button
                          onClick={() => handleDownload(b.id)}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 transition"
                          title="Download ZIP archive"
                        >
                          ⬇ Download ZIP
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: RESTORE & ZIP IMPORT */}
      {activeTab === 'restore' && (
        <div className="space-y-6" id="tab-content-restore">
          {/* Stage 1: Upload & Select */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <h2 className="text-lg font-bold text-slate-900">Stage 1: Upload & Validate Backup ZIP Archive</h2>
            <p className="text-xs text-slate-500">
              Upload a compatible backup ZIP or choose an existing server-side backup snapshot.
              The archive will undergo rigorous integrity verification, Zip Slip path traversal checks,
              decompression bomb protection, and schema compatibility analysis before any preview is displayed.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              {/* Option 1: File Upload */}
              <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:border-indigo-500 transition">
                <input
                  type="file"
                  id="input-backup-zip-file"
                  accept=".zip"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setUploadedFile(file);
                    setSelectedServerBackupId('');
                    setPreview(null);
                    setValidationErrors([]);
                  }}
                  className="hidden"
                />
                <label htmlFor="input-backup-zip-file" className="cursor-pointer block">
                  <span className="text-3xl block mb-2">📁</span>
                  <span className="text-sm font-semibold text-indigo-600 hover:text-indigo-800">
                    {uploadedFile ? uploadedFile.name : 'Click to upload backup ZIP file'}
                  </span>
                  <span className="text-xs text-slate-400 block mt-1">
                    {uploadedFile ? `${formatBytes(uploadedFile.size)}` : 'Max size: 500 MB (Standard ZIP)'}
                  </span>
                </label>
              </div>

              {/* Option 2: Server Backup Select */}
              <div className="border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
                <div>
                  <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block mb-2">
                    Or select an existing server-side backup:
                  </label>
                  <select
                    id="select-server-backup"
                    value={selectedServerBackupId}
                    onChange={(e) => {
                      setSelectedServerBackupId(e.target.value);
                      setUploadedFile(null);
                      setPreview(null);
                      setValidationErrors([]);
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white font-mono"
                  >
                    <option value="">-- Choose a server backup --</option>
                    {backups.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.id} ({formatBytes(b.totalSizeBytes)})
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  id="btn-validate-archive"
                  onClick={handleValidateArchive}
                  disabled={validationLoading || (!uploadedFile && !selectedServerBackupId)}
                  className="w-full mt-4 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-xs font-semibold rounded-lg shadow-sm transition flex items-center justify-center space-x-2"
                >
                  {validationLoading ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                      <span>Verifying Archive & Checksums...</span>
                    </>
                  ) : (
                    <>
                      <span>🔍</span>
                      <span>Validate Archive & Generate Preview</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Validation Errors Display */}
            {validationErrors.length > 0 && (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 space-y-1">
                <span className="font-bold block">Archive Validation Rejections:</span>
                <ul className="list-disc list-inside space-y-0.5">
                  {validationErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Stage 2 & 3: Preview and Mode Selection */}
          {preview && (
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6" id="section-restore-preview">
              <div className="border-b border-slate-200 pb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Stage 2: Archive Inspection & Preview</h3>
                  <div className="text-xs text-slate-500 mt-0.5 font-mono">
                    Backup ID: <span className="font-semibold text-slate-900">{preview.backupId}</span> | Created:{' '}
                    {new Date(preview.createdAt).toLocaleString()} | Schema Version: {preview.schemaVersion}
                  </div>
                </div>
                <span className="px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-full">
                  ✓ Integrity & Checksums Verified
                </span>
              </div>

              {/* Entity Counts Grid */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-lg font-bold text-slate-900">{preview.counts.providers}</div>
                  <div className="text-[11px] text-slate-500 font-medium">Providers</div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-lg font-bold text-slate-900">{preview.counts.organizations}</div>
                  <div className="text-[11px] text-slate-500 font-medium">Organizations</div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-lg font-bold text-slate-900">{preview.counts.payerEnrollments}</div>
                  <div className="text-[11px] text-slate-500 font-medium">Payer Enrollments</div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-lg font-bold text-slate-900">{preview.counts.documents}</div>
                  <div className="text-[11px] text-slate-500 font-medium">Storage Documents</div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-lg font-bold text-slate-900">{preview.counts.auditLogs}</div>
                  <div className="text-[11px] text-slate-500 font-medium">Audit Records</div>
                </div>
              </div>

              {/* Conflict Preview Notice if duplicate records found */}
              {preview.conflicts &&
                (preview.conflicts.existingProvidersByNpi.length > 0 ||
                  preview.conflicts.existingOrganizationsByNpi.length > 0) && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
                    <span className="font-bold block">Duplicate Key Conflicts Detected in Active System:</span>
                    <p>
                      {preview.conflicts.existingProvidersByNpi.length} providers and{' '}
                      {preview.conflicts.existingOrganizationsByNpi.length} organizations in this backup share unique
                      keys (NPIs) with records in the current active database.
                    </p>
                  </div>
                )}

              {/* Stage 3: Mode Selection */}
              <div className="space-y-4 pt-2">
                <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                  Stage 3: Choose Restore Mode
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Mode A: Full System Restore */}
                  <label
                    className={`border rounded-xl p-4 cursor-pointer transition block ${
                      restoreMode === 'full'
                        ? 'border-indigo-600 bg-indigo-50/50 shadow-sm'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      <input
                        type="radio"
                        name="restoreMode"
                        value="full"
                        checked={restoreMode === 'full'}
                        onChange={() => setRestoreMode('full')}
                        className="mt-1"
                      />
                      <div>
                        <span className="font-bold text-sm text-slate-900 block">
                          Mode A: Full System Restore (Complete Replacement)
                        </span>
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                          Restores all database tables and storage documents. An automatic{' '}
                          <strong>pre-restore safety recovery point backup</strong> is created before any records
                          are replaced.
                        </p>
                      </div>
                    </div>
                  </label>

                  {/* Mode B: Selective Import */}
                  <label
                    className={`border rounded-xl p-4 cursor-pointer transition block ${
                      restoreMode === 'selective'
                        ? 'border-indigo-600 bg-indigo-50/50 shadow-sm'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      <input
                        type="radio"
                        name="restoreMode"
                        value="selective"
                        checked={restoreMode === 'selective'}
                        onChange={() => setRestoreMode('selective')}
                        className="mt-1"
                      />
                      <div>
                        <span className="font-bold text-sm text-slate-900 block">
                          Mode B: Selective Data Import
                        </span>
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                          Imports specific entities into the existing system without replacing unrelated records.
                          Preserves existing foreign keys and resolves conflicts safely.
                        </p>
                      </div>
                    </div>
                  </label>
                </div>

                {/* Selective Options */}
                {restoreMode === 'selective' && (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                    <span className="text-xs font-bold text-slate-700 block">Select Entities to Import:</span>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      {[
                        { id: 'providers', label: 'Providers & Credentials' },
                        { id: 'organizations', label: 'Organizations & Groups' },
                        { id: 'enrollments', label: 'Payer Enrollments' },
                        { id: 'documents', label: 'Document Files & Versions' },
                      ].map((item) => (
                        <label key={item.id} className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedEntities.includes(item.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedEntities([...selectedEntities, item.id]);
                              } else {
                                setSelectedEntities(selectedEntities.filter((id) => id !== item.id));
                              }
                            }}
                          />
                          <span>{item.label}</span>
                        </label>
                      ))}
                    </div>

                    <div className="pt-2">
                      <span className="text-xs font-bold text-slate-700 block mb-1">Conflict Resolution Strategy:</span>
                      <select
                        value={conflictResolution}
                        onChange={(e) => setConflictResolution(e.target.value as any)}
                        className="text-xs px-3 py-1.5 border border-slate-300 rounded bg-white"
                      >
                        <option value="skip_existing">Skip Existing (Preserve active records on conflict)</option>
                        <option value="overwrite_existing">Overwrite Existing (Update matching unique keys)</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Stage 4: Authentication & Confirmation */}
                <div className="p-5 bg-slate-900 text-white rounded-xl space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Stage 4: Sensitive Operation Authorization & Final Confirmation
                  </h4>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-slate-300 block mb-1">
                        Administrator Password (Required):
                      </label>
                      <input
                        type="password"
                        id="input-restore-password"
                        value={restorePassword}
                        onChange={(e) => setRestorePassword(e.target.value)}
                        placeholder="Enter your administrator password"
                        className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-slate-300 block mb-1">
                        TOTP MFA Code (Optional if MFA not enrolled):
                      </label>
                      <input
                        type="text"
                        id="input-restore-mfa"
                        value={restoreMfaCode}
                        onChange={(e) => setRestoreMfaCode(e.target.value)}
                        placeholder="6-digit authenticator code"
                        className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white font-mono"
                      />
                    </div>
                  </div>

                  {restoreMode === 'full' && (
                    <div>
                      <label className="text-xs text-amber-300 block mb-1 font-semibold">
                        Type confirmation phrase <span className="font-mono text-white underline">RESTORE FULL SYSTEM</span> to proceed:
                      </label>
                      <input
                        type="text"
                        id="input-restore-confirm-phrase"
                        value={restoreConfirmInput}
                        onChange={(e) => setRestoreConfirmInput(e.target.value)}
                        placeholder="RESTORE FULL SYSTEM"
                        className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-amber-500/50 text-xs text-white font-mono"
                      />
                    </div>
                  )}

                  <div className="flex justify-end pt-2">
                    <button
                      id="btn-execute-restore"
                      onClick={handleExecuteRestore}
                      disabled={
                        actionLoading ||
                        !restorePassword.trim() ||
                        (restoreMode === 'full' && restoreConfirmInput.trim() !== 'RESTORE FULL SYSTEM')
                      }
                      className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-bold rounded-lg shadow-md transition flex items-center space-x-2"
                    >
                      {actionLoading ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                          <span>Executing Restore...</span>
                        </>
                      ) : (
                        <>
                          <span>⚡</span>
                          <span>Execute {restoreMode === 'full' ? 'Full System Restore' : 'Selective Import'}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Restore Result Report */}
          {restoreResultReport && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-emerald-950 space-y-3" id="restore-report-box">
              <h3 className="font-bold text-sm flex items-center space-x-2">
                <span>✓</span>
                <span>Restoration Execution Report</span>
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div>Backup ID: <span className="font-mono font-bold">{restoreResultReport.backupId}</span></div>
                <div>Mode: <span className="font-bold capitalize">{restoreResultReport.mode}</span></div>
                <div>Records Replaced: <span className="font-bold">{Object.values((restoreResultReport.recordsRemoved || {}) as Record<string, number>).reduce((total, count) => total + count, 0)}</span></div>
                <div>Records Restored: <span className="font-bold">{Object.values((restoreResultReport.recordsRestored || {}) as Record<string, number>).reduce((total, count) => total + count, 0)}</span></div>
                <div>Documents Restored: <span className="font-bold">{restoreResultReport.documentsRestored}</span></div>
                <div>Recovery Point: <span className="font-mono">{restoreResultReport.recoveryPointId || 'Saved'}</span></div>
              </div>
              {restoreResultReport.warnings?.length > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                  <strong>Restore completed with warnings:</strong>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {restoreResultReport.warnings.map((warning: string, index: number) => (
                      <li key={`${index}-${warning}`}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: APPLICATION RESET */}
      {activeTab === 'reset' && (
        <div className="space-y-6" id="tab-content-reset">
          {/* Danger Zone Banner */}
          <div className="p-6 rounded-2xl bg-rose-50 border border-rose-200 text-rose-950 space-y-2">
            <div className="flex items-center space-x-3 text-rose-700">
              <span className="text-2xl">⚠️</span>
              <h2 className="text-lg font-bold">Admin-Only Application Reset Center</h2>
            </div>
            <p className="text-xs text-rose-900 leading-relaxed">
              Application reset operations permanently clear records from the active PostgreSQL database and MinIO
              document storage. To protect against accidental data loss, every reset operation enforces a{' '}
              <strong>mandatory verified backup</strong>, double phrase confirmation, and administrator password
              verification. Docker persistent volumes are never deleted.
            </p>
          </div>

          {/* Reset Options Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Option A: Reset Business Data */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-xs font-bold uppercase">
                    Option A
                  </span>
                  <span className="text-xs text-slate-400">Dependency-Safe Deletion</span>
                </div>
                <h3 className="text-base font-bold text-slate-900">Reset Business Data</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Removes providers, organizations, affiliations, payer enrollments, credentials, tasks, notes,
                  and associated document files and metadata.
                </p>

                <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1.5 border border-slate-200">
                  <div className="font-semibold text-slate-700">What is Preserved:</div>
                  <ul className="list-disc list-inside text-slate-600 space-y-0.5 text-[11px]">
                    <li>User accounts & active administrator sessions</li>
                    <li>System settings & configuration</li>
                    <li>CMS/NUCC Taxonomy reference codes</li>
                    <li>Standard expiration alert rules</li>
                    <li><strong>Immutable audit log trail</strong> (Trigger-protected)</li>
                  </ul>
                </div>
              </div>

              <button
                id="btn-open-reset-business-data"
                onClick={() => {
                  setResetModalType('business_data');
                  setResetConfirmInput('');
                  setResetPassword('');
                  setResetMfaCode('');
                }}
                className="w-full py-2.5 px-4 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl shadow-sm transition"
              >
                Initiate Business Data Reset...
              </button>
            </div>

            {/* Option B: Reset to Fresh Installation */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-1 bg-rose-50 text-rose-800 border border-rose-200 rounded-lg text-xs font-bold uppercase">
                    Option B
                  </span>
                  <span className="text-xs text-slate-400">Clean-Install State</span>
                </div>
                <h3 className="text-base font-bold text-slate-900">Reset to Fresh Installation</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Returns the application to a clean-install state. Removes all business data, non-admin accounts,
                  and user sessions. Re-provisions initial administrator with forced password change.
                </p>

                <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1.5 border border-slate-200">
                  <div className="font-semibold text-slate-700">Initial Administrator Provisioning:</div>
                  <ul className="list-disc list-inside text-slate-600 space-y-0.5 text-[11px]">
                    <li>Account: <code className="font-bold">admin</code> (Super Admin role)</li>
                    <li>Temporary password comes from server configuration; no default password is used</li>
                    <li>Forced password change on first login enabled</li>
                    <li>Reference taxonomy codes & expiration rules seeded</li>
                    <li>Immutable audit logs preserved with reset record</li>
                    <li>Zero Docker volume drops or infrastructure deletions</li>
                  </ul>
                </div>
              </div>

              <button
                id="btn-open-reset-fresh-install"
                onClick={() => {
                  setResetModalType('fresh_install');
                  setResetConfirmInput('');
                  setResetPassword('');
                  setResetMfaCode('');
                }}
                className="w-full py-2.5 px-4 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-sm transition"
              >
                Initiate Fresh Installation Reset...
              </button>
            </div>
          </div>

          {/* Reset Confirmation Modal */}
          {resetModalType && (
            <div
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
              id="modal-reset-confirmation"
            >
              <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 space-y-5">
                <div className="flex items-center space-x-3 text-rose-600">
                  <span className="text-2xl">⚠️</span>
                  <h3 className="text-base font-bold text-slate-900">
                    Confirm {resetModalType === 'fresh_install' ? 'Fresh Installation Reset' : 'Business Data Reset'}
                  </h3>
                </div>

                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 space-y-1.5">
                  <span className="font-bold block">Safety Preconditions Enforced:</span>
                  <p>
                    1. A <strong>fresh verified backup archive</strong> will be generated automatically before any
                    deletion commences. If the backup fails, the reset will abort immediately.
                  </p>
                  <p>2. Action is strictly irreversible without restoring from the generated backup.</p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Type <span className="font-mono text-rose-600 font-bold">
                        {resetModalType === 'fresh_install' ? 'RESET FRESH INSTALL' : 'RESET BUSINESS DATA'}
                      </span>{' '}
                      in the box below to confirm:
                    </label>
                    <input
                      type="text"
                      id="input-reset-confirm-phrase"
                      value={resetConfirmInput}
                      onChange={(e) => setResetConfirmInput(e.target.value)}
                      placeholder={resetModalType === 'fresh_install' ? 'RESET FRESH INSTALL' : 'RESET BUSINESS DATA'}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Administrator Password (Required):
                    </label>
                    <input
                      type="password"
                      id="input-reset-password"
                      value={resetPassword}
                      onChange={(e) => setResetPassword(e.target.value)}
                      placeholder="Enter administrator password"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      MFA Code (Optional if MFA not enrolled):
                    </label>
                    <input
                      type="text"
                      id="input-reset-mfa"
                      value={resetMfaCode}
                      onChange={(e) => setResetMfaCode(e.target.value)}
                      placeholder="6-digit TOTP code"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                    />
                  </div>
                </div>

                <div className="flex justify-end space-x-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setResetModalType(null)}
                    disabled={resetting}
                    className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    id="btn-execute-reset-confirm"
                    onClick={handleExecuteReset}
                    disabled={
                      resetting ||
                      !resetPassword.trim() ||
                      resetConfirmInput.trim() !==
                        (resetModalType === 'fresh_install'
                          ? 'RESET FRESH INSTALL'
                          : 'RESET BUSINESS DATA')
                    }
                    className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300 text-white text-xs font-bold rounded-lg shadow-sm"
                  >
                    {resetting ? 'Executing Reset & Safety Backup...' : 'Confirm & Execute Reset'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
