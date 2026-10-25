'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface OrganizationItem {
  id: string;
  name: string;
  dbaName: string | null;
  npiNumber: string | null;
  taxIdLastFour: string | null;
  maskedTaxId: string | null;
  organizationType: string;
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  zipCode: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  status: 'active' | 'inactive' | 'archived';
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  _count: {
    providers: number;
    enrollments: number;
  };
}

interface ApiResponse {
  organizations: OrganizationItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export default function OrganizationsDirectoryPage() {
  const [organizations, setOrganizations] = useState<OrganizationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [orgType, setOrgType] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create Organization Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({
    name: '',
    dbaName: '',
    npiNumber: '',
    taxId: '',
    organizationType: 'medical_group',
    address1: '',
    address2: '',
    city: '',
    state: 'TX',
    zipCode: '',
    phone: '',
    email: '',
    website: '',
    status: 'active',
    notes: '',
  });

  const fetchOrganizations = useCallback(async () => {
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
      if (orgType) params.set('organizationType', orgType);

      const res = await fetch(`/api/v1/organizations?${params.toString()}`);
      if (!res.ok) {
        throw new Error('Failed to fetch organizations directory');
      }
      const data: ApiResponse = await res.json();
      setOrganizations(data.organizations || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error fetching organizations');
    } finally {
      setLoading(false);
    }
  }, [page, search, status, orgType, sortBy, sortOrder]);

  useEffect(() => {
    fetchOrganizations();
  }, [fetchOrganizations]);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreateSubmitting(true);

    try {
      if (!createForm.name.trim()) throw new Error('Organization legal name is required.');
      if (!createForm.address1.trim() || !createForm.city.trim() || !createForm.state.trim() || !createForm.zipCode.trim()) {
        throw new Error('Address, city, 2-letter state, and zip code are required.');
      }
      if (createForm.npiNumber && !/^\d{10}$/.test(createForm.npiNumber.trim())) {
        throw new Error('Group NPI must be exactly 10 digits.');
      }
      if (createForm.taxId && !/^\d{2}-?\d{7}$/.test(createForm.taxId.trim())) {
        throw new Error('Tax ID / EIN must be 9 digits or in XX-XXXXXXX format.');
      }

      const payload = {
        ...createForm,
        dbaName: createForm.dbaName.trim() || null,
        npiNumber: createForm.npiNumber.trim() || null,
        taxId: createForm.taxId.trim() || null,
        address2: createForm.address2.trim() || null,
        phone: createForm.phone.trim() || null,
        email: createForm.email.trim() || null,
        website: createForm.website.trim() || null,
        notes: createForm.notes.trim() || null,
      };

      const res = await fetch('/api/v1/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to create organization');
      }

      setShowCreateModal(false);
      setCreateForm({
        name: '',
        dbaName: '',
        npiNumber: '',
        taxId: '',
        organizationType: 'medical_group',
        address1: '',
        address2: '',
        city: '',
        state: 'TX',
        zipCode: '',
        phone: '',
        email: '',
        website: '',
        status: 'active',
        notes: '',
      });
      fetchOrganizations();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Error creating organization');
    } finally {
      setCreateSubmitting(false);
    }
  };

  // Quick stat aggregates from current view
  const activeCount = organizations.filter((o) => o.status === 'active').length;
  const totalAffiliatedProviders = organizations.reduce((acc, o) => acc + (o._count?.providers || 0), 0);
  const totalGroupEnrollments = organizations.reduce((acc, o) => acc + (o._count?.enrollments || 0), 0);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-xs text-slate-500 mb-1">
            <Link href="/dashboard" className="hover:underline">Dashboard</Link>
            <span>/</span>
            <span>Groups & Organizations</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Healthcare Organizations & Medical Groups</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage provider groups, health systems, Type 2 Group NPIs, and provider roster affiliations
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <Link
            href="/providers/bulk-import"
            className="px-3.5 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold rounded-lg shadow-sm transition"
          >
            Bulk CSV Import
          </Link>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition flex items-center space-x-1.5"
          >
            <span>+</span>
            <span>Create Organization</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Total Directory</span>
          <div className="text-2xl font-bold text-slate-900 mt-1">{total}</div>
          <span className="text-[11px] text-slate-400 mt-0.5 block">Managed groups</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Active Status</span>
          <div className="text-2xl font-bold text-emerald-600 mt-1">{activeCount}</div>
          <span className="text-[11px] text-slate-400 mt-0.5 block">Currently practicing</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Roster Providers</span>
          <div className="text-2xl font-bold text-blue-600 mt-1">{totalAffiliatedProviders}</div>
          <span className="text-[11px] text-slate-400 mt-0.5 block">Affiliated clinicians</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Payer Enrollments</span>
          <div className="text-2xl font-bold text-indigo-600 mt-1">{totalGroupEnrollments}</div>
          <span className="text-[11px] text-slate-400 mt-0.5 block">Group applications</span>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2 relative">
            <input
              type="text"
              placeholder="Search by legal name, DBA, Type 2 NPI, or city..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 pl-9 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500"
            />
            <span className="absolute left-3 top-2.5 text-slate-400 text-xs">🔍</span>
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-2 text-xs text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            )}
          </div>

          <div>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="archived">Archived</option>
            </select>
          </div>

          <div>
            <select
              value={orgType}
              onChange={(e) => {
                setOrgType(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Organization Types</option>
              <option value="medical_group">Medical Group / Practice</option>
              <option value="hospital_system">Hospital / Health System</option>
              <option value="solo_practice">Solo Practice Entity</option>
              <option value="clinic">Clinic / Urgent Care</option>
              <option value="ipa">IPA</option>
              <option value="asc">ASC</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
      </div>

      {/* Directory Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {error && (
          <div className="p-4 bg-red-50 text-red-700 text-xs border-b border-red-200">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-slate-400 text-xs">
            Loading organizations directory...
          </div>
        ) : organizations.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-xs space-y-2">
            <div className="text-3xl">🏢</div>
            <div className="font-semibold text-slate-600">No organizations found</div>
            <p className="text-slate-400 max-w-sm mx-auto">
              {search || status || orgType
                ? 'Try adjusting your search criteria or clearing filters.'
                : 'Get started by creating your first healthcare organization or medical group.'}
            </p>
            {!search && !status && !orgType && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="mt-3 px-3.5 py-1.5 bg-blue-600 text-white font-semibold rounded-lg text-xs"
              >
                + Create Organization
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-700 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-4 py-3 cursor-pointer hover:text-blue-600" onClick={() => {
                    if (sortBy === 'name') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                    else { setSortBy('name'); setSortOrder('asc'); }
                  }}>
                    Organization Name & DBA {sortBy === 'name' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th className="px-3 py-3">Type 2 Group NPI</th>
                  <th className="px-3 py-3">Tax ID (EIN)</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3">Location</th>
                  <th className="px-3 py-3 text-center">Providers</th>
                  <th className="px-3 py-3 text-center">Enrollments</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {organizations.map((org) => (
                  <tr key={org.id} className="hover:bg-slate-50/70 transition">
                    <td className="px-4 py-3">
                      <Link
                        href={`/organizations/${org.id}`}
                        className="font-bold text-slate-900 hover:text-blue-600 hover:underline block"
                      >
                        {org.name}
                      </Link>
                      {org.dbaName && (
                        <span className="text-[11px] text-slate-400 block">DBA: {org.dbaName}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 font-mono font-medium text-slate-800">
                      {org.npiNumber || <span className="text-slate-400 font-sans">N/A</span>}
                    </td>
                    <td className="px-3 py-3 font-mono text-slate-700">
                      {org.maskedTaxId || (org.taxIdLastFour ? `XX-XXX${org.taxIdLastFour}` : <span className="text-slate-400 font-sans">N/A</span>)}
                    </td>
                    <td className="px-3 py-3">
                      <span className="capitalize px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-700 border border-slate-200">
                        {org.organizationType.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {org.city}, {org.state}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                        {org._count?.providers || 0}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                        {org._count?.enrollments || 0}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                          org.status === 'active'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : org.status === 'archived'
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {org.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/organizations/${org.id}`}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        View & Roster →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <div>
              Showing page <strong className="text-slate-800">{page}</strong> of <strong className="text-slate-800">{totalPages}</strong> ({total} total organizations)
            </div>
            <div className="flex items-center space-x-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-2.5 py-1 border border-slate-300 rounded hover:bg-white disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-2.5 py-1 border border-slate-300 rounded hover:bg-white disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Create Organization */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-xl w-full p-6 border border-slate-200 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Create Healthcare Organization</h3>
                <p className="text-xs text-slate-500">
                  Register a medical group, hospital entity, or clinical organization
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            {createError && (
              <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200 mb-4">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Organization Legal Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    placeholder="e.g. Austin Regional Clinic, P.A."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Doing Business As (DBA)
                  </label>
                  <input
                    type="text"
                    value={createForm.dbaName}
                    onChange={(e) => setCreateForm({ ...createForm, dbaName: e.target.value })}
                    placeholder="e.g. ARC South Austin"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Type 2 Group NPI (10 digits)
                  </label>
                  <input
                    type="text"
                    maxLength={10}
                    value={createForm.npiNumber}
                    onChange={(e) => setCreateForm({ ...createForm, npiNumber: e.target.value.replace(/\D/g, '') })}
                    placeholder="e.g. 1982736450"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Federal Tax ID (EIN)
                  </label>
                  <input
                    type="text"
                    maxLength={10}
                    value={createForm.taxId}
                    onChange={(e) => setCreateForm({ ...createForm, taxId: e.target.value })}
                    placeholder="XX-XXXXXXX"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                  <span className="text-[10px] text-slate-400">Encrypted with AES-256-GCM at rest</span>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Organization Type</label>
                  <select
                    value={createForm.organizationType}
                    onChange={(e) => setCreateForm({ ...createForm, organizationType: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="medical_group">Medical Group / Practice</option>
                    <option value="hospital_system">Hospital / Health System</option>
                    <option value="solo_practice">Solo Practice Entity</option>
                    <option value="clinic">Clinic / Urgent Care</option>
                    <option value="ipa">Independent Physician Association (IPA)</option>
                    <option value="asc">Ambulatory Surgery Center (ASC)</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status</label>
                  <select
                    value={createForm.status}
                    onChange={(e) => setCreateForm({ ...createForm, status: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Street Address *</label>
                <input
                  type="text"
                  required
                  value={createForm.address1}
                  onChange={(e) => setCreateForm({ ...createForm, address1: e.target.value })}
                  placeholder="500 Congress Ave, Suite 100"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">City *</label>
                  <input
                    type="text"
                    required
                    value={createForm.city}
                    onChange={(e) => setCreateForm({ ...createForm, city: e.target.value })}
                    placeholder="Austin"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">State *</label>
                  <input
                    type="text"
                    required
                    maxLength={2}
                    value={createForm.state}
                    onChange={(e) => setCreateForm({ ...createForm, state: e.target.value.toUpperCase() })}
                    placeholder="TX"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Zip *</label>
                  <input
                    type="text"
                    required
                    maxLength={10}
                    value={createForm.zipCode}
                    onChange={(e) => setCreateForm({ ...createForm, zipCode: e.target.value })}
                    placeholder="78701"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={createForm.phone}
                    onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
                    placeholder="(512) 555-0100"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={createForm.email}
                    onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                    placeholder="credentialing@austinclinic.com"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Internal Notes</label>
                <textarea
                  rows={2}
                  value={createForm.notes}
                  onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
                  placeholder="Billing guidelines, group enrollment instructions, or notes..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3.5 py-1.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createSubmitting}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg"
                >
                  {createSubmitting ? 'Creating...' : 'Create Organization'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
