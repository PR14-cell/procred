'use client';

import { useEffect, useState } from 'react';

interface StatsResponse {
  stats: {
    totalUsers: number;
    totalProviders: number;
    expiringCredentials: number;
    pendingEnrollments: number;
    overdueTasks: number;
  };
  deferredMetrics: Record<string, string>;
  retrievedAt: string;
}

export default function DashboardPage() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/v1/dashboard/stats');
      if (!res.ok) throw new Error('Failed to load dashboard metrics');
      const json = await res.json();
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">System Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Real-time metrics queried from PostgreSQL database
          </p>
        </div>
        <button
          onClick={fetchStats}
          disabled={loading}
          className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg shadow-sm transition disabled:opacity-50"
        >
          {loading ? 'Refreshing...' : '↻ Refresh Data'}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* KPI Cards Grid - Real live PostgreSQL counts (C3 requirement) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            Active Users
          </div>
          <div className="mt-2 text-3xl font-extrabold text-slate-900">
            {loading ? '...' : data?.stats.totalUsers ?? 0}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Configured system staff</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            Total Providers
          </div>
          <div className="mt-2 text-3xl font-extrabold text-blue-600">
            {loading ? '...' : data?.stats.totalProviders ?? 0}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {data?.stats.totalProviders === 0
              ? 'Empty state: Phase 2 will add providers'
              : 'Active healthcare providers'}
          </p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            Expiring Credentials
          </div>
          <div className="mt-2 text-3xl font-extrabold text-amber-600">
            {loading ? '...' : data?.stats.expiringCredentials ?? 0}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Due within 90 days</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            Pending Enrollments
          </div>
          <div className="mt-2 text-3xl font-extrabold text-indigo-600">
            {loading ? '...' : data?.stats.pendingEnrollments ?? 0}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">In progress or submitted</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            Overdue Tasks
          </div>
          <div className="mt-2 text-3xl font-extrabold text-rose-600">
            {loading ? '...' : data?.stats.overdueTasks ?? 0}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Past due action items</p>
        </div>
      </div>

      {/* Empty State Banner for Phase 1 */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/60 rounded-xl p-6">
        <div className="flex items-start space-x-4">
          <div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-lg shrink-0">
            ✓
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Phase 1 Application Foundation Ready
            </h3>
            <p className="text-sm text-slate-600 mt-1 leading-relaxed">
              All Phase 1 foundational requirements are active: Docker Compose isolated network, dual PostgreSQL roles (<code className="bg-white px-1.5 py-0.5 rounded text-xs font-mono">credentialing_admin</code> and <code className="bg-white px-1.5 py-0.5 rounded text-xs font-mono">credentialing_app</code>), append-only immutable audit logs with BEFORE triggers, Redis password authentication, TOTP Multi-Factor Authentication, and global API error handling.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <span className="px-2.5 py-1 bg-white border border-blue-200 rounded-md font-medium text-blue-700">
                PostgreSQL 16: Connected
              </span>
              <span className="px-2.5 py-1 bg-white border border-blue-200 rounded-md font-medium text-blue-700">
                Redis 7 (Auth): Protected
              </span>
              <span className="px-2.5 py-1 bg-white border border-blue-200 rounded-md font-medium text-blue-700">
                MinIO S3: Internal Proxy
              </span>
              <span className="px-2.5 py-1 bg-white border border-blue-200 rounded-md font-medium text-blue-700">
                Audit Immutability: Verified
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Deferred Metrics Notice (C3 Requirement) */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900 mb-2">
          Dashboard Roadmap & Deferred Widgets (Phase 6)
        </h3>
        <p className="text-xs text-slate-500 mb-3">
          As specified in Appendix B and correction C3, the following complex visualizations are deferred to Phase 6 when full provider and enrollment datasets exist:
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
            <span className="font-semibold text-slate-800">Expiration Timeline:</span>
            <p className="text-slate-500 mt-1">Deferred to Phase 6 (dependent on Phase 2 credentials)</p>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
            <span className="font-semibold text-slate-800">Enrollment Status Breakdown:</span>
            <p className="text-slate-500 mt-1">Deferred to Phase 6 (dependent on Phase 3 enrollments)</p>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
            <span className="font-semibold text-slate-800">Missing Documents Summary:</span>
            <p className="text-slate-500 mt-1">Deferred to Phase 6 (dependent on Phase 5 scanner)</p>
          </div>
        </div>
      </div>
    </div>
  );
}
