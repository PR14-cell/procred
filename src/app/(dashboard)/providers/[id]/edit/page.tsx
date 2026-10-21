'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

export default function EditProviderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const providerId = params?.id;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    firstName: '',
    middleName: '',
    lastName: '',
    suffix: '',
    dateOfBirth: '',
    ssn: '',
    gender: 'Male',
    email: '',
    phone: '',
    npiNumber: '',
    npiType: 1,
    npiEnumerationDate: '',
    primaryTaxonomy: '',
    taxonomyDescription: '',
    caqhId: '',
    status: 'active',
    credentialingStatus: 'in_progress',
    notes: '',
  });

  useEffect(() => {
    async function loadProvider() {
      if (!providerId) return;
      try {
        setLoading(true);
        const res = await fetch(`/api/v1/providers/${providerId}`);
        if (!res.ok) throw new Error('Failed to load provider');
        const data = await res.json();
        const p = data.provider;

        setFormData({
          firstName: p.firstName || '',
          middleName: p.middleName || '',
          lastName: p.lastName || '',
          suffix: p.suffix || '',
          dateOfBirth: p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : '',
          ssn: '', // SSN blank by default unless updating
          gender: p.gender || 'Male',
          email: p.email || '',
          phone: p.phone || '',
          npiNumber: p.npiNumber || '',
          npiType: p.npiType || 1,
          npiEnumerationDate: p.npiEnumerationDate ? p.npiEnumerationDate.slice(0, 10) : '',
          primaryTaxonomy: p.primaryTaxonomy || '',
          taxonomyDescription: p.taxonomyDescription || '',
          caqhId: p.caqhId || '',
          status: p.status || 'active',
          credentialingStatus: p.credentialingStatus || 'in_progress',
          notes: p.notes || '',
        });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Error loading provider data');
      } finally {
        setLoading(false);
      }
    }

    loadProvider();
  }, [providerId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (!/^\d{10}$/.test(formData.npiNumber)) {
        throw new Error('NPI must be exactly 10 numeric digits.');
      }

      const payload: Record<string, unknown> = {
        ...formData,
        dateOfBirth: formData.dateOfBirth || null,
        npiEnumerationDate: formData.npiEnumerationDate || null,
        email: formData.email || null,
        phone: formData.phone || null,
      };

      // Only include SSN in payload if user entered a new value
      if (!formData.ssn) {
        delete payload.ssn;
      }

      const res = await fetch(`/api/v1/providers/${providerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to update provider.');
      }

      router.push(`/providers/${providerId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error updating provider');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center text-slate-400">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent mb-3"></div>
        <div>Loading provider details...</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2 text-xs text-slate-500 mb-1">
            <Link href="/providers" className="hover:underline">
              Providers
            </Link>
            <span>/</span>
            <Link href={`/providers/${providerId}`} className="hover:underline">
              {formData.firstName} {formData.lastName}
            </Link>
            <span>/</span>
            <span>Edit</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Edit Provider Profile</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Update personal demographics, NPI classification, or credentialing status
          </p>
        </div>
        <Link
          href={`/providers/${providerId}`}
          className="px-3.5 py-1.5 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 transition"
        >
          Cancel
        </Link>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">
          <div className="font-semibold mb-0.5">Update Failed</div>
          <div>{error}</div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Demographics Card */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
            1. Personal Demographics
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                First Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Middle Name</label>
              <input
                type="text"
                value={formData.middleName}
                onChange={(e) => setFormData({ ...formData, middleName: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Last Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.lastName}
                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Suffix</label>
              <input
                type="text"
                value={formData.suffix}
                onChange={(e) => setFormData({ ...formData, suffix: e.target.value })}
                placeholder="MD, DO"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Date of Birth</label>
              <input
                type="date"
                value={formData.dateOfBirth}
                onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Update SSN</label>
              <input
                type="password"
                value={formData.ssn}
                onChange={(e) => setFormData({ ...formData, ssn: e.target.value })}
                placeholder="Leave blank to keep existing"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                Leave blank unless updating encrypted SSN.
              </span>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Gender</label>
              <select
                value={formData.gender}
                onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
              >
                <option value="Female">Female</option>
                <option value="Male">Male</option>
                <option value="Non-Binary">Non-Binary</option>
                <option value="Undisclosed">Undisclosed</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Phone</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
          </div>
        </div>

        {/* NPI & Taxonomy Card */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
            2. NPI & Classification
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                NPI Number <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                maxLength={10}
                value={formData.npiNumber}
                onChange={(e) => setFormData({ ...formData, npiNumber: e.target.value.replace(/\D/g, '') })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">NPI Type</label>
              <select
                value={formData.npiType}
                onChange={(e) => setFormData({ ...formData, npiType: parseInt(e.target.value, 10) })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
              >
                <option value={1}>Type 1 (Individual Provider)</option>
                <option value={2}>Type 2 (Organization)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Enumeration Date</label>
              <input
                type="date"
                value={formData.npiEnumerationDate}
                onChange={(e) => setFormData({ ...formData, npiEnumerationDate: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Primary Taxonomy Code</label>
              <input
                type="text"
                value={formData.primaryTaxonomy}
                onChange={(e) => setFormData({ ...formData, primaryTaxonomy: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Taxonomy Description</label>
              <input
                type="text"
                value={formData.taxonomyDescription}
                onChange={(e) => setFormData({ ...formData, taxonomyDescription: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
          </div>
        </div>

        {/* Status Card */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
            3. Operational & Credentialing Status
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Provider Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Credentialing Status</label>
              <select
                value={formData.credentialingStatus}
                onChange={(e) => setFormData({ ...formData, credentialingStatus: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
              >
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed / Approved</option>
                <option value="needs_review">Needs Review</option>
                <option value="initial">Initial Intake</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">CAQH Provider ID</label>
              <input
                type="text"
                value={formData.caqhId}
                onChange={(e) => setFormData({ ...formData, caqhId: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Internal Notes</label>
            <textarea
              rows={3}
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
        </div>

        {/* Submit Actions */}
        <div className="flex items-center justify-end space-x-3 pt-2">
          <Link
            href={`/providers/${providerId}`}
            className="px-5 py-2.5 border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50 transition"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition disabled:opacity-50"
          >
            {submitting ? 'Saving Changes...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
