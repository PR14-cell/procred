'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface DashboardStats {
  providers: {
    total: number;
    active: number;
    inactive: number;
    requiringAttention: number;
  };
  credentials: {
    total: number;
    active: number;
    expiringSoon: number;
    expired: number;
    pendingVerification: number;
    breakdown: {
      licenses: number;
      dea: number;
      boardCertifications: number;
      malpractice: number;
      caqh: number;
    };
  };
  enrollments: {
    total: number;
    pending: number;
    needsInfo: number;
    approved: number;
    active: number;
    denied: number;
    terminated: number;
    revalidationRequired: number;
    overdueFollowups: number;
    individualCount: number;
    groupCount: number;
    agingBuckets: {
      under30: number;
      days31to60: number;
      days61to90: number;
      days91to120: number;
      over120: number;
    };
  };
  documents: {
    total: number;
    pendingReview: number;
    verified: number;
    rejected: number;
    expiringSoon: number;
    expired: number;
  };
  tasks: {
    open: number;
    overdue: number;
    dueToday: number;
    urgent: number;
    unassigned: number;
    completed: number;
  };
  filterApplied: {
    timeRange: string;
    fromDate: string | null;
    toDate: string | null;
  };
  retrievedAt: string;
}

interface ActionItem {
  id: string;
  title: string;
  subtitle: string;
  category: 'credential' | 'enrollment' | 'document' | 'task';
  urgency: 'critical' | 'high' | 'medium';
  actionDate?: string | null;
  drillDownUrl: string;
}

interface StaffWorkloadItem {
  id: string;
  name: string;
  role: string;
  openTasks: number;
  overdueTasks: number;
  urgentTasks: number;
  completedTasks: number;
}

