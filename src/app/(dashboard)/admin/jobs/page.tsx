'use client';

import React, { useState, useEffect } from 'react';

interface QueueMetric {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  isPaused: boolean;
}

interface FailedJob {
  id: string;
  name: string;
  failedReason: string;
  attemptsMade: number;
  timestamp: number;
}

export default function AdminJobsPage() {
  const [queues, setQueues] = useState<QueueMetric[]>([]);
  const [failedJobs, setFailedJobs] = useState<Record<string, FailedJob[]>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  const fetchQueueData = async () => {
    try {
      const res = await fetch('/api/v1/admin/jobs');
      if (res.ok) {
        const data = await res.json();
        setQueues(data.queues || []);
        setFailedJobs(data.failedJobs || {});
      } else if (res.status === 403) {
        setStatusMessage({
          text: 'Access Denied: Administrator privileges (admin or super_admin) are required to monitor or trigger background jobs.',
          isError: true,
        });
      }
    } catch {
      // Ignore background fetch
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueueData();
    const interval = setInterval(fetchQueueData, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleTriggerJob = async (jobType: string, label: string) => {
    setActionLoading(jobType);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/v1/admin/jobs/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobType }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatusMessage({ text: `Successfully triggered ${label}. Result: ${JSON.stringify(data.result)}` });
        fetchQueueData();
      } else {
        setStatusMessage({ text: data.message || `Failed to trigger ${label}`, isError: true });
      }
    } catch (err: any) {
      setStatusMessage({ text: err.message || 'Error triggering job', isError: true });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRetryQueue = async (queueName: string) => {
    setActionLoading(`retry-${queueName}`);
    try {
      const res = await fetch('/api/v1/admin/jobs/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueName }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatusMessage({ text: `Retried ${data.retriedCount} failed jobs in queue "${queueName}".` });
        fetchQueueData();
      }
    } catch (err: any) {
      setStatusMessage({ text: err.message || 'Error retrying jobs', isError: true });
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Background Automation & Jobs</h1>
          <p className="text-sm text-slate-500 mt-1">
            Monitor BullMQ queues, scheduled scanner health, retry failed executions, and trigger on-demand jobs.
          </p>
        </div>
        <button
          onClick={fetchQueueData}
          disabled={loading}
          className="px-4 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-sm font-medium rounded-lg shadow-sm transition flex items-center space-x-2"
        >
          <span>🔄</span>
          <span>Refresh Queues</span>
        </button>
      </div>

      {statusMessage && (
        <div
          className={`p-4 rounded-xl border text-sm ${
            statusMessage.isError
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      {/* Manual Scanner Triggers */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-1">On-Demand Scanner Execution</h2>
        <p className="text-xs text-slate-500 mb-4">
          Manually trigger scheduled scanners. Execution is idempotent and will not create duplicate tasks or duplicate daily alerts.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <button
            onClick={() => handleTriggerJob('credential_expirations', 'Credential Expiration Scan')}
            disabled={actionLoading !== null}
            className="p-3.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-left transition disabled:opacity-50"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-900">Credential Expiration Scan</span>
              <span className="text-lg">🛡️</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">Scans licenses, DEA, boards, malpractice (90/60/30/14d)</p>
          </button>

          <button
            onClick={() => handleTriggerJob('caqh_attestation', 'CAQH Attestation Scan')}
            disabled={actionLoading !== null}
            className="p-3.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-left transition disabled:opacity-50"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-900">CAQH Attestation Scan</span>
              <span className="text-lg">📋</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">Checks 120-day re-attestation compliance deadlines</p>
          </button>

          <button
            onClick={() => handleTriggerJob('enrollment_revalidation', 'Enrollment Revalidation Scan')}
            disabled={actionLoading !== null}
            className="p-3.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-left transition disabled:opacity-50"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-900">Revalidation & Follow-Up</span>
              <span className="text-lg">📝</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">Scans 90/60/30d revalidations and overdue follow-up dates</p>
          </button>

          <button
            onClick={() => handleTriggerJob('overdue_tasks', 'Overdue Task Scan')}
            disabled={actionLoading !== null}
            className="p-3.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-left transition disabled:opacity-50"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-900">Overdue Task Scan</span>
              <span className="text-lg">✅</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">Identifies overdue tasks and dispatches daily assignee alerts</p>
          </button>

          <button
            onClick={() => handleTriggerJob('missing_documents', 'Missing Documents Scan')}
            disabled={actionLoading !== null}
            className="p-3.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-left transition disabled:opacity-50"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-900">Missing Documents Scan</span>
              <span className="text-lg">📄</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">Flags active providers/enrollments missing compliance docs</p>
          </button>

          <button
            onClick={() => handleTriggerJob('daily_digest', 'Daily Digest Dispatch')}
            disabled={actionLoading !== null}
            className="p-3.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-left transition disabled:opacity-50"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-900">Send Daily Digest</span>
              <span className="text-lg">📬</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">Aggregates and delivers morning operational digest emails</p>
          </button>
        </div>
      </div>

      {/* BullMQ Queue Status Cards */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-slate-900">BullMQ Queue Telemetry</h2>

        {loading ? (
          <div className="p-8 bg-white border border-slate-200 rounded-xl text-center text-slate-500">
            Loading queue metrics...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {queues.map((q) => (
              <div key={q.name} className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    <h3 className="font-semibold text-sm text-slate-900 truncate">{q.name}</h3>
                  </div>
                  {q.failed > 0 && (
                    <button
                      onClick={() => handleRetryQueue(q.name)}
                      disabled={actionLoading !== null}
                      className="px-2.5 py-1 text-xs bg-red-50 hover:bg-red-100 text-red-700 font-medium rounded border border-red-200 transition"
                    >
                      Retry ({q.failed})
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-2 pt-2 text-center">
                  <div className="bg-slate-50 p-2 rounded-lg">
                    <span className="text-xs text-slate-400 block font-medium">Wait</span>
                    <span className="text-sm font-bold text-slate-800">{q.waiting}</span>
                  </div>
                  <div className="bg-blue-50 p-2 rounded-lg">
                    <span className="text-xs text-blue-500 block font-medium">Active</span>
                    <span className="text-sm font-bold text-blue-700">{q.active}</span>
                  </div>
                  <div className="bg-emerald-50 p-2 rounded-lg">
                    <span className="text-xs text-emerald-500 block font-medium">Done</span>
                    <span className="text-sm font-bold text-emerald-700">{q.completed}</span>
                  </div>
                  <div className={`p-2 rounded-lg ${q.failed > 0 ? 'bg-red-50' : 'bg-slate-50'}`}>
                    <span className={`text-xs block font-medium ${q.failed > 0 ? 'text-red-500' : 'text-slate-400'}`}>
                      Fail
                    </span>
                    <span className={`text-sm font-bold ${q.failed > 0 ? 'text-red-700' : 'text-slate-800'}`}>
                      {q.failed}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Failure Visibility Log Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Recent Job Failures & Errors</h2>
            <p className="text-xs text-slate-500">Displays diagnostic information for any failed BullMQ queue jobs.</p>
          </div>
        </div>

        {Object.values(failedJobs).every((jobs) => jobs.length === 0) ? (
          <div className="p-8 text-center text-sm text-slate-500">
            <span className="text-2xl block mb-1">✅</span>
            <span>No failed jobs recorded across any queues. All workers healthy.</span>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase">
                <tr>
                  <th className="p-3">Queue / Job</th>
                  <th className="p-3">Reason</th>
                  <th className="p-3">Attempts</th>
                  <th className="p-3">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Object.entries(failedJobs).flatMap(([qName, jobs]) =>
                  jobs.map((job) => (
                    <tr key={job.id} className="hover:bg-slate-50">
                      <td className="p-3 font-semibold text-slate-800">
                        {qName} / {job.name}
                      </td>
                      <td className="p-3 text-red-600 font-mono max-w-md truncate">{job.failedReason || 'Unknown error'}</td>
                      <td className="p-3 text-slate-600">{job.attemptsMade}</td>
                      <td className="p-3 text-slate-400">{new Date(job.timestamp).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
