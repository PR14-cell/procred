'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface UnifiedCredential {
  id: string;
  providerId: string;
  providerName: string;
  providerNpi: string | null;
  credentialType: string;
  identifier: string;
  title: string;
  state: string | null;
  issueDate: string | null;
  expirationDate: string | null;
  status: string;
  computedStatus: string;
  daysUntilExpiration: number | null;
  alertWindow: string | null;
  verified: boolean;
  verifiedAt: string | null;
  verifiedByName: string | null;
}

interface SummaryCounts {
  totalCount: number;
  expiredCount: number;
  within14DaysCount: number;
  within30DaysCount: number;
  within60DaysCount: number;
  within90DaysCount: number;
  pendingVerificationCount: number;
}

export default function CredentialWorkQueuePage() {
  const [credentials, setCredentials] = useState<UnifiedCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  // Filters & Pagination
  const [search, setSearch] = useState('');
  const [credentialType, setCredentialType] = useState('all');
  const [expirationWindow, setExpirationWindow] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [summaryCounts, setSummaryCounts] = useState<SummaryCounts>({
    totalCount: 0,
    expiredCount: 0,
    within14DaysCount: 0,
    within30DaysCount: 0,
    within60DaysCount: 0,
    within90DaysCount: 0,
    pendingVerificationCount: 0,
  });

  // Action Modals
  const [verifyingCred, setVerifyingCred] = useState<UnifiedCredential | null>(null);
  const [verifMethod, setVerifMethod] = useState('primary_source');
  const [verifSource, setVerifSource] = useState('State Licensing Board Website');
  const [verifStatus, setVerifStatus] = useState('verified');
  const [verifNotes, setVerifNotes] = useState('');
  const [verifSubmitting, setVerifSubmitting] = useState(false);

  const [taskCred, setTaskCred] = useState<UnifiedCredential | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskPriority, setTaskPriority] = useState('high');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [taskSubmitting, setTaskSubmitting] = useState(false);

  const fetchCredentials = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '15',
        sortBy: 'expirationDate',
        sortOrder: 'asc',
      });
      if (search) params.append('search', search);
      if (credentialType !== 'all') params.append('credentialType', credentialType);
      if (expirationWindow !== 'all') params.append('expirationWindow', expirationWindow);

      const res = await fetch(`/api/v1/credentials?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load credentials');
      const data = await res.json();
      setCredentials(data.items || []);
      setTotalPages(data.pagination?.totalPages || 1);
      if (data.summaryCounts) {
        setSummaryCounts(data.summaryCounts);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading credentials');
    } finally {
      setLoading(false);
    }
  }, [search, credentialType, expirationWindow, page]);

  useEffect(() => {
    fetchCredentials();
  }, [fetchCredentials]);

  const handleRunScan = async () => {
    try {
      setScanning(true);
      setScanMessage(null);
      const res = await fetch('/api/v1/credentials/scan-expirations', { method: 'POST' });
      if (!res.ok) throw new Error('Expiration scan failed');
      const data = await res.json();
      setScanMessage(`Scan finished: ${data.expiringFound} approaching expiration, ${data.tasksCreated} renewal tasks created.`);
      fetchCredentials();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const handleOpenVerifyModal = (cred: UnifiedCredential) => {
    setVerifyingCred(cred);
    setVerifMethod(cred.credentialType === 'state_license' ? 'state_board_website' : 'primary_source');
    setVerifSource(cred.state ? `${cred.state} Department of Health / Board Website` : 'Official Primary Source');
    setVerifStatus('verified');
    setVerifNotes('');
  };

  const handleSubmitVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyingCred) return;
    try {
      setVerifSubmitting(true);
      const res = await fetch(`/api/v1/credentials/${verifyingCred.credentialType}/${verifyingCred.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: verifyingCred.providerId,
          method: verifMethod,
          source: verifSource,
          status: verifStatus,
          notes: verifNotes,
        }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Verification logging failed');
      }
      setVerifyingCred(null);
      fetchCredentials();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setVerifSubmitting(false);
    }
  };

  const handleOpenTaskModal = (cred: UnifiedCredential) => {
    setTaskCred(cred);
    setTaskTitle(`Renew ${cred.title} for ${cred.providerName}`);
    setTaskPriority(cred.alertWindow === 'expired' || cred.alertWindow === '14_days' ? 'urgent' : 'high');
    setTaskDueDate(cred.expirationDate ? cred.expirationDate.slice(0, 10) : new Date().toISOString().slice(0, 10));
  };

  const handleSubmitTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskCred) return;
    try {
      setTaskSubmitting(true);
      const res = await fetch('/api/v1/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: taskTitle,
          description: `Work item for ${taskCred.title} (#${taskCred.identifier}) expiring on ${taskCred.expirationDate ? new Date(taskCred.expirationDate).toLocaleDateString() : 'N/A'}.`,
          entityType: taskCred.credentialType,
          entityId: taskCred.id,
          priority: taskPriority,
          dueDate: taskDueDate || undefined,
        }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Task creation failed');
      }
      setTaskCred(null);
      alert('Task created successfully!');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Task creation failed');
    } finally {
      setTaskSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header and Scan Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Credential & Expiration Work Queue</h1>
          <p className="text-sm text-slate-500">
            Monitor provider state licenses, DEA, board certifications, malpractice, and CAQH attestations across standard 90/60/30/14-day alert windows.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleRunScan}
            disabled={scanning}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm transition flex items-center space-x-1.5"
          >
            <span>{scanning ? '⏳ Scanning...' : '⚡ Run Expiration Scan'}</span>
          </button>
        </div>
      </div>

      {scanMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center justify-between">
          <span>{scanMessage}</span>
          <button onClick={() => setScanMessage(null)} className="text-emerald-600 hover:text-emerald-900">✕</button>
        </div>
      )}

      {/* Expiration Window KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <button
          onClick={() => { setExpirationWindow('expired'); setPage(1); }}
          className={`p-3 rounded-xl border text-left transition ${
            expirationWindow === 'expired'
              ? 'bg-rose-50 border-rose-400 ring-2 ring-rose-300'
              : 'bg-white border-slate-200 hover:border-rose-300'
          }`}
        >
          <div className="text-[10px] uppercase font-bold text-rose-600">Expired</div>
          <div className="text-xl font-bold text-rose-900 mt-1">{summaryCounts.expiredCount}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Lapsed credentials</div>
        </button>

        <button
          onClick={() => { setExpirationWindow('14_days'); setPage(1); }}
          className={`p-3 rounded-xl border text-left transition ${
            expirationWindow === '14_days'
              ? 'bg-red-50 border-red-400 ring-2 ring-red-300'
              : 'bg-white border-slate-200 hover:border-red-300'
          }`}
        >
          <div className="text-[10px] uppercase font-bold text-red-600">≤ 14 Days</div>
          <div className="text-xl font-bold text-red-900 mt-1">{summaryCounts.within14DaysCount}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Critical renewal</div>
        </button>

        <button
          onClick={() => { setExpirationWindow('30_days'); setPage(1); }}
          className={`p-3 rounded-xl border text-left transition ${
            expirationWindow === '30_days'
              ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-300'
              : 'bg-white border-slate-200 hover:border-amber-300'
          }`}
        >
          <div className="text-[10px] uppercase font-bold text-amber-600">≤ 30 Days</div>
          <div className="text-xl font-bold text-amber-900 mt-1">{summaryCounts.within30DaysCount}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">High priority</div>
        </button>

        <button
          onClick={() => { setExpirationWindow('60_days'); setPage(1); }}
          className={`p-3 rounded-xl border text-left transition ${
            expirationWindow === '60_days'
              ? 'bg-yellow-50 border-yellow-400 ring-2 ring-yellow-300'
              : 'bg-white border-slate-200 hover:border-yellow-300'
          }`}
        >
          <div className="text-[10px] uppercase font-bold text-amber-700">≤ 60 Days</div>
          <div className="text-xl font-bold text-slate-800 mt-1">{summaryCounts.within60DaysCount}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Renewal in-process</div>
        </button>

        <button
          onClick={() => { setExpirationWindow('90_days'); setPage(1); }}
          className={`p-3 rounded-xl border text-left transition ${
            expirationWindow === '90_days'
              ? 'bg-blue-50 border-blue-400 ring-2 ring-blue-300'
              : 'bg-white border-slate-200 hover:border-blue-300'
          }`}
        >
          <div className="text-[10px] uppercase font-bold text-blue-600">≤ 90 Days</div>
          <div className="text-xl font-bold text-blue-900 mt-1">{summaryCounts.within90DaysCount}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Standard window</div>
        </button>

        <button
          onClick={() => { setExpirationWindow('pending_verification'); setPage(1); }}
          className={`p-3 rounded-xl border text-left transition ${
            expirationWindow === 'pending_verification'
              ? 'bg-purple-50 border-purple-400 ring-2 ring-purple-300'
              : 'bg-white border-slate-200 hover:border-purple-300'
          }`}
        >
          <div className="text-[10px] uppercase font-bold text-purple-600">Unverified</div>
          <div className="text-xl font-bold text-purple-900 mt-1">{summaryCounts.pendingVerificationCount}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">PSV pending</div>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-3">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search provider name, NPI, license #, DEA, policy #..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full px-3.5 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            value={credentialType}
            onChange={(e) => { setCredentialType(e.target.value); setPage(1); }}
            className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-700"
          >
            <option value="all">All Credential Types</option>
            <option value="state_license">State Licenses</option>
            <option value="dea_registration">DEA Registrations</option>
            <option value="board_certification">Board Certifications</option>
            <option value="malpractice_insurance">Malpractice Insurance</option>
            <option value="caqh_profile">CAQH Profiles</option>
          </select>

          <select
            value={expirationWindow}
            onChange={(e) => { setExpirationWindow(e.target.value); setPage(1); }}
            className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-700"
          >
            <option value="all">All Expiration Windows</option>
            <option value="expired">Expired</option>
            <option value="14_days">Expiring ≤ 14 Days</option>
            <option value="30_days">Expiring ≤ 30 Days</option>
            <option value="60_days">Expiring ≤ 60 Days</option>
            <option value="90_days">Expiring ≤ 90 Days</option>
            <option value="pending_verification">Pending PSV</option>
          </select>

          {(search || credentialType !== 'all' || expirationWindow !== 'all') && (
            <button
              onClick={() => { setSearch(''); setCredentialType('all'); setExpirationWindow('all'); setPage(1); }}
              className="px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 bg-slate-100 rounded-lg"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Main Credentials Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-xs space-y-2">
            <div className="inline-block animate-spin w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full" />
            <div>Loading credential queue from database...</div>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-rose-500 text-xs">
            {error}
          </div>
        ) : credentials.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs">
            No credentials found matching the selected filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-4">Provider</th>
                  <th className="py-3 px-4">Credential & Type</th>
                  <th className="py-3 px-4">State</th>
                  <th className="py-3 px-4">Expiration Date</th>
                  <th className="py-3 px-4">Status & PSV</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {credentials.map((cred) => {
                  let alertBadge = null;
                  if (cred.alertWindow === 'expired') {
                    alertBadge = (
                      <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-rose-100 text-rose-800 border border-rose-200">
                        EXPIRED ({Math.abs(cred.daysUntilExpiration ?? 0)}d ago)
                      </span>
                    );
                  } else if (cred.alertWindow === '14_days') {
                    alertBadge = (
                      <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-red-100 text-red-800 border border-red-200 animate-pulse">
                        {cred.daysUntilExpiration}d remaining
                      </span>
                    );
                  } else if (cred.alertWindow === '30_days') {
                    alertBadge = (
                      <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-amber-100 text-amber-800 border border-amber-200">
                        {cred.daysUntilExpiration}d remaining
                      </span>
                    );
                  } else if (cred.alertWindow === '60_days' || cred.alertWindow === '90_days') {
                    alertBadge = (
                      <span className="px-2 py-0.5 rounded font-semibold text-[10px] bg-yellow-100 text-yellow-800 border border-yellow-200">
                        {cred.daysUntilExpiration}d remaining
                      </span>
                    );
                  } else {
                    alertBadge = (
                      <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Active ({cred.daysUntilExpiration ? `${cred.daysUntilExpiration}d` : 'No Expiry'})
                      </span>
                    );
                  }

                  return (
                    <tr key={`${cred.credentialType}-${cred.id}`} className="hover:bg-slate-50/60 transition">
                      <td className="py-3 px-4">
                        <Link
                          href={`/providers/${cred.providerId}`}
                          className="font-bold text-blue-600 hover:underline block"
                        >
                          {cred.providerName}
                        </Link>
                        <span className="text-[11px] font-mono text-slate-400">
                          NPI: {cred.providerNpi || 'N/A'}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{cred.title}</div>
                        <div className="text-[11px] font-mono text-slate-500">
                          #{cred.identifier}
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <span className="font-semibold text-slate-700 font-mono">
                          {cred.state || 'National'}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        <div className="font-mono font-medium text-slate-800">
                          {cred.expirationDate
                            ? new Date(cred.expirationDate).toLocaleDateString()
                            : 'Lifetime / None'}
                        </div>
                        <div className="mt-0.5">{alertBadge}</div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex flex-col space-y-1 items-start">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                              cred.computedStatus === 'active'
                                ? 'bg-emerald-100 text-emerald-800'
                                : cred.computedStatus === 'expired'
                                ? 'bg-rose-100 text-rose-800'
                                : cred.computedStatus === 'expiring_soon'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {cred.computedStatus.replace('_', ' ')}
                          </span>

                          {cred.verified ? (
                            <span className="text-[10px] text-emerald-700 font-medium flex items-center space-x-1">
                              <span>✓ PSV Verified</span>
                            </span>
                          ) : (
                            <span className="text-[10px] text-amber-600 font-medium">
                              ⚠ PSV Pending
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-right space-x-2">
                        <button
                          onClick={() => handleOpenVerifyModal(cred)}
                          className="px-2 py-1 bg-white border border-slate-300 hover:border-blue-500 hover:text-blue-600 rounded text-[11px] font-medium transition"
                        >
                          Verify
                        </button>
                        <button
                          onClick={() => handleOpenTaskModal(cred)}
                          className="px-2 py-1 bg-white border border-slate-300 hover:border-indigo-500 hover:text-indigo-600 rounded text-[11px] font-medium transition"
                        >
                          + Task
                        </button>
                        <Link
                          href={`/providers/${cred.providerId}`}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-medium transition"
                        >
                          Profile →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        <div className="p-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <div>
            Page {page} of {totalPages} ({summaryCounts.totalCount} total credentials)
          </div>
          <div className="flex space-x-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 bg-white border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 bg-white border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Verify Credential Modal */}
      {verifyingCred && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-1">
              Primary Source Verification (PSV)
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Recording PSV for {verifyingCred.title} (#{verifyingCred.identifier})
            </p>

            <form onSubmit={handleSubmitVerification} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Verification Method *
                </label>
                <select
                  value={verifMethod}
                  onChange={(e) => setVerifMethod(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="state_board_website">State Board Online Registry</option>
                  <option value="primary_source">Primary Source Direct Attestation</option>
                  <option value="nppes">NPPES Public Registry</option>
                  <option value="abms">ABMS Certification Database</option>
                  <option value="caqh_proview">CAQH ProView Portal</option>
                  <option value="phone">Direct Phone Verification</option>
                  <option value="manual">Document Inspection</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Verification Source / URL *
                </label>
                <input
                  type="text"
                  required
                  value={verifSource}
                  onChange={(e) => setVerifSource(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  placeholder="e.g. https://www.bpc.ca.gov/verify"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Verification Outcome *
                </label>
                <select
                  value={verifStatus}
                  onChange={(e) => setVerifStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="verified">Verified (No discrepancies)</option>
                  <option value="discrepancy">Discrepancy Noted</option>
                  <option value="unable_to_verify">Unable to Verify</option>
                  <option value="pending">Pending Follow-up</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Verification Notes
                </label>
                <textarea
                  rows={2}
                  value={verifNotes}
                  onChange={(e) => setVerifNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  placeholder="Logged details, confirmation numbers, or notes..."
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setVerifyingCred(null)}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={verifSubmitting}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg"
                >
                  {verifSubmitting ? 'Saving...' : 'Save Verification'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Task Modal */}
      {taskCred && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-1">
              Create Credential Work Task
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Add actionable task for {taskCred.providerName}
            </p>

            <form onSubmit={handleSubmitTask} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Task Title *
                </label>
                <input
                  type="text"
                  required
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Priority *
                  </label>
                  <select
                    value={taskPriority}
                    onChange={(e) => setTaskPriority(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="urgent">Urgent</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={taskDueDate}
                    onChange={(e) => setTaskDueDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTaskCred(null)}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={taskSubmitting}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-lg"
                >
                  {taskSubmitting ? 'Creating...' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
