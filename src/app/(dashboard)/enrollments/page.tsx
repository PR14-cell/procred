'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface MissingItem {
  id: string;
  category: string;
  description: string;
  isResolved: boolean;
  notes?: string | null;
  resolvedAt?: string | null;
}

interface EnrollmentItem {
  id: string;
  providerId: string;
  payerId: string;
  locationId: string | null;
  enrollmentType: 'individual' | 'group';
  applicationType: string;
  status: string;
  providerPayerId: string | null;
  groupNumber: string | null;
  groupNpi: string | null;
  submittedDate: string | null;
  effectiveDate: string | null;
  terminationDate: string | null;
  followUpDate: string | null;
  lastFollowUpDate: string | null;
  revalidationDate: string | null;
  trackingNumber: string | null;
  notes: string | null;
  missingItems: MissingItem[];
  agingDays: number | null;
  openMissingCount: number;
  followUpInfo: {
    isOverdue: boolean;
    isUpcoming: boolean;
    daysDiff: number | null;
  };
  provider: {
    id: string;
    firstName: string;
    lastName: string;
    npiNumber: string | null;
  };
  payer: {
    id: string;
    name: string;
    shortName: string | null;
    payerType: string | null;
    state: string | null;
  };
  location: {
    id: string;
    name: string;
    city: string;
    state: string;
  } | null;
  assignedTo: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
}

interface SummaryCounts {
  totalCount: number;
  pendingCount: number;
  needsInfoCount: number;
  approvedCount: number;
  activeCount: number;
  deniedCount: number;
  terminatedCount: number;
  revalidationRequiredCount: number;
  overdueFollowUpsCount: number;
  upcomingFollowUpsCount: number;
}

