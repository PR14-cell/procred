'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Payer {
  id: string;
  name: string;
  shortName: string | null;
  payerType: string | null;
  state: string | null;
  website: string | null;
  phone: string | null;
  enrollmentPortalUrl: string | null;
  requiredDocumentTypes: string[];
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  _count?: { enrollments: number };
}

export default function PayerDirectoryPage() {
  const [payers, setPayers] = useState<Payer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Pagination
  const [search, setSearch] = useState('');
  const [payerType, setPayerType] = useState('all');
  const [stateFilter, setStateFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  // Add/Edit Payer Modal
  const [showModal, setShowModal] = useState(false);
  const [editingPayer, setEditingPayer] = useState<Payer | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    shortName: '',
    payerType: 'commercial',
    state: '',
    website: '',
    phone: '',
    enrollmentPortalUrl: '',
    requiredDocumentTypes: 'w9, coi, license_copy',
    notes: '',
    isActive: true,
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchPayers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '15',
      });
      if (search) params.append('search', search);
      if (payerType !== 'all') params.append('payerType', payerType);
      if (stateFilter) params.append('state', stateFilter);

      const res = await fetch(`/api/v1/payers?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load payers');
      const data = await res.json();
      setPayers(data.payers || []);
      setTotalPages(data.pagination?.totalPages || 1);
      setTotalItems(data.pagination?.totalItems || 0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading payers');
    } finally {
      setLoading(false);
    }
  }, [search, payerType, stateFilter, page]);

  useEffect(() => {
    fetchPayers();
  }, [fetchPayers]);

  const handleOpenAdd = () => {
    setEditingPayer(null);
    setFormData({
      name: '',
      shortName: '',
      payerType: 'commercial',
      state: '',
      website: '',
      phone: '',
      enrollmentPortalUrl: '',
      requiredDocumentTypes: 'w9, coi, license_copy',
      notes: '',
      isActive: true,
    });
    setShowModal(true);
  };

  const handleOpenEdit = (p: Payer) => {
    setEditingPayer(p);
    setFormData({
      name: p.name,
      shortName: p.shortName || '',
      payerType: p.payerType || 'commercial',
      state: p.state || '',
      website: p.website || '',
      phone: p.phone || '',
      enrollmentPortalUrl: p.enrollmentPortalUrl || '',
      requiredDocumentTypes: (p.requiredDocumentTypes || []).join(', '),
      notes: p.notes || '',
      isActive: p.isActive,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const reqDocs = formData.requiredDocumentTypes
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      const payload = {
        name: formData.name,
        shortName: formData.shortName || null,
        payerType: formData.payerType,
        state: formData.state ? formData.state.toUpperCase() : null,
        website: formData.website || null,
        phone: formData.phone || null,
        enrollmentPortalUrl: formData.enrollmentPortalUrl || null,
        requiredDocumentTypes: reqDocs,
        notes: formData.notes || null,
        isActive: formData.isActive,
      };

      const url = editingPayer ? `/api/v1/payers/${editingPayer.id}` : '/api/v1/payers';
      const method = editingPayer ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to save payer');
      }

      setShowModal(false);
      fetchPayers();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error saving payer');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Insurance Payer Directory</h1>
          <p className="text-sm text-slate-500">
            Commercial, Medicare, Medicaid, and regional healthcare payers for enrollment applications.
          </p>
        </div>
        <button
          onClick={handleOpenAdd}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
        >
          + Add Payer
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-3">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search payer name, short name..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full px-3.5 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            value={payerType}
            onChange={(e) => { setPayerType(e.target.value); setPage(1); }}
            className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-700"
          >
            <option value="all">All Payer Types</option>
            <option value="commercial">Commercial</option>
            <option value="medicare">Medicare</option>
            <option value="medicaid">Medicaid</option>
            <option value="tricare">TRICARE</option>
          </select>

          <input
            type="text"
            maxLength={2}
            placeholder="State (e.g. CA)"
            value={stateFilter}
            onChange={(e) => { setStateFilter(e.target.value.toUpperCase()); setPage(1); }}
            className="w-24 px-3 py-2 text-xs border border-slate-300 rounded-lg font-mono uppercase"
          />

          {(search || payerType !== 'all' || stateFilter) && (
            <button
              onClick={() => { setSearch(''); setPayerType('all'); setStateFilter(''); setPage(1); }}
              className="px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 bg-slate-100 rounded-lg"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Main Payers Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-xs">Loading payers...</div>
        ) : error ? (
          <div className="p-8 text-center text-rose-500 text-xs">{error}</div>
        ) : payers.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs">
            No payers found in directory. Click &quot;+ Add Payer&quot; to register a payer.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-4">Payer Name</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">State</th>
                  <th className="py-3 px-4">Portal & Contact</th>
                  <th className="py-3 px-4">Required Documents</th>
                  <th className="py-3 px-4">Enrollments</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {payers.map((payer) => (
                  <tr key={payer.id} className="hover:bg-slate-50/60 transition">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900">{payer.name}</div>
                      {payer.shortName && (
                        <div className="text-[11px] font-mono text-slate-400">
                          Short: {payer.shortName}
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4 capitalize">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                        {payer.payerType || 'Commercial'}
                      </span>
                    </td>

                    <td className="py-3 px-4 font-mono font-semibold">
                      {payer.state || 'National'}
                    </td>

                    <td className="py-3 px-4">
                      {payer.enrollmentPortalUrl ? (
                        <a
                          href={payer.enrollmentPortalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline block truncate max-w-xs"
                        >
                          🌐 Portal Link
                        </a>
                      ) : (
                        <span className="text-slate-400">No portal URL</span>
                      )}
                      {payer.phone && (
                        <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                          📞 {payer.phone}
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {payer.requiredDocumentTypes.length === 0 ? (
                          <span className="text-slate-400 text-[11px]">None specified</span>
                        ) : (
                          payer.requiredDocumentTypes.map((doc) => (
                            <span
                              key={doc}
                              className="px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-mono"
                            >
                              {doc}
                            </span>
                          ))
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-4 font-bold text-slate-800">
                      {payer._count?.enrollments ?? 0}
                    </td>

                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleOpenEdit(payer)}
                        className="px-2.5 py-1 bg-white border border-slate-300 hover:border-blue-500 hover:text-blue-600 rounded text-[11px] font-medium transition"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        <div className="p-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <div>
            Page {page} of {totalPages} ({totalItems} total payers)
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

      {/* Modal: Add/Edit Payer */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-1">
              {editingPayer ? 'Edit Payer Details' : 'Register New Insurance Payer'}
            </h3>
            <p className="text-xs text-slate-500 mb-4">Payer directory entry with required enrollment checklist</p>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Payer Name *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Aetna Healthcare, Blue Cross Blue Shield"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Short Name / Code</label>
                  <input
                    type="text"
                    value={formData.shortName}
                    onChange={(e) => setFormData({ ...formData, shortName: e.target.value })}
                    placeholder="e.g. BCBS-TX"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Payer Category *</label>
                  <select
                    value={formData.payerType}
                    onChange={(e) => setFormData({ ...formData, payerType: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="commercial">Commercial</option>
                    <option value="medicare">Medicare</option>
                    <option value="medicaid">Medicaid</option>
                    <option value="tricare">TRICARE</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">State (2 Letters)</label>
                  <input
                    type="text"
                    maxLength={2}
                    value={formData.state}
                    onChange={(e) => setFormData({ ...formData, state: e.target.value.toUpperCase() })}
                    placeholder="e.g. TX (or blank)"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono uppercase"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Provider Service Phone</label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="e.g. (800) 555-1234"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Payer Portal URL</label>
                  <input
                    type="url"
                    value={formData.enrollmentPortalUrl}
                    onChange={(e) => setFormData({ ...formData, enrollmentPortalUrl: e.target.value })}
                    placeholder="https://..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Required Document Types (comma-separated checklist)
                </label>
                <input
                  type="text"
                  value={formData.requiredDocumentTypes}
                  onChange={(e) => setFormData({ ...formData, requiredDocumentTypes: e.target.value })}
                  placeholder="e.g. w9, coi, license_copy, voided_check, caqh_profile"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
                <span className="text-[10px] text-slate-400">Used for missing information verification</span>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Internal Notes</label>
                <textarea
                  rows={2}
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Application rules, payer turnaround time, contacts..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg"
                >
                  {submitting ? 'Saving...' : editingPayer ? 'Save Changes' : 'Create Payer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