export default function ExecutiveDashboardPage() {
  const [timeRange, setTimeRange] = useState<string>('all_time');
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [workload, setWorkload] = useState<StaffWorkloadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportType, setExportType] = useState<string>('credentials');
  const [exporting, setExporting] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'workload' | 'attention'>('overview');

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, workloadRes] = await Promise.all([
        fetch(`/api/v1/dashboard/stats?timeRange=${timeRange}`),
        fetch(`/api/v1/reports/workload`),
      ]);

      if (!statsRes.ok) throw new Error('Failed to load dashboard metrics');
      const statsData = await statsRes.json();
      setStats(statsData.stats);
      setActionItems(statsData.actionRequired || []);

      if (workloadRes.ok) {
        const workloadData = await workloadRes.json();
        setWorkload(workloadData.staffWorkload || []);
      }
    } catch (err: any) {
      setError(err.message || 'Error loading dashboard metrics');
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const handleExportCsv = async () => {
    try {
      setExporting(true);
      const res = await fetch(`/api/v1/reports/export?type=${exportType}`);
      if (!res.ok) {
        if (res.status === 403) {
          alert('You do not have permission to export reports (requires admin or specialist role)');
          return;
        }
        throw new Error('Export failed');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${exportType}-report-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message || 'Failed to export CSV');
    } finally {
      setExporting(false);
    }
  };

  const getUrgencyBadge = (u: string) => {
    switch (u) {
      case 'critical':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">🔥 Critical</span>;
      case 'high':
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">⚠️ High</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800">ℹ️ Attention</span>;
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <span>📊</span> Executive & Operational Analytics Dashboard
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Real-time PostgreSQL aggregated KPIs, workload analytics, and actionable operational attention queues.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Time Range Filter Selector */}
          <div className="flex items-center bg-white border border-slate-300 rounded-lg p-1 shadow-sm text-xs font-medium">
            <button
              onClick={() => setTimeRange('all_time')}
              className={`px-2.5 py-1 rounded-md transition ${timeRange === 'all_time' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}
            >
              All Time
            </button>
            <button
              onClick={() => setTimeRange('today')}
              className={`px-2.5 py-1 rounded-md transition ${timeRange === 'today' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Today
            </button>
            <button
              onClick={() => setTimeRange('last_7_days')}
              className={`px-2.5 py-1 rounded-md transition ${timeRange === 'last_7_days' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}
            >
              7 Days
            </button>
            <button
              onClick={() => setTimeRange('last_30_days')}
              className={`px-2.5 py-1 rounded-md transition ${timeRange === 'last_30_days' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}
            >
              30 Days
            </button>
            <button
              onClick={() => setTimeRange('last_90_days')}
              className={`px-2.5 py-1 rounded-md transition ${timeRange === 'last_90_days' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}
            >
              90 Days
            </button>
            <button
              onClick={() => setTimeRange('this_year')}
              className={`px-2.5 py-1 rounded-md transition ${timeRange === 'this_year' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}
            >
              This Year
            </button>
          </div>

          {/* Export Report Tool */}
          <div className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-lg p-1 shadow-sm">
            <select
              value={exportType}
              onChange={(e) => setExportType(e.target.value)}
              className="text-xs bg-transparent border-none focus:outline-none px-2 py-1 text-slate-700"
            >
              <option value="credentials">Credentials CSV</option>
              <option value="enrollments">Enrollments CSV</option>
              <option value="tasks">Tasks CSV</option>
              <option value="documents">Documents CSV</option>
              <option value="audit">Audit Log CSV</option>
            </select>
            <button
              onClick={handleExportCsv}
              disabled={exporting}
              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded text-xs font-semibold disabled:opacity-50 transition"
            >
              {exporting ? 'Exporting...' : '📥 Export'}
            </button>
          </div>

          <button
            onClick={() => fetchDashboardData()}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 transition shadow-sm"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-sm flex items-center justify-between">
          <div>⚠️ {error}</div>
          <button
            onClick={() => fetchDashboardData()}
            className="px-3 py-1 bg-rose-100 hover:bg-rose-200 text-rose-900 rounded font-semibold text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* Top 5 Executive Metric Cards with Direct Drill-Down */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* 1. Providers Card */}
        <Link
          href="/providers"
          className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-blue-400 hover:shadow-md transition group block"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Providers</span>
            <span className="text-lg">👤</span>
          </div>
          <div className="mt-2 text-3xl font-extrabold text-slate-900 group-hover:text-blue-600 transition">
            {loading ? '...' : stats?.providers.active ?? 0}
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span>Total: <strong>{stats?.providers.total ?? 0}</strong></span>
            {stats && stats.providers.requiringAttention > 0 && (
              <span className="text-amber-600 font-bold">⚠️ {stats.providers.requiringAttention} Attention</span>
            )}
          </div>
        </Link>

        {/* 2. Credentials Card */}
        <Link
          href="/credentials"
          className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-amber-400 hover:shadow-md transition group block"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Credentials</span>
            <span className="text-lg">🛡️</span>
          </div>
          <div className="mt-2 text-3xl font-extrabold text-amber-600 group-hover:text-amber-700 transition">
            {loading ? '...' : stats?.credentials.expiringSoon ?? 0}
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span>Expiring Soon (90d)</span>
            {stats && stats.credentials.expired > 0 && (
              <span className="text-rose-600 font-bold">🔥 {stats.credentials.expired} Expired</span>
            )}
          </div>
        </Link>

        {/* 3. Payer Enrollments Card */}
        <Link
          href="/enrollments"
          className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-indigo-400 hover:shadow-md transition group block"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-indigo-700 uppercase tracking-wider">Enrollments</span>
            <span className="text-lg">📝</span>
          </div>
          <div className="mt-2 text-3xl font-extrabold text-indigo-600 group-hover:text-indigo-700 transition">
            {loading ? '...' : stats?.enrollments.pending ?? 0}
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span>Pending Payer Review</span>
            {stats && stats.enrollments.needsInfo > 0 && (
              <span className="text-amber-600 font-bold">⚠️ {stats.enrollments.needsInfo} Missing Info</span>
            )}
          </div>
        </Link>

        {/* 4. Documents Card */}
        <Link
          href="/documents"
          className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-purple-400 hover:shadow-md transition group block"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-purple-700 uppercase tracking-wider">Documents</span>
            <span className="text-lg">📄</span>
          </div>
          <div className="mt-2 text-3xl font-extrabold text-purple-600 group-hover:text-purple-700 transition">
            {loading ? '...' : stats?.documents.pendingReview ?? 0}
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span>Pending Review</span>
            <span className="text-emerald-600 font-semibold">{stats?.documents.verified ?? 0} Verified</span>
          </div>
        </Link>

        {/* 5. Operational Tasks Card */}
        <Link
          href="/tasks"
          className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-rose-400 hover:shadow-md transition group block"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-rose-700 uppercase tracking-wider">Overdue Tasks</span>
            <span className="text-lg">✅</span>
          </div>
          <div className="mt-2 text-3xl font-extrabold text-rose-600 group-hover:text-rose-700 transition">
            {loading ? '...' : stats?.tasks.overdue ?? 0}
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span>{stats?.tasks.open ?? 0} Open Tasks</span>
            {stats && stats.tasks.dueToday > 0 && (
              <span className="text-amber-600 font-bold">{stats.tasks.dueToday} Due Today</span>
            )}
          </div>
        </Link>
      </div>

      {/* Tab Navigation for Visualizations & Analytics */}
      <div className="flex items-center space-x-6 border-b border-slate-200 text-sm">
        <button
          onClick={() => setActiveTab('overview')}
          className={`pb-3 font-semibold transition ${
            activeTab === 'overview'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          Visual Analytics & Aging
        </button>
        <button
          onClick={() => setActiveTab('attention')}
          className={`pb-3 font-semibold transition flex items-center gap-1.5 ${
            activeTab === 'attention'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>Action Required Items</span>
          <span className="px-1.5 py-0.2 rounded-full text-[11px] bg-rose-100 text-rose-800 font-bold">
            {actionItems.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('workload')}
          className={`pb-3 font-semibold transition ${
            activeTab === 'workload'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          Staff Workload Distribution
        </button>
      </div>

      {/* TAB 1: Visual Analytics & Aging Meters */}
      {activeTab === 'overview' && stats && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Enrollment Aging Distribution */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Payer Enrollment Aging Analysis</h3>
                <p className="text-xs text-slate-500">Elapsed calendar days for pending payer applications</p>
              </div>
              <Link href="/enrollments" className="text-xs font-semibold text-blue-600 hover:underline">
                View Queue →
              </Link>
            </div>

            <div className="space-y-3 pt-2">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 font-medium">0 – 30 Days (On Track)</span>
                  <span className="font-bold text-slate-800">{stats.enrollments.agingBuckets.under30} applications</span>
                </div>
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, (stats.enrollments.agingBuckets.under30 / Math.max(1, stats.enrollments.pending)) * 100)}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 font-medium">31 – 60 Days (Standard Review)</span>
                  <span className="font-bold text-slate-800">{stats.enrollments.agingBuckets.days31to60} applications</span>
                </div>
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                  <div
                    className="bg-blue-500 h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, (stats.enrollments.agingBuckets.days31to60 / Math.max(1, stats.enrollments.pending)) * 100)}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 font-medium">61 – 90 Days (Follow-up Escalation)</span>
                  <span className="font-bold text-slate-800">{stats.enrollments.agingBuckets.days61to90} applications</span>
                </div>
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                  <div
                    className="bg-yellow-500 h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, (stats.enrollments.agingBuckets.days61to90 / Math.max(1, stats.enrollments.pending)) * 100)}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 font-medium">91 – 120 Days (Significant Delay)</span>
                  <span className="font-bold text-slate-800">{stats.enrollments.agingBuckets.days91to120} applications</span>
                </div>
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                  <div
                    className="bg-amber-500 h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, (stats.enrollments.agingBuckets.days91to120 / Math.max(1, stats.enrollments.pending)) * 100)}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 font-medium">120+ Days (Critical Stalled)</span>
                  <span className="font-bold text-rose-700">{stats.enrollments.agingBuckets.over120} applications</span>
                </div>
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                  <div
                    className="bg-rose-500 h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, (stats.enrollments.agingBuckets.over120 / Math.max(1, stats.enrollments.pending)) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Credential Status & Breakdown Distribution */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Credential Types & Expirations</h3>
                <p className="text-xs text-slate-500">Distribution across active licenses, DEAs, and policies</p>
              </div>
              <Link href="/credentials" className="text-xs font-semibold text-blue-600 hover:underline">
                View Credentials →
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <div className="text-xs text-slate-500">State Medical Licenses</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{stats.credentials.breakdown.licenses}</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <div className="text-xs text-slate-500">DEA Registrations</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{stats.credentials.breakdown.dea}</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <div className="text-xs text-slate-500">Board Certifications</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{stats.credentials.breakdown.boardCertifications}</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <div className="text-xs text-slate-500">Malpractice Policies</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{stats.credentials.breakdown.malpractice}</div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100">
              <div className="text-xs font-semibold text-slate-700 mb-2">Credential Health Summary</div>
              <div className="flex items-center gap-2 text-xs">
                <span className="px-2 py-1 bg-emerald-50 text-emerald-800 rounded font-medium border border-emerald-200">
                  ✓ {stats.credentials.active} Active
                </span>
                <span className="px-2 py-1 bg-amber-50 text-amber-800 rounded font-medium border border-amber-200">
                  ⚠️ {stats.credentials.expiringSoon} Expiring (90d)
                </span>
                <span className="px-2 py-1 bg-rose-50 text-rose-800 rounded font-medium border border-rose-200">
                  🔥 {stats.credentials.expired} Expired
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Operational Action Required Queue */}
      {activeTab === 'attention' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Operational Attention Items</h3>
              <p className="text-xs text-slate-500">Prioritized records requiring credentialing specialist intervention</p>
            </div>
            <span className="text-xs text-slate-500 font-mono">
              {actionItems.length} active items
            </span>
          </div>

          {actionItems.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <div className="text-3xl mb-2">🎉</div>
              <div className="font-semibold text-slate-700">All clear! No urgent items requiring attention.</div>
              <p className="text-xs text-slate-400 mt-1">Credentials, enrollments, and tasks are currently up to date.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {actionItems.map((item) => (
                <div
                  key={item.id}
                  className="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 hover:bg-slate-50/70 transition"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {getUrgencyBadge(item.urgency)}
                      <span className="font-semibold text-sm text-slate-900">{item.title}</span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {item.subtitle}
                      {item.actionDate && (
                        <span className="ml-2 font-mono text-slate-400">Target Date: {item.actionDate}</span>
                      )}
                    </div>
                  </div>

                  <Link
                    href={item.drillDownUrl}
                    className="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-lg text-xs font-semibold whitespace-nowrap self-start md:self-auto transition"
                  >
                    Open Record →
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Staff Workload Distribution */}
      {activeTab === 'workload' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Staff Workload Distribution</h3>
              <p className="text-xs text-slate-500">Task distribution and completion rates per active credentialing team member</p>
            </div>
            <Link href="/tasks" className="text-xs font-semibold text-blue-600 hover:underline">
              Task Work Queue →
            </Link>
          </div>

          {workload.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              Staff workload metrics are restricted to administrators and specialists, or no active tasks are currently assigned.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 border-b border-slate-200 uppercase font-semibold text-slate-500 text-[11px]">
                  <tr>
                    <th className="py-3 px-4">Staff Member</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Open Tasks</th>
                    <th className="py-3 px-4">Overdue</th>
                    <th className="py-3 px-4">Urgent / High</th>
                    <th className="py-3 px-4">Completed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {workload.map((staff) => (
                    <tr key={staff.id} className="hover:bg-slate-50/60 transition">
                      <td className="py-3 px-4 font-semibold text-slate-900">{staff.name}</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[11px]">
                          {staff.role.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-bold text-slate-800">{staff.openTasks}</span>
                      </td>
                      <td className="py-3 px-4">
                        {staff.overdueTasks > 0 ? (
                          <span className="text-rose-700 font-bold bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">
                            {staff.overdueTasks} Overdue
                          </span>
                        ) : (
                          <span className="text-slate-400">0</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {staff.urgentTasks > 0 ? (
                          <span className="text-amber-700 font-bold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                            {staff.urgentTasks} Urgent
                          </span>
                        ) : (
                          <span className="text-slate-400">0</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-semibold text-emerald-700">
                        {staff.completedTasks}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
