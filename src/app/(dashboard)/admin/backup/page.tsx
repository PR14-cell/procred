'use client';

import { useState, useEffect } from 'react';

interface BackupItem {
  id: string;
  createdAt: string;
  status: string;
  totalSizeBytes: number;
  databaseSizeBytes: number;
  documentsCount: number;
  documentsSizeBytes: number;
  isVerified?: boolean;
}

export default function BackupRestorePage() {
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [verificationResult, setVerificationResult] = useState<{
    id: string;
    isValid: boolean;
    errors?: string[];
  } | null>(null);

  // Restore Modal State
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [selectedBackupId, setSelectedBackupId] = useState<string | null>(null);
  const [confirmInput, setConfirmInput] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const fetchBackups = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/admin/backup');
      if (res.ok) {
        const data = await res.json();
        setBackups(data.backups || []);
      } else if (res.status === 403) {
        setRestoreMessage({
          type: 'error',
          text: 'Access Denied: Administrator privileges (admin or super_admin) are required to access Backup and Restore.',
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBackups();
  }, []);

  const handleCreateBackup = async () => {
    try {
      setCreating(true);
      setRestoreMessage(null);
      const res = await fetch('/api/v1/admin/backup', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to create backup');
      }
      setRestoreMessage({
        type: 'success',
        text: `Coordinated backup '${data.backup?.id}' created successfully.`,
      });
      fetchBackups();
    } catch (err: unknown) {
      setRestoreMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error creating backup',
      });
    } finally {
      setCreating(false);
    }
  };

  const handleVerify = async (backupId: string) => {
    try {
      setVerifyingId(backupId);
      const res = await fetch(`/api/v1/admin/backup/${backupId}/verify`, { method: 'POST' });
      const data = await res.json();
      setVerificationResult({
        id: backupId,
        isValid: data.isValid,
        errors: data.errors,
      });
    } catch (err) {
      setVerificationResult({
        id: backupId,
        isValid: false,
        errors: ['Verification request failed.'],
      });
    } finally {
      setVerifyingId(null);
    }
  };

  const handleDownload = (backupId: string) => {
    window.location.href = `/api/v1/admin/backup/${backupId}/download`;
  };

  const openRestoreModal = (backupId: string) => {
    setSelectedBackupId(backupId);
    setConfirmInput('');
    setRestoreMessage(null);
    setRestoreModalOpen(true);
  };

  const handleExecuteRestore = async () => {
    if (!selectedBackupId) return;
    try {
      setRestoring(true);
      setRestoreMessage(null);
      const res = await fetch(`/api/v1/admin/backup/${selectedBackupId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmRestore: confirmInput.trim(),
          createRecoveryPoint: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Restore failed');
      }
      setRestoreMessage({
        type: 'success',
        text: `System restored successfully from '${selectedBackupId}'. Pre-restore safety recovery point: '${data.recoveryPointId || 'saved'}'.`,
      });
      setRestoreModalOpen(false);
      fetchBackups();
    } catch (err: unknown) {
      setRestoreMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Restore execution error',
      });
    } finally {
      setRestoring(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Backup & Restore Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Administer coordinated backups for PostgreSQL database tables and MinIO document storage
          </p>
        </div>
        <button
          onClick={handleCreateBackup}
          disabled={creating}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg shadow-sm transition"
        >
          {creating ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
              <span>Creating Backup...</span>
            </>
          ) : (
            <>
              <span>💾</span>
              <span>Create Coordinated Backup</span>
            </>
          )}
        </button>
      </div>

      {/* Alert Notifications */}
      {restoreMessage && (
        <div
          className={`p-4 rounded-xl text-sm border ${
            restoreMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {restoreMessage.text}
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Total Backups
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{backups.length}</div>
          <div className="text-xs text-slate-400 mt-1">Coordinated database & documents</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Latest Snapshot
          </div>
          <div className="text-sm font-medium text-slate-900 mt-1 truncate">
            {backups.length > 0 ? new Date(backups[0].createdAt).toLocaleString() : 'None'}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {backups.length > 0 ? backups[0].id : 'No backups on record'}
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Total Backed Up Size
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {formatBytes(backups.reduce((acc, b) => acc + (b.totalSizeBytes || 0), 0))}
          </div>
          <div className="text-xs text-slate-400 mt-1">Stored securely in ./backups/</div>
        </div>
      </div>

      {/* Backups Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900 text-sm">Backup Archive History</h2>
          <button
            onClick={fetchBackups}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            ↻ Refresh List
          </button>
        </div>

        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider font-semibold">
            <tr>
              <th className="py-3 px-4 text-left">Backup ID / Timestamp</th>
              <th className="py-3 px-4 text-left">Database</th>
              <th className="py-3 px-4 text-left">Documents</th>
              <th className="py-3 px-4 text-left">Total Size</th>
              <th className="py-3 px-4 text-left">Integrity</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400">
                  Loading backup snapshots...
                </td>
              </tr>
            ) : backups.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400">
                  No backups found. Click &quot;Create Coordinated Backup&quot; to create your first snapshot.
                </td>
              </tr>
            ) : (
              backups.map((b) => {
                const isCurrentVerifying = verifyingId === b.id;
                const vResult = verificationResult?.id === b.id ? verificationResult : null;

                return (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <div className="font-mono text-xs font-semibold text-slate-900">{b.id}</div>
                      <div className="text-xs text-slate-400">
                        {new Date(b.createdAt).toLocaleString()}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs font-mono">
                      {formatBytes(b.databaseSizeBytes)}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <div>{b.documentsCount} objects</div>
                      <div className="text-slate-400 font-mono text-[11px]">
                        {formatBytes(b.documentsSizeBytes)}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs font-medium text-slate-900">
                      {formatBytes(b.totalSizeBytes)}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      {vResult ? (
                        vResult.isValid ? (
                          <span className="inline-flex items-center text-emerald-600 font-medium">
                            ✓ Verified Valid
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-red-600 font-medium">
                            ✗ Checksum Mismatch
                          </span>
                        )
                      ) : (
                        <button
                          onClick={() => handleVerify(b.id)}
                          disabled={isCurrentVerifying}
                          className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {isCurrentVerifying ? 'Verifying...' : 'Verify Integrity'}
                        </button>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      <button
                        onClick={() => handleDownload(b.id)}
                        className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300"
                        title="Download archive bundle"
                      >
                        Download
                      </button>
                      <button
                        onClick={() => openRestoreModal(b.id)}
                        className="px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded border border-amber-300"
                        title="Restore system state from this backup"
                      >
                        Restore
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Restore Confirmation Modal */}
      {restoreModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 space-y-4">
            <div className="flex items-center space-x-3 text-amber-600">
              <span className="text-2xl">⚠️</span>
              <h2 className="text-lg font-bold text-slate-900">Confirm System Restore</h2>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1.5">
              <p className="font-semibold">Destructive Action Warning:</p>
              <p>
                Restoring will overwrite current database records and document storage with the contents
                of backup <code className="font-bold">{selectedBackupId}</code>.
              </p>
              <p>
                An automatic <strong>pre-restore safety recovery point</strong> will be created before any
                modifications occur.
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-700">
                To confirm, type <span className="font-mono font-bold text-red-600">RESTORE_CONFIRM</span> in
                the box below:
              </label>
              <input
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder="RESTORE_CONFIRM"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
              />
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setRestoreModalOpen(false)}
                disabled={restoring}
                className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteRestore}
                disabled={confirmInput !== 'RESTORE_CONFIRM' || restoring}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white text-xs font-medium rounded-lg shadow-sm"
              >
                {restoring ? 'Restoring System...' : 'Proceed with Restore'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