export default function EnrollmentWorkQueuePage() {
  const [enrollments, setEnrollments] = useState<EnrollmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState<'individual' | 'group' | 'all'>('all');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [revalidationOnly, setRevalidationOnly] = useState(false);
  const [agingFilter, setAgingFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [summaryCounts, setSummaryCounts] = useState<SummaryCounts>({
    totalCount: 0,
    pendingCount: 0,
    needsInfoCount: 0,
    approvedCount: 0,
    activeCount: 0,
    deniedCount: 0,
    terminatedCount: 0,
    revalidationRequiredCount: 0,
    overdueFollowUpsCount: 0,
    upcomingFollowUpsCount: 0,
  });

  // Lookups for creation
  const [providers, setProviders] = useState<Array<{ id: string; firstName: string; lastName: string; npiNumber: string }>>([]);
  const [payers, setPayers] = useState<Array<{ id: string; name: string }>>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createData, setCreateData] = useState({
    providerId: '',
    payerId: '',
    locationId: '',
    enrollmentType: 'individual',
    applicationType: 'initial',
    status: 'preparing',
    groupNumber: '',
    groupNpi: '',
    submittedDate: '',
    effectiveDate: '',
    followUpDate: '',
    trackingNumber: '',
    notes: '',
  });
  const [createSubmitting, setCreateSubmitting] = useState(false);

  // Status Transition Modal
  const [transitioningEnr, setTransitioningEnr] = useState<EnrollmentItem | null>(null);
  const [targetStatus, setTargetStatus] = useState('');
  const [transitionNotes, setTransitionNotes] = useState('');
  const [transitionSubmitting, setTransitionSubmitting] = useState(false);

  // Follow-Up Modal
  const [followUpEnr, setFollowUpEnr] = useState<EnrollmentItem | null>(null);
  const [fuMethod, setFuMethod] = useState<'phone' | 'email' | 'portal' | 'fax'>('phone');
  const [fuPerson, setFuPerson] = useState('');
  const [fuReference, setFuReference] = useState('');
  const [fuOutcome, setFuOutcome] = useState<'no_update' | 'in_process' | 'need_info' | 'approved' | 'denied'>('in_process');
  const [fuNotes, setFuNotes] = useState('');
  const [fuNextDate, setFuNextDate] = useState('');
  const [fuSubmitting, setFuSubmitting] = useState(false);

  // Missing Items Modal
  const [missingItemsEnr, setMissingItemsEnr] = useState<EnrollmentItem | null>(null);
  const [newMissingCategory, setNewMissingCategory] = useState('missing_document');
  const [newMissingDesc, setNewMissingDesc] = useState('');
  const [missingItemsList, setMissingItemsList] = useState<MissingItem[]>([]);
  const [missingSubmitting, setMissingSubmitting] = useState(false);

  const fetchEnrollments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '15',
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      });
      if (search) params.append('search', search);
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (typeFilter !== 'all') params.append('enrollmentType', typeFilter);
      if (overdueOnly) params.append('isOverdueFollowUp', 'true');
      if (revalidationOnly) params.append('isRevalidationRequired', 'true');
      if (agingFilter === '30') params.append('agingDaysMin', '30');
      if (agingFilter === '60') params.append('agingDaysMin', '60');

      const res = await fetch(`/api/v1/enrollments?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load enrollments');
      const data = await res.json();
      setEnrollments(data.items || []);
      setTotalPages(data.pagination?.totalPages || 1);
      if (data.summaryCounts) {
        setSummaryCounts(data.summaryCounts);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading enrollments');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, typeFilter, overdueOnly, revalidationOnly, agingFilter, page]);

  useEffect(() => {
    fetchEnrollments();
  }, [fetchEnrollments]);

  // Load providers and payers for modal
  const loadLookups = async () => {
    try {
      const [pRes, payRes, locRes] = await Promise.all([
        fetch('/api/v1/providers?limit=100'),
        fetch('/api/v1/payers?limit=100'),
        fetch('/api/v1/locations'),
      ]);
      if (pRes.ok) {
        const pData = await pRes.json();
        setProviders(pData.providers || []);
      }
      if (payRes.ok) {
        const payData = await payRes.json();
        setPayers(payData.payers || []);
      }
      if (locRes.ok) {
        const locData = await locRes.json();
        setLocations(locData.locations || []);
      }
    } catch (err) {
      console.error('Error loading lookups', err);
    }
  };

  const handleOpenCreate = () => {
    loadLookups();
    setCreateData({
      providerId: '',
      payerId: '',
      locationId: '',
      enrollmentType: 'individual',
      applicationType: 'initial',
      status: 'preparing',
      groupNumber: '',
      groupNpi: '',
      submittedDate: '',
      effectiveDate: '',
      followUpDate: '',
      trackingNumber: '',
      notes: '',
    });
    setShowCreateModal(true);
  };

  const handleCreateEnrollment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setCreateSubmitting(true);
      const payload = {
        ...createData,
        locationId: createData.locationId || null,
        groupNumber: createData.groupNumber || null,
        groupNpi: createData.groupNpi || null,
        submittedDate: createData.submittedDate || null,
        effectiveDate: createData.effectiveDate || null,
        followUpDate: createData.followUpDate || null,
        trackingNumber: createData.trackingNumber || null,
        notes: createData.notes || null,
      };

      const res = await fetch('/api/v1/enrollments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to create enrollment');
      }

      setShowCreateModal(false);
      fetchEnrollments();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error creating enrollment');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleTransitionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transitioningEnr) return;
    try {
      setTransitionSubmitting(true);
      const res = await fetch(`/api/v1/enrollments/${transitioningEnr.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: targetStatus,
          notes: transitionNotes,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Status transition failed');
      }
      setTransitioningEnr(null);
      fetchEnrollments();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Transition failed');
    } finally {
      setTransitionSubmitting(false);
    }
  };

  const handleFollowUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!followUpEnr) return;
    try {
      setFuSubmitting(true);
      const res = await fetch(`/api/v1/enrollments/${followUpEnr.id}/follow-ups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          followUpDate: new Date().toISOString().slice(0, 10),
          contactMethod: fuMethod,
          contactPerson: fuPerson || null,
          referenceNumber: fuReference || null,
          outcome: fuOutcome,
          notes: fuNotes || null,
          nextFollowUpDate: fuNextDate || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Follow-up logging failed');
      }
      setFollowUpEnr(null);
      fetchEnrollments();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Follow-up failed');
    } finally {
      setFuSubmitting(false);
    }
  };

  const handleOpenMissingItems = (enr: EnrollmentItem) => {
    setMissingItemsEnr(enr);
    setMissingItemsList(enr.missingItems || []);
    setNewMissingDesc('');
  };

  const handleToggleResolveMissingItem = async (itemId: string) => {
    const updated = missingItemsList.map((item) =>
      item.id === itemId
        ? {
            ...item,
            isResolved: !item.isResolved,
            resolvedAt: !item.isResolved ? new Date().toISOString() : null,
          }
        : item
    );
    setMissingItemsList(updated);
    saveMissingItems(updated);
  };

  const handleAddMissingItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMissingDesc.trim()) return;
    const newItem: MissingItem = {
      id: Math.random().toString(36).substring(2, 9),
      category: newMissingCategory,
      description: newMissingDesc.trim(),
      isResolved: false,
      notes: null,
      resolvedAt: null,
    };
    const updated = [...missingItemsList, newItem];
    setMissingItemsList(updated);
    setNewMissingDesc('');
    saveMissingItems(updated);
  };

  const saveMissingItems = async (items: MissingItem[]) => {
    if (!missingItemsEnr) return;
    try {
      setMissingSubmitting(true);
      const res = await fetch(`/api/v1/enrollments/${missingItemsEnr.id}/missing-items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missingItems: items }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to update checklist');
      }
      fetchEnrollments();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error updating checklist');
    } finally {
      setMissingSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header and New Application */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Payer Enrollment Work Queue</h1>
          <p className="text-sm text-slate-500">
            Track individual and group payer applications, aging turnaround, follow-ups, missing requirements, and revalidations.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Link
            href="/enrollments/bulk"
            className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg shadow-sm transition"
          >
            ⚡ Bulk Enroll
          </Link>
          <Link
            href="/admin/payers"
            className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg shadow-sm transition"
          >
            🏛️ Payer Directory
          </Link>
          <button
            onClick={handleOpenCreate}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
          >
            + New Enrollment Application
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
        <button
          onClick={() => { setStatusFilter('pending'); setOverdueOnly(false); setRevalidationOnly(false); setPage(1); }}
          className={`p-3 rounded-xl border text-left transition ${
            statusFilter === 'pending'
              ? 'bg-yellow-50 border-yellow-400 ring-2 ring-yellow-300'
              : 'bg-white border-slate-200 hover:border-yellow-300'
          }`}
        >
          <div className="text-[10px] uppercase font-bold text-yellow-700">Pending Review</div>
          <div className="text-xl font-bold text-slate-900 mt-1">{summaryCounts.pendingCount}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Submitted / In-process</div>
        </button>

        <button
          onClick={() => { setStatusFilter('needs_info'); setOverdueOnly(false); setRevalidationOnly(false); setPage(1); }}
          className={`p-3 rounded-xl border text-left transition ${
            statusFilter === 'needs_info'
              ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-300'
              : 'bg-white border-slate-200 hover:border-amber-300'
          }`}
        >
          <div className="text-[10px] uppercase font-bold text-amber-700">Needs Info</div>
          <div className="text-xl font-bold text-amber-900 mt-1">{summaryCounts.needsInfoCount}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Missing checklist items</div>
        </button>

        <button
          onClick={() => { setOverdueOnly(true); setStatusFilter('all'); setRevalidationOnly(false); setPage(1); }}
          className={`p-3 rounded-xl border text-left transition ${
            overdueOnly
              ? 'bg-rose-50 border-rose-400 ring-2 ring-rose-300'
              : 'bg-white border-slate-200 hover:border-rose-300'
          }`}
        >
          <div className="text-[10px] uppercase font-bold text-rose-700">Overdue Follow-Up</div>
          <div className="text-xl font-bold text-rose-900 mt-1">{summaryCounts.overdueFollowUpsCount}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Action date passed</div>
        </button>

        <button
          onClick={() => { setRevalidationOnly(true); setOverdueOnly(false); setStatusFilter('all'); setPage(1); }}
          className={`p-3 rounded-xl border text-left transition ${
            revalidationOnly
              ? 'bg-purple-50 border-purple-400 ring-2 ring-purple-300'
              : 'bg-white border-slate-200 hover:border-purple-300'
          }`}
        >
          <div className="text-[10px] uppercase font-bold text-purple-700">Revalidation Due</div>
          <div className="text-xl font-bold text-purple-900 mt-1">{summaryCounts.revalidationRequiredCount}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">≤ 90d revalidation</div>
        </button>

        <button
          onClick={() => { setStatusFilter('approved'); setOverdueOnly(false); setRevalidationOnly(false); setPage(1); }}
          className={`p-3 rounded-xl border text-left transition ${
            statusFilter === 'approved'
              ? 'bg-emerald-50 border-emerald-400 ring-2 ring-emerald-300'
              : 'bg-white border-slate-200 hover:border-emerald-300'
          }`}
        >
          <div className="text-[10px] uppercase font-bold text-emerald-700">Approved / Active</div>
          <div className="text-xl font-bold text-emerald-900 mt-1">{summaryCounts.approvedCount + summaryCounts.activeCount}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Billing authorized</div>
        </button>

        <button
          onClick={() => { setStatusFilter('denied'); setOverdueOnly(false); setRevalidationOnly(false); setPage(1); }}
          className={`p-3 rounded-xl border text-left transition ${
            statusFilter === 'denied'
              ? 'bg-red-50 border-red-400 ring-2 ring-red-300'
              : 'bg-white border-slate-200 hover:border-red-300'
          }`}
        >
          <div className="text-[10px] uppercase font-bold text-red-700">Denied</div>
          <div className="text-xl font-bold text-red-900 mt-1">{summaryCounts.deniedCount}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Appeals required</div>
        </button>

        <button
          onClick={() => { setStatusFilter('all'); setTypeFilter('all'); setOverdueOnly(false); setRevalidationOnly(false); setPage(1); }}
          className="p-3 rounded-xl border bg-white border-slate-200 text-left hover:border-slate-400 transition"
        >
          <div className="text-[10px] uppercase font-bold text-slate-500">Total All</div>
          <div className="text-xl font-bold text-slate-900 mt-1">{summaryCounts.totalCount}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Across all payers</div>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-3">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search provider name, NPI, payer, tracking #, group NPI..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full px-3.5 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setOverdueOnly(false); setRevalidationOnly(false); setPage(1); }}
            className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-700"
          >
            <option value="all">All Statuses</option>
            <option value="not_started">Not Started</option>
            <option value="preparing">Preparing</option>
            <option value="submitted">Submitted</option>
            <option value="pending">Pending Payer</option>
            <option value="needs_info">Needs Information</option>
            <option value="approved">Approved</option>
            <option value="active">Active</option>
            <option value="denied">Denied</option>
            <option value="terminated">Terminated</option>
            <option value="revalidation_required">Revalidation Required</option>
          </select>

          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value as 'individual' | 'group' | 'all'); setPage(1); }}
            className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 font-medium"
          >
            <option value="all">All Types (Individual & Group)</option>
            <option value="individual">Individual Enrolled</option>
            <option value="group">Group / Organization</option>
          </select>

          <select
            value={agingFilter}
            onChange={(e) => { setAgingFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-700"
          >
            <option value="all">All Aging Times</option>
            <option value="30">Aging &gt; 30 Days</option>
            <option value="60">Aging &gt; 60 Days</option>
          </select>

          {(search || statusFilter !== 'all' || typeFilter !== 'all' || overdueOnly || revalidationOnly || agingFilter !== 'all') && (
            <button
              onClick={() => {
                setSearch('');
                setStatusFilter('all');
                setTypeFilter('all');
                setOverdueOnly(false);
                setRevalidationOnly(false);
                setAgingFilter('all');
                setPage(1);
              }}
              className="px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 bg-slate-100 rounded-lg"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Main Enrollments Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-xs">Loading enrollment queue...</div>
        ) : error ? (
          <div className="p-8 text-center text-rose-500 text-xs">{error}</div>
        ) : enrollments.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs">
            No payer enrollments match the selected filters. Click &quot;+ New Enrollment Application&quot; to begin.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-4">Provider</th>
                  <th className="py-3 px-4">Payer</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Status & Aging</th>
                  <th className="py-3 px-4">Follow-Up Schedule</th>
                  <th className="py-3 px-4">Missing Items</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {enrollments.map((enr) => {
                  let statusBadge = 'bg-slate-100 text-slate-700';
                  if (['submitted', 'pending', 'preparing'].includes(enr.status)) {
                    statusBadge = 'bg-yellow-100 text-yellow-800 border border-yellow-200';
                  } else if (enr.status === 'needs_info') {
                    statusBadge = 'bg-amber-100 text-amber-800 border border-amber-200 animate-pulse';
                  } else if (enr.status === 'approved' || enr.status === 'active') {
                    statusBadge = 'bg-emerald-100 text-emerald-800 border border-emerald-200';
                  } else if (enr.status === 'denied') {
                    statusBadge = 'bg-rose-100 text-rose-800 border border-rose-200 font-bold';
                  } else if (enr.status === 'revalidation_required') {
                    statusBadge = 'bg-purple-100 text-purple-800 border border-purple-200';
                  }

                  return (
                    <tr key={enr.id} className="hover:bg-slate-50/60 transition">
                      <td className="py-3 px-4">
                        <Link
                          href={`/providers/${enr.provider.id}`}
                          className="font-bold text-blue-600 hover:underline block"
                        >
                          Dr. {enr.provider.firstName} {enr.provider.lastName}
                        </Link>
                        <span className="text-[11px] font-mono text-slate-400">
                          NPI: {enr.provider.npiNumber || 'N/A'}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{enr.payer.name}</div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {enr.payer.payerType || 'Commercial'} • {enr.payer.state || 'National'}
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        {enr.enrollmentType === 'group' ? (
                          <div className="space-y-0.5">
                            <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-indigo-100 text-indigo-800 border border-indigo-200">
                              GROUP
                            </span>
                            {enr.groupNpi && (
                              <div className="text-[10px] font-mono text-slate-500">
                                Org NPI: {enr.groupNpi}
                              </div>
                            )}
                            {enr.groupNumber && (
                              <div className="text-[10px] font-mono text-slate-400">
                                Grp #{enr.groupNumber}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="px-2 py-0.5 rounded font-semibold text-[10px] bg-slate-100 text-slate-700">
                            INDIVIDUAL
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${statusBadge}`}>
                          {enr.status.replace('_', ' ')}
                        </span>
                        {enr.agingDays !== null && (
                          <div className="text-[11px] text-slate-500 mt-1">
                            Aging: <span className={`font-mono font-semibold ${enr.agingDays > 30 ? 'text-amber-600' : 'text-slate-700'}`}>{enr.agingDays}d</span>
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        {enr.followUpDate ? (
                          <div className="space-y-0.5">
                            <div className="font-mono text-[11px]">
                              Next: {new Date(enr.followUpDate).toLocaleDateString()}
                            </div>
                            {enr.followUpInfo.isOverdue && (
                              <span className="inline-block px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                                ⚠ Overdue ({Math.abs(enr.followUpInfo.daysDiff || 0)}d)
                              </span>
                            )}
                            {enr.followUpInfo.isUpcoming && (
                              <span className="inline-block px-1.5 py-0.2 rounded text-[10px] font-semibold bg-blue-100 text-blue-800">
                                In {enr.followUpInfo.daysDiff} days
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-[11px]">No follow-up set</span>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        {enr.openMissingCount > 0 ? (
                          <button
                            onClick={() => handleOpenMissingItems(enr)}
                            className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200 transition"
                          >
                            ⚠ {enr.openMissingCount} Open Items
                          </button>
                        ) : (
                          <button
                            onClick={() => handleOpenMissingItems(enr)}
                            className="text-[11px] text-slate-400 hover:text-slate-700 hover:underline"
                          >
                            Checklist ({enr.missingItems.length})
                          </button>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right space-x-1.5">
                        <button
                          onClick={() => {
                            setTransitioningEnr(enr);
                            setTargetStatus(enr.status);
                            setTransitionNotes('');
                          }}
                          className="px-2 py-1 bg-white border border-slate-300 hover:border-blue-500 hover:text-blue-600 rounded text-[11px] font-medium transition"
                        >
                          Status
                        </button>
                        <button
                          onClick={() => {
                            setFollowUpEnr(enr);
                            setFuPerson('');
                            setFuReference('');
                            setFuNotes('');
                            setFuNextDate('');
                          }}
                          className="px-2 py-1 bg-white border border-slate-300 hover:border-indigo-500 hover:text-indigo-600 rounded text-[11px] font-medium transition"
                        >
                          Follow-Up
                        </button>
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
            Page {page} of {totalPages} ({summaryCounts.totalCount} total applications)
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

      {/* Modal: New Enrollment Application */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-slate-900 mb-1">New Payer Enrollment Application</h3>
            <p className="text-xs text-slate-500 mb-4">Track provider enrollment with commercial or government payer</p>

            <form onSubmit={handleCreateEnrollment} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Provider *</label>
                  <select
                    required
                    value={createData.providerId}
                    onChange={(e) => setCreateData({ ...createData, providerId: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">-- Select Provider --</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        Dr. {p.firstName} {p.lastName} (NPI: {p.npiNumber || 'N/A'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Insurance Payer *</label>
                  <select
                    required
                    value={createData.payerId}
                    onChange={(e) => setCreateData({ ...createData, payerId: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">-- Select Payer --</option>
                    {payers.map((pay) => (
                      <option key={pay.id} value={pay.id}>
                        {pay.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Enrollment Type *</label>
                  <select
                    value={createData.enrollmentType}
                    onChange={(e) => setCreateData({ ...createData, enrollmentType: e.target.value as 'individual' | 'group' })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-medium"
                  >
                    <option value="individual">Individual Provider</option>
                    <option value="group">Group / Organization</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Application Type *</label>
                  <select
                    value={createData.applicationType}
                    onChange={(e) => setCreateData({ ...createData, applicationType: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="initial">Initial Application</option>
                    <option value="revalidation">Revalidation</option>
                    <option value="update">Demographic / Location Update</option>
                    <option value="termination">Termination</option>
                  </select>
                </div>
              </div>

              {/* Group fields if Group Enrollment */}
              {createData.enrollmentType === 'group' && (
                <div className="p-3 bg-indigo-50/60 border border-indigo-200 rounded-lg space-y-3">
                  <div className="font-semibold text-indigo-900 text-xs">Group Enrollment Affiliation</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-700 mb-1">Group NPI (10 digits) *</label>
                      <input
                        type="text"
                        maxLength={10}
                        required
                        value={createData.groupNpi}
                        onChange={(e) => setCreateData({ ...createData, groupNpi: e.target.value })}
                        placeholder="e.g. 1992883774"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-700 mb-1">Payer Group Number</label>
                      <input
                        type="text"
                        value={createData.groupNumber}
                        onChange={(e) => setCreateData({ ...createData, groupNumber: e.target.value })}
                        placeholder="e.g. GRP-998877"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Practice Location</label>
                  <select
                    value={createData.locationId}
                    onChange={(e) => setCreateData({ ...createData, locationId: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">-- None / All Locations --</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Payer Tracking / Reference #</label>
                  <input
                    type="text"
                    value={createData.trackingNumber}
                    onChange={(e) => setCreateData({ ...createData, trackingNumber: e.target.value })}
                    placeholder="e.g. APP-2026-9901"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status</label>
                  <select
                    value={createData.status}
                    onChange={(e) => setCreateData({ ...createData, status: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="preparing">Preparing</option>
                    <option value="submitted">Submitted</option>
                    <option value="pending">Pending</option>
                    <option value="needs_info">Needs Info</option>
                    <option value="approved">Approved</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Submitted Date</label>
                  <input
                    type="date"
                    value={createData.submittedDate}
                    onChange={(e) => setCreateData({ ...createData, submittedDate: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Next Follow-Up Date</label>
                  <input
                    type="date"
                    value={createData.followUpDate}
                    onChange={(e) => setCreateData({ ...createData, followUpDate: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Application Notes</label>
                <textarea
                  rows={2}
                  value={createData.notes}
                  onChange={(e) => setCreateData({ ...createData, notes: e.target.value })}
                  placeholder="Application details, special instructions..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createSubmitting}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg"
                >
                  {createSubmitting ? 'Creating...' : 'Create Enrollment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Status Transition */}
      {transitioningEnr && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-1">Transition Enrollment Status</h3>
            <p className="text-xs text-slate-500 mb-4">
              Updating application for Dr. {transitioningEnr.provider.lastName} with {transitioningEnr.payer.name}
            </p>

            <form onSubmit={handleTransitionSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">New Status *</label>
                <select
                  value={targetStatus}
                  onChange={(e) => setTargetStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white capitalize"
                >
                  <option value="preparing">Preparing</option>
                  <option value="submitted">Submitted</option>
                  <option value="pending">Pending Payer Review</option>
                  <option value="needs_info">Needs Information</option>
                  <option value="approved">Approved</option>
                  <option value="active">Active Billing</option>
                  <option value="denied">Denied</option>
                  <option value="revalidation_required">Revalidation Required</option>
                  <option value="terminated">Terminated</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Reason / Transition Notes</label>
                <textarea
                  rows={3}
                  value={transitionNotes}
                  onChange={(e) => setTransitionNotes(e.target.value)}
                  placeholder="Details regarding this status change (recorded in permanent audit history)..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTransitioningEnr(null)}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={transitionSubmitting}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg"
                >
                  {transitionSubmitting ? 'Saving...' : 'Update Status'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Log Follow-Up */}
      {followUpEnr && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-1">Log Payer Follow-Up Contact</h3>
            <p className="text-xs text-slate-500 mb-4">
              Recording outreach to {followUpEnr.payer.name} (Dr. {followUpEnr.provider.lastName})
            </p>

            <form onSubmit={handleFollowUpSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Contact Method *</label>
                  <select
                    value={fuMethod}
                    onChange={(e) => setFuMethod(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="phone">Phone Call</option>
                    <option value="portal">Payer Online Portal</option>
                    <option value="email">Email</option>
                    <option value="fax">Fax</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Contact Representative</label>
                  <input
                    type="text"
                    value={fuPerson}
                    onChange={(e) => setFuPerson(e.target.value)}
                    placeholder="e.g. Agent Sarah (Badge #401)"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Call / Reference #</label>
                  <input
                    type="text"
                    value={fuReference}
                    onChange={(e) => setFuReference(e.target.value)}
                    placeholder="e.g. REF-88992"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Contact Outcome *</label>
                  <select
                    value={fuOutcome}
                    onChange={(e) => setFuOutcome(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="in_process">In Process / Under Review</option>
                    <option value="need_info">Needs Information / Items Requested</option>
                    <option value="approved">Approved on Call</option>
                    <option value="denied">Denied on Call</option>
                    <option value="no_update">No Update / Left Message</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Follow-Up Notes</label>
                <textarea
                  rows={2}
                  value={fuNotes}
                  onChange={(e) => setFuNotes(e.target.value)}
                  placeholder="Summarize conversation, estimated turnaround..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Next Follow-Up Date</label>
                <input
                  type="date"
                  value={fuNextDate}
                  onChange={(e) => setFuNextDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setFollowUpEnr(null)}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={fuSubmitting}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-lg"
                >
                  {fuSubmitting ? 'Saving...' : 'Save Follow-Up'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Missing Information Checklist */}
      {missingItemsEnr && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-1">Missing Information Checklist</h3>
            <p className="text-xs text-slate-500 mb-4">
              Outstanding items for {missingItemsEnr.payer.name} application
            </p>

            <div className="space-y-3 mb-4 max-h-60 overflow-y-auto">
              {missingItemsList.length === 0 ? (
                <div className="p-4 text-center text-slate-400 text-xs">
                  No missing items recorded. All requirements satisfied!
                </div>
              ) : (
                missingItemsList.map((item) => (
                  <div
                    key={item.id}
                    className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
                      item.isResolved
                        ? 'bg-slate-50 border-slate-200 text-slate-400 line-through'
                        : 'bg-amber-50 border-amber-200 text-slate-800'
                    }`}
                  >
                    <div>
                      <div className="font-semibold">{item.description}</div>
                      <div className="text-[10px] text-slate-400 uppercase mt-0.5 font-mono">
                        {item.category.replace('_', ' ')}
                      </div>
                    </div>
                    <button
                      onClick={() => handleToggleResolveMissingItem(item.id)}
                      className={`px-2 py-1 rounded text-[10px] font-bold transition ${
                        item.isResolved
                          ? 'bg-slate-200 text-slate-600'
                          : 'bg-emerald-600 text-white hover:bg-emerald-700'
                      }`}
                    >
                      {item.isResolved ? 'Reopen' : '✓ Resolve'}
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Add New Missing Item */}
            <form onSubmit={handleAddMissingItem} className="pt-3 border-t border-slate-200 space-y-2 text-xs">
              <div className="font-semibold text-slate-700">Add Missing Requirement:</div>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={newMissingCategory}
                  onChange={(e) => setNewMissingCategory(e.target.value)}
                  className="px-2 py-1.5 border border-slate-300 rounded bg-white text-[11px]"
                >
                  <option value="missing_document">Document</option>
                  <option value="missing_signature">Signature</option>
                  <option value="missing_payer_info">Payer Info</option>
                  <option value="additional_info_requested">Info Requested</option>
                  <option value="other">Other</option>
                </select>
                <input
                  type="text"
                  required
                  placeholder="Requirement details..."
                  value={newMissingDesc}
                  onChange={(e) => setNewMissingDesc(e.target.value)}
                  className="col-span-2 px-2.5 py-1.5 border border-slate-300 rounded text-[11px]"
                />
              </div>
              <button
                type="submit"
                disabled={missingSubmitting}
                className="w-full py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-medium rounded text-[11px]"
              >
                + Add Item to Checklist
              </button>
            </form>

            <div className="flex justify-end pt-4 border-t border-slate-100 mt-4">
              <button
                onClick={() => setMissingItemsEnr(null)}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
