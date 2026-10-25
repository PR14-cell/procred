'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface ProviderItem {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  npiNumber: string;
  email: string | null;
  phone: string | null;
  status: string;
  credentialingStatus: string;
  primaryTaxonomy: string | null;
  taxonomyDescription: string | null;
  createdAt: string;
  specialties: Array<{
    taxonomyCode: string;
    isPrimary: boolean;
    taxonomy: {
      specialization: string | null;
      classification: string;
    };
  }>;
  locations: Array<{
    locationId: string;
    isPrimary: boolean;
    location: {
      name: string;
      city: string;
      state: string;
    };
  }>;
  _count: {
    stateLicenses: number;
    deaRegistrations: number;
    boardCertifications: number;
    malpracticePolicies: number;
    enrollments: number;
  };
}

interface ApiResponse {
  providers: ProviderItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export default function ProvidersListPage() {
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [credentialingStatus, setCredentialingStatus] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProviders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '10',
        sortBy,
        sortOrder,
      });

      if (search) params.set('search', search);
      if (status) params.set('status', status);
      if (credentialingStatus) params.set('credentialingStatus', credentialingStatus);

      const res = await fetch(`/api/v1/providers?${params.toString()}`);
      if (!res.ok) {
        throw new Error('Failed to fetch providers');
      }
      const data: ApiResponse = await res.json();
      setProviders(data.providers);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error fetching providers');
    } finally {
      setLoading(false);
    }
  }, [page, search, status, credentialingStatus, sortBy, sortOrder]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchProviders();
  };

  const handleArchive = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to archive provider ${name}?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/v1/providers/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to archive provider');
      }
      fetchProviders();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to archive');
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Provider Directory</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage provider demographics, clinical specialties, and organizational rosters
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/providers/import"
            className="inline-flex items-center justify-center px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg shadow-sm transition"
          >
            Bulk Import CSV
          </Link>
          <Link
            href="/providers/new"
            className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition"
          >
            <span className="mr-1.5 font-bold">+</span> Onboard Provider
          </Link>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
        <form onSubmit={handleSearchSubmit} className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by provider name, NPI, email, or phone..."
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="absolute left-3 top-2.5 text-slate-400">🔍</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Status: Active & Inactive</option>
              <option value="active">Active Only</option>
              <option value="inactive">Inactive Only</option>
              <option value="archived">Archived</option>
              <option value="all">All Records</option>
            </select>

            <select
              value={credentialingStatus}
              onChange={(e) => {
                setCredentialingStatus(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Credentialing: All</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="needs_review">Needs Review</option>
              <option value="initial">Initial</option>
            </select>

            <select
              value={`${sortBy}-${sortOrder}`}
              onChange={(e) => {
                const [sb, so] = e.target.value.split('-');
                setSortBy(sb);
                setSortOrder(so as 'asc' | 'desc');
              }}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="name-asc">Name (A-Z)</option>
              <option value="name-desc">Name (Z-A)</option>
              <option value="npi-asc">NPI (Asc)</option>
              <option value="createdAt-desc">Newest First</option>
              <option value="createdAt-asc">Oldest First</option>
            </select>

            <button
              type="submit"
              className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium rounded-lg transition"
            >
              Filter
            </button>
          </div>
        </form>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      {/* Provider List Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-3.5 px-4 text-left">Provider</th>
                <th className="py-3.5 px-4 text-left">NPI</th>
                <th className="py-3.5 px-4 text-left">Primary Specialty</th>
                <th className="py-3.5 px-4 text-left">Locations</th>
                <th className="py-3.5 px-4 text-left">Status</th>
                <th className="py-3.5 px-4 text-left">Credentialing</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-blue-600 border-t-transparent mb-2"></div>
                    <div>Loading provider directory...</div>
                  </td>
                </tr>
              ) : providers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    <div className="text-3xl mb-2">👤</div>
                    <div className="font-semibold text-slate-800 text-base">No providers found</div>
                    <p className="text-slate-500 text-xs mt-1 max-w-sm mx-auto">
                      {search || status || credentialingStatus
                        ? 'No provider records matched the search or filter criteria. Try adjusting filters.'
                        : 'Your organization has not added any healthcare providers yet.'}
                    </p>
                    {!search && !status && (
                      <Link
                        href="/providers/new"
                        className="inline-block mt-4 px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition"
                      >
                        + Onboard First Provider
                      </Link>
                    )}
                  </td>
                </tr>
              ) : (
                providers.map((p) => {
                  const primarySpecialty =
                    p.specialties.find((s) => s.isPrimary) || p.specialties[0];
                  const fullName = `${p.lastName}, ${p.firstName}${
                    p.middleName ? ` ${p.middleName[0]}.` : ''
                  }${p.suffix ? ` ${p.suffix}` : ''}`;

                  return (
                    <tr key={p.id} className="hover:bg-slate-50 transition">
                      <td className="py-3.5 px-4">
                        <Link
                          href={`/providers/${p.id}`}
                          className="font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {fullName}
                        </Link>
                        {p.email && (
                          <div className="text-xs text-slate-400 font-mono mt-0.5">{p.email}</div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-slate-800">
                        {p.npiNumber}
                      </td>
                      <td className="py-3.5 px-4">
                        {primarySpecialty?.taxonomy?.specialization ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                            {primarySpecialty.taxonomy.specialization}
                          </span>
                        ) : p.taxonomyDescription ? (
                          <span className="text-xs text-slate-600">{p.taxonomyDescription}</span>
                        ) : (
                          <span className="text-xs text-slate-400 italic">Unspecified</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-xs">
                        {p.locations.length > 0 ? (
                          <div>
                            <span className="font-medium text-slate-800">
                              {p.locations[0].location.name}
                            </span>
                            {p.locations.length > 1 && (
                              <span className="ml-1 text-slate-400">
                                (+{p.locations.length - 1} more)
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">None linked</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-block px-2 py-0.5 text-xs font-medium rounded capitalize ${
                            p.status === 'active'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : p.status === 'archived'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${
                            p.credentialingStatus === 'completed'
                              ? 'bg-emerald-50 text-emerald-700'
                              : p.credentialingStatus === 'needs_review'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-blue-50 text-blue-700'
                          }`}
                        >
                          {p.credentialingStatus.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right space-x-2">
                        <Link
                          href={`/providers/${p.id}`}
                          className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded shadow-sm inline-block"
                        >
                          View
                        </Link>
                        <Link
                          href={`/providers/${p.id}/edit`}
                          className="px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded inline-block"
                        >
                          Edit
                        </Link>
                        {p.status !== 'archived' && (
                          <button
                            onClick={() => handleArchive(p.id, fullName)}
                            className="px-2.5 py-1 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded inline-block"
                          >
                            Archive
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {total > 0 && (
          <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-600 gap-2">
            <div>
              Showing <span className="font-semibold">{(page - 1) * 10 + 1}</span> to{' '}
              <span className="font-semibold">{Math.min(page * 10, total)}</span> of{' '}
              <span className="font-semibold">{total}</span> providers
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 bg-white border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-50 transition"
              >
                Previous
              </button>
              <span className="px-2">
                Page {page} of {totalPages || 1}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 bg-white border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-50 transition"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
