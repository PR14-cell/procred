'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface TaxonomyOption {
  code: string;
  classification: string;
  specialization: string | null;
}

interface LocationOption {
  id: string;
  name: string;
  city: string;
  state: string;
}

export default function NewProviderPage() {
  const router = useRouter();

  const [taxonomies, setTaxonomies] = useState<TaxonomyOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loadingLookups, setLoadingLookups] = useState(true);

  // Form state
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

  // Selected specialties
  const [selectedSpecialties, setSelectedSpecialties] = useState<
    Array<{ taxonomyCode: string; isPrimary: boolean }>
  >([]);

  // Selected locations
  const [selectedLocations, setSelectedLocations] = useState<
    Array<{ locationId: string; isPrimary: boolean }>
  >([]);

  // New location inline modal
  const [showNewLocationModal, setShowNewLocationModal] = useState(false);
  const [newLocationForm, setNewLocationForm] = useState({
    name: '',
    address1: '',
    city: '',
    state: '',
    zipCode: '',
    phone: '',
  });
  const [locationCreating, setLocationCreating] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load taxonomies and locations
  useEffect(() => {
    async function loadLookups() {
      try {
        setLoadingLookups(true);
        const [taxRes, locRes] = await Promise.all([
          fetch('/api/v1/taxonomy'),
          fetch('/api/v1/locations'),
        ]);

        if (taxRes.ok) {
          const taxData = await taxRes.json();
          setTaxonomies(taxData.taxonomyCodes || []);
        }
        if (locRes.ok) {
          const locData = await locRes.json();
          setLocations(locData.locations || []);
        }
      } catch (err) {
        console.error('Failed to load lookup lists:', err);
      } finally {
        setLoadingLookups(false);
      }
    }

    loadLookups();
  }, []);

  const handleTaxonomyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const code = e.target.value;
    const match = taxonomies.find((t) => t.code === code);
    setFormData((prev) => ({
      ...prev,
      primaryTaxonomy: code,
      taxonomyDescription: match ? match.specialization || match.classification : '',
    }));

    // Auto add as primary specialty if not already in list
    if (code && !selectedSpecialties.some((s) => s.taxonomyCode === code)) {
      setSelectedSpecialties((prev) => [
        ...prev.map((s) => ({ ...s, isPrimary: false })),
        { taxonomyCode: code, isPrimary: true },
      ]);
    }
  };

  const toggleSpecialty = (code: string) => {
    if (selectedSpecialties.some((s) => s.taxonomyCode === code)) {
      setSelectedSpecialties((prev) => prev.filter((s) => s.taxonomyCode !== code));
    } else {
      setSelectedSpecialties((prev) => [
        ...prev,
        { taxonomyCode: code, isPrimary: prev.length === 0 },
      ]);
    }
  };

  const setPrimarySpecialty = (code: string) => {
    setSelectedSpecialties((prev) =>
      prev.map((s) => ({
        ...s,
        isPrimary: s.taxonomyCode === code,
      }))
    );
  };

  const toggleLocation = (locationId: string) => {
    if (selectedLocations.some((l) => l.locationId === locationId)) {
      setSelectedLocations((prev) => prev.filter((l) => l.locationId !== locationId));
    } else {
      setSelectedLocations((prev) => [
        ...prev,
        { locationId, isPrimary: prev.length === 0 },
      ]);
    }
  };

  const setPrimaryLocation = (locationId: string) => {
    setSelectedLocations((prev) =>
      prev.map((l) => ({
        ...l,
        isPrimary: l.locationId === locationId,
      }))
    );
  };

  const handleCreateLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLocationCreating(true);
      const res = await fetch('/api/v1/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newLocationForm),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to create location');

      setLocations((prev) => [...prev, data.location]);
      setSelectedLocations((prev) => [
        ...prev,
        { locationId: data.location.id, isPrimary: prev.length === 0 },
      ]);
      setShowNewLocationModal(false);
      setNewLocationForm({
        name: '',
        address1: '',
        city: '',
        state: '',
        zipCode: '',
        phone: '',
      });
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error creating location');
    } finally {
      setLocationCreating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      // Validate 10-digit NPI
      if (!/^\d{10}$/.test(formData.npiNumber)) {
        throw new Error('NPI must be exactly 10 numeric digits.');
      }

      const payload = {
        ...formData,
        dateOfBirth: formData.dateOfBirth || null,
        npiEnumerationDate: formData.npiEnumerationDate || null,
        ssn: formData.ssn || null,
        email: formData.email || null,
        phone: formData.phone || null,
        specialties: selectedSpecialties,
        locationIds: selectedLocations,
      };

      const res = await fetch('/api/v1/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to create provider.');
      }

      router.push(`/providers/${data.provider.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error creating provider');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2 text-xs text-slate-500 mb-1">
            <Link href="/providers" className="hover:underline">
              Providers
            </Link>
            <span>/</span>
            <span>New Provider</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Onboard Healthcare Provider</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Register provider demographics, NPI enumeration, clinical specialties, and practice locations
          </p>
        </div>
        <Link
          href="/providers"
          className="px-3.5 py-1.5 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 transition"
        >
          Cancel
        </Link>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">
          <div className="font-semibold mb-0.5">Registration Error</div>
          <div>{error}</div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Demographics */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900">1. Personal Demographics</h2>
            <p className="text-xs text-slate-500">Legal identification and personal contact data</p>
          </div>

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
                placeholder="Jane"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Middle Name</label>
              <input
                type="text"
                value={formData.middleName}
                onChange={(e) => setFormData({ ...formData, middleName: e.target.value })}
                placeholder="Marie"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
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
                placeholder="Doe"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Suffix</label>
              <input
                type="text"
                value={formData.suffix}
                onChange={(e) => setFormData({ ...formData, suffix: e.target.value })}
                placeholder="MD, DO, NP"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
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
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Social Security Number (SSN)
              </label>
              <input
                type="password"
                value={formData.ssn}
                onChange={(e) => setFormData({ ...formData, ssn: e.target.value })}
                placeholder="XXX-XX-XXXX (AES-256 Encrypted)"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 font-mono"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                Encrypted at rest with AES-256-GCM.
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Gender</label>
              <select
                value={formData.gender}
                onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500"
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
              <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="dr.jane.doe@fictional-clinic.org"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="(555) 019-2834"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Section 2: NPI & Taxonomy */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900">2. NPI Enumeration & Classification</h2>
            <p className="text-xs text-slate-500">National Provider Identifier registered with NPPES</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                NPI Number (10 digits) <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                maxLength={10}
                value={formData.npiNumber}
                onChange={(e) => setFormData({ ...formData, npiNumber: e.target.value.replace(/\D/g, '') })}
                placeholder="1234567890"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">NPI Type</label>
              <select
                value={formData.npiType}
                onChange={(e) => setFormData({ ...formData, npiType: parseInt(e.target.value, 10) })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500"
              >
                <option value={1}>Type 1 (Individual Healthcare Provider)</option>
                <option value={2}>Type 2 (Organization / Practice Group)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Enumeration Date</label>
              <input
                type="date"
                value={formData.npiEnumerationDate}
                onChange={(e) => setFormData({ ...formData, npiEnumerationDate: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Primary Taxonomy Code</label>
              <select
                value={formData.primaryTaxonomy}
                onChange={handleTaxonomyChange}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- Select Standard Taxonomy --</option>
                {taxonomies.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.code} — {t.specialization || t.classification}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Taxonomy Description</label>
              <input
                type="text"
                value={formData.taxonomyDescription}
                onChange={(e) => setFormData({ ...formData, taxonomyDescription: e.target.value })}
                placeholder="e.g. Internal Medicine, Cardiovascular Disease"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Section 3: Multiple Specialties (Many-to-Many) */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">3. Clinical Specialties (Many-to-Many)</h2>
              <p className="text-xs text-slate-500">
                Healthcare providers can have multiple board specialties or subspecialties
              </p>
            </div>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
              {selectedSpecialties.length} Selected
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-60 overflow-y-auto p-1">
            {loadingLookups ? (
              <div className="text-xs text-slate-400 py-4">Loading taxonomy directory...</div>
            ) : (
              taxonomies.map((tax) => {
                const isSelected = selectedSpecialties.some((s) => s.taxonomyCode === tax.code);
                const isPrimary = selectedSpecialties.find((s) => s.taxonomyCode === tax.code)?.isPrimary;

                return (
                  <div
                    key={tax.code}
                    className={`p-3 rounded-lg border text-xs flex items-center justify-between transition ${
                      isSelected
                        ? 'border-blue-400 bg-blue-50/50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <label className="flex items-center space-x-2.5 cursor-pointer flex-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSpecialty(tax.code)}
                        className="rounded text-blue-600 focus:ring-blue-500"
                      />
                      <div>
                        <div className="font-semibold text-slate-800">
                          {tax.specialization || tax.classification}
                        </div>
                        <div className="text-slate-400 font-mono text-[11px]">{tax.code}</div>
                      </div>
                    </label>

                    {isSelected && (
                      <button
                        type="button"
                        onClick={() => setPrimarySpecialty(tax.code)}
                        className={`px-2 py-1 text-[11px] font-semibold rounded ${
                          isPrimary
                            ? 'bg-blue-600 text-white'
                            : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {isPrimary ? '★ Primary' : 'Make Primary'}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Section 4: Practice Locations (Many-to-Many) */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">4. Practice Locations</h2>
              <p className="text-xs text-slate-500">Physical clinics and hospital facilities where provider practices</p>
            </div>
            <button
              type="button"
              onClick={() => setShowNewLocationModal(true)}
              className="text-xs font-semibold px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
            >
              + Add New Location
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-60 overflow-y-auto p-1">
            {locations.length === 0 ? (
              <div className="col-span-2 text-center py-6 text-slate-400 text-xs">
                No practice locations created yet. Click &quot;Add New Location&quot; above to create one.
              </div>
            ) : (
              locations.map((loc) => {
                const isSelected = selectedLocations.some((l) => l.locationId === loc.id);
                const isPrimary = selectedLocations.find((l) => l.locationId === loc.id)?.isPrimary;

                return (
                  <div
                    key={loc.id}
                    className={`p-3 rounded-lg border text-xs flex items-center justify-between transition ${
                      isSelected
                        ? 'border-indigo-400 bg-indigo-50/50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <label className="flex items-center space-x-2.5 cursor-pointer flex-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleLocation(loc.id)}
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <div className="font-semibold text-slate-800">{loc.name}</div>
                        <div className="text-slate-400 text-[11px]">
                          {loc.city}, {loc.state}
                        </div>
                      </div>
                    </label>

                    {isSelected && (
                      <button
                        type="button"
                        onClick={() => setPrimaryLocation(loc.id)}
                        className={`px-2 py-1 text-[11px] font-semibold rounded ${
                          isPrimary
                            ? 'bg-indigo-600 text-white'
                            : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {isPrimary ? '★ Primary' : 'Make Primary'}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Section 5: Credentialing & Status */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900">5. Credentialing Details & Status</h2>
            <p className="text-xs text-slate-500">CAQH ProView identifier and initial operational status</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">CAQH Provider ID</label>
              <input
                type="text"
                value={formData.caqhId}
                onChange={(e) => setFormData({ ...formData, caqhId: e.target.value })}
                placeholder="e.g. 12948201"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Provider Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500"
              >
                <option value="active">Active (Currently practicing)</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Credentialing Status</label>
              <select
                value={formData.credentialingStatus}
                onChange={(e) => setFormData({ ...formData, credentialingStatus: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500"
              >
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed / Approved</option>
                <option value="needs_review">Needs Review</option>
                <option value="initial">Initial Intake</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Internal Notes</label>
            <textarea
              rows={3}
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Add any internal onboarding notes or initial payer requirements..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Submit Actions */}
        <div className="flex items-center justify-end space-x-3 pt-2">
          <Link
            href="/providers"
            className="px-5 py-2.5 border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50 transition"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition disabled:opacity-50"
          >
            {submitting ? 'Creating Provider...' : 'Complete Provider Registration'}
          </button>
        </div>
      </form>

      {/* Modal: Quick Add Location */}
      {showNewLocationModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-3">Add Practice Location</h3>
            <form onSubmit={handleCreateLocation} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Location Name *</label>
                <input
                  type="text"
                  required
                  value={newLocationForm.name}
                  onChange={(e) => setNewLocationForm({ ...newLocationForm, name: e.target.value })}
                  placeholder="e.g. Westside Family Clinic"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Street Address *</label>
                <input
                  type="text"
                  required
                  value={newLocationForm.address1}
                  onChange={(e) => setNewLocationForm({ ...newLocationForm, address1: e.target.value })}
                  placeholder="123 Medical Center Blvd"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">City *</label>
                  <input
                    type="text"
                    required
                    value={newLocationForm.city}
                    onChange={(e) => setNewLocationForm({ ...newLocationForm, city: e.target.value })}
                    placeholder="Austin"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">State *</label>
                  <input
                    type="text"
                    required
                    maxLength={2}
                    value={newLocationForm.state}
                    onChange={(e) => setNewLocationForm({ ...newLocationForm, state: e.target.value.toUpperCase() })}
                    placeholder="TX"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Zip *</label>
                  <input
                    type="text"
                    required
                    maxLength={10}
                    value={newLocationForm.zipCode}
                    onChange={(e) => setNewLocationForm({ ...newLocationForm, zipCode: e.target.value })}
                    placeholder="78701"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Phone</label>
                <input
                  type="tel"
                  value={newLocationForm.phone}
                  onChange={(e) => setNewLocationForm({ ...newLocationForm, phone: e.target.value })}
                  placeholder="(555) 012-3456"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowNewLocationModal(false)}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 text-xs rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={locationCreating}
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg disabled:opacity-50"
                >
                  {locationCreating ? 'Saving...' : 'Add Location'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
