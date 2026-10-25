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

interface PayerOption {
  id: string;
  name: string;
  shortName: string | null;
  payerType: string;
  state: string | null;
  isActive: boolean;
}

interface SelectedPayerEnrollment {
  payerId: string;
  enrollmentType: 'individual' | 'group';
  status: string;
  notes?: string;
}

interface OrganizationOption {
  id: string;
  name: string;
  dbaName: string | null;
  npiNumber: string | null;
  city: string;
  state: string;
}

export default function NewProviderPage() {
  const router = useRouter();

  const [taxonomies, setTaxonomies] = useState<TaxonomyOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [payers, setPayers] = useState<PayerOption[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [loadingLookups, setLoadingLookups] = useState(true);

  // Group / Organization affiliation state
  const [affiliationMode, setAffiliationMode] = useState<'none' | 'existing' | 'new'>('none');
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('');
  const [orgSearch, setOrgSearch] = useState('');
  const [employmentType, setEmploymentType] = useState('employed');
  const [newOrgForm, setNewOrgForm] = useState({
    name: '',
    dbaName: '',
    npiNumber: '',
    taxId: '',
    organizationType: 'medical_group',
    address1: '',
    city: '',
    state: 'TX',
    zipCode: '',
    phone: '',
    email: '',
  });

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

  // Selected payors / payer enrollments
  const [selectedPayers, setSelectedPayers] = useState<SelectedPayerEnrollment[]>([]);
  const [currentPayerId, setCurrentPayerId] = useState('');
  const [currentEnrollmentType, setCurrentEnrollmentType] = useState<'individual' | 'group'>('individual');
  const [currentStatus, setCurrentStatus] = useState('not_started');
  const [payerSearch, setPayerSearch] = useState('');

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

  // Load taxonomies, locations, payers, and organizations
  useEffect(() => {
    async function loadLookups() {
      try {
        setLoadingLookups(true);
        const [taxRes, locRes, payRes, orgRes] = await Promise.all([
          fetch('/api/v1/taxonomy'),
          fetch('/api/v1/locations'),
          fetch('/api/v1/payers?limit=100&isActive=true'),
          fetch('/api/v1/organizations?limit=100&status=active'),
        ]);

        if (taxRes.ok) {
          const taxData = await taxRes.json();
          setTaxonomies(taxData.taxonomyCodes || []);
        }
        if (locRes.ok) {
          const locData = await locRes.json();
          setLocations(locData.locations || []);
        }
        if (payRes.ok) {
          const payData = await payRes.json();
          setPayers(payData.payers || []);
        }
        if (orgRes.ok) {
          const orgData = await orgRes.json();
          setOrganizations(orgData.organizations || []);
        }
      } catch (err) {
        console.error('Failed to load lookup lists:', err);
      } finally {
        setLoadingLookups(false);
      }
    }

    loadLookups();
  }, []);

  const handleAddPayer = () => {
    if (!currentPayerId) return;
    if (selectedPayers.some((sp) => sp.payerId === currentPayerId)) return;

    setSelectedPayers((prev) => [
      ...prev,
      {
        payerId: currentPayerId,
        enrollmentType: currentEnrollmentType,
        status: currentStatus,
      },
    ]);
    setCurrentPayerId('');
    setCurrentEnrollmentType('individual');
    setCurrentStatus('not_started');
  };

  const handleRemovePayer = (payerId: string) => {
    setSelectedPayers((prev) => prev.filter((sp) => sp.payerId !== payerId));
  };

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

      // Validate organization affiliation
      if (affiliationMode === 'existing') {
        if (!selectedOrganizationId) {
          throw new Error('Please select an existing organization from the list or choose Solo / Independent.');
        }
      } else if (affiliationMode === 'new') {
        if (!newOrgForm.name.trim()) {
          throw new Error('Organization legal name is required when creating a new organization.');
        }
        if (
          !newOrgForm.address1.trim() ||
          !newOrgForm.city.trim() ||
          !newOrgForm.state.trim() ||
          !newOrgForm.zipCode.trim()
        ) {
          throw new Error('Address, city, state, and zip code are required for the new organization.');
        }
        if (newOrgForm.npiNumber && !/^\d{10}$/.test(newOrgForm.npiNumber.trim())) {
          throw new Error('Group NPI must be exactly 10 digits.');
        }
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
        organizationAffiliation: {
          mode: affiliationMode,
          organizationId: affiliationMode === 'existing' ? selectedOrganizationId : null,
          isPrimary: true,
          employmentType: affiliationMode !== 'none' ? employmentType : null,
          newOrganization:
            affiliationMode === 'new'
              ? {
                  ...newOrgForm,
                  npiNumber: newOrgForm.npiNumber || null,
                  taxId: newOrgForm.taxId || null,
                  dbaName: newOrgForm.dbaName || null,
                  phone: newOrgForm.phone || null,
                  email: newOrgForm.email || null,
                }
              : undefined,
        },
        payerEnrollments: selectedPayers.map((sp) => ({
          payerId: sp.payerId,
          enrollmentType: sp.enrollmentType,
          status: sp.status,
          notes: sp.notes || null,
        })),
        payerIds: selectedPayers.map((sp) => sp.payerId),
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

        {/* Section 5: Group / Organization Affiliation */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-5">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">5. Group / Organization Affiliation</h2>
              <p className="text-xs text-slate-500">
                Affiliate provider to a medical group, health system, or onboard as an independent solo practitioner
              </p>
            </div>
            <span
              className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                affiliationMode === 'none'
                  ? 'bg-slate-100 text-slate-700 border-slate-200'
                  : affiliationMode === 'existing'
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}
            >
              {affiliationMode === 'none' && 'Solo / Independent'}
              {affiliationMode === 'existing' && 'Affiliate Existing Group'}
              {affiliationMode === 'new' && 'Create & Affiliate New Group'}
            </span>
          </div>

          {/* Three Mode Selection Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label
              className={`p-4 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                affiliationMode === 'none'
                  ? 'border-blue-500 bg-blue-50/40 ring-2 ring-blue-500/20'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">Solo / Independent</span>
                  <input
                    type="radio"
                    name="affiliationMode"
                    value="none"
                    checked={affiliationMode === 'none'}
                    onChange={() => setAffiliationMode('none')}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                  />
                </div>
                <p className="text-xs text-slate-500">
                  Provider bills individually or organization affiliation will be assigned later.
                </p>
              </div>
              <div className="mt-3 text-[11px] font-medium text-slate-400">Option C: Individual</div>
            </label>

            <label
              className={`p-4 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                affiliationMode === 'existing'
                  ? 'border-blue-500 bg-blue-50/40 ring-2 ring-blue-500/20'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">Select Existing Group</span>
                  <input
                    type="radio"
                    name="affiliationMode"
                    value="existing"
                    checked={affiliationMode === 'existing'}
                    onChange={() => setAffiliationMode('existing')}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                  />
                </div>
                <p className="text-xs text-slate-500">
                  Select an established medical group or organization from the system directory.
                </p>
              </div>
              <div className="mt-3 text-[11px] font-medium text-blue-600">Option B: Existing Organization</div>
            </label>

            <label
              className={`p-4 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                affiliationMode === 'new'
                  ? 'border-blue-500 bg-blue-50/40 ring-2 ring-blue-500/20'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">Create New Group</span>
                  <input
                    type="radio"
                    name="affiliationMode"
                    value="new"
                    checked={affiliationMode === 'new'}
                    onChange={() => setAffiliationMode('new')}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                  />
                </div>
                <p className="text-xs text-slate-500">
                  Register a new practice or group and immediately associate this provider.
                </p>
              </div>
              <div className="mt-3 text-[11px] font-medium text-emerald-600">Option A: New Organization</div>
            </label>
          </div>

          {/* Option B: Existing Group Selection */}
          {affiliationMode === 'existing' && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800">Choose Group from Organization Directory</span>
                <span className="text-xs text-slate-500">{organizations.length} available</span>
              </div>

              <div className="relative">
                <input
                  type="text"
                  placeholder="Filter groups by name, DBA, NPI, or city..."
                  value={orgSearch}
                  onChange={(e) => setOrgSearch(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500"
                />
                {orgSearch && (
                  <button
                    type="button"
                    onClick={() => setOrgSearch('')}
                    className="absolute right-2.5 top-2 text-xs text-slate-400 hover:text-slate-600"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="max-h-56 overflow-y-auto space-y-2 border border-slate-200 bg-white rounded-lg p-2">
                {organizations.length === 0 ? (
                  <div className="text-xs text-slate-400 p-4 text-center">
                    No active organizations found in directory. Use Option A to create a new group.
                  </div>
                ) : (
                  organizations
                    .filter((org) => {
                      if (!orgSearch) return true;
                      const q = orgSearch.toLowerCase();
                      return (
                        org.name.toLowerCase().includes(q) ||
                        (org.dbaName && org.dbaName.toLowerCase().includes(q)) ||
                        (org.npiNumber && org.npiNumber.includes(q)) ||
                        org.city.toLowerCase().includes(q)
                      );
                    })
                    .map((org) => {
                      const isSelected = selectedOrganizationId === org.id;
                      return (
                        <div
                          key={org.id}
                          onClick={() => setSelectedOrganizationId(org.id)}
                          className={`p-3 rounded-lg border cursor-pointer transition flex items-center justify-between ${
                            isSelected
                              ? 'border-blue-500 bg-blue-50/50'
                              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <div className="space-y-0.5">
                            <div className="text-xs font-bold text-slate-900 flex items-center space-x-2">
                              <span>{org.name}</span>
                              {org.dbaName && (
                                <span className="text-[11px] font-normal text-slate-500">({org.dbaName})</span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 flex items-center space-x-3">
                              <span>
                                NPI: <strong className="font-mono text-slate-700">{org.npiNumber || 'N/A'}</strong>
                              </span>
                              <span>•</span>
                              <span>
                                {org.city}, {org.state}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            {isSelected ? (
                              <span className="px-2.5 py-1 bg-blue-600 text-white rounded text-[11px] font-semibold">
                                ✓ Selected
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="px-2.5 py-1 border border-slate-300 text-slate-700 rounded text-[11px] hover:bg-white"
                              >
                                Select
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-200">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Provider Employment Type</label>
                  <select
                    value={employmentType}
                    onChange={(e) => setEmploymentType(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                  >
                    <option value="employed">W-2 Employed</option>
                    <option value="contractor">1099 Independent Contractor</option>
                    <option value="affiliate">Affiliated Staff</option>
                    <option value="owner">Partner / Owner</option>
                    <option value="locum_tenens">Locum Tenens</option>
                  </select>
                </div>
                <div className="flex items-center pt-5">
                  <span className="text-xs text-slate-600 flex items-center space-x-2">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>Will be registered as provider&apos;s primary organization affiliation</span>
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Option A: Create New Group Inline */}
          {affiliationMode === 'new' && (
            <div className="p-4 bg-emerald-50/40 border border-emerald-200 rounded-xl space-y-4">
              <div className="flex items-center justify-between border-b border-emerald-100 pb-2">
                <div>
                  <span className="text-xs font-bold text-slate-800">New Healthcare Organization Information</span>
                  <p className="text-[11px] text-slate-500">
                    This organization will be created in the directory and associated with this provider
                  </p>
                </div>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                  New Entity
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Organization Legal Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required={affiliationMode === 'new'}
                    value={newOrgForm.name}
                    onChange={(e) => setNewOrgForm({ ...newOrgForm, name: e.target.value })}
                    placeholder="e.g. Austin Regional Clinic, P.A."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Doing Business As (DBA) / Practice Name
                  </label>
                  <input
                    type="text"
                    value={newOrgForm.dbaName}
                    onChange={(e) => setNewOrgForm({ ...newOrgForm, dbaName: e.target.value })}
                    placeholder="e.g. ARC South Austin"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Type 2 Group NPI (10 digits)
                  </label>
                  <input
                    type="text"
                    maxLength={10}
                    value={newOrgForm.npiNumber}
                    onChange={(e) => setNewOrgForm({ ...newOrgForm, npiNumber: e.target.value.replace(/\D/g, '') })}
                    placeholder="e.g. 1982736450"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white font-mono focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Federal Tax ID (EIN)
                  </label>
                  <input
                    type="text"
                    maxLength={10}
                    value={newOrgForm.taxId}
                    onChange={(e) => setNewOrgForm({ ...newOrgForm, taxId: e.target.value })}
                    placeholder="XX-XXXXXXX"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white font-mono focus:ring-2 focus:ring-emerald-500"
                  />
                  <span className="text-[10px] text-slate-400">Encrypted with AES-256-GCM at rest</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Organization Type</label>
                  <select
                    value={newOrgForm.organizationType}
                    onChange={(e) => setNewOrgForm({ ...newOrgForm, organizationType: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="medical_group">Medical Group / Practice</option>
                    <option value="hospital_system">Hospital / Health System</option>
                    <option value="solo_practice">Solo Practice Entity</option>
                    <option value="clinic">Clinic / Urgent Care</option>
                    <option value="ipa">Independent Physician Association (IPA)</option>
                    <option value="asc">Ambulatory Surgery Center (ASC)</option>
                    <option value="other">Other Healthcare Organization</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Provider Employment Type</label>
                  <select
                    value={employmentType}
                    onChange={(e) => setEmploymentType(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="employed">W-2 Employed</option>
                    <option value="contractor">1099 Independent Contractor</option>
                    <option value="affiliate">Affiliated Staff</option>
                    <option value="owner">Partner / Owner</option>
                    <option value="locum_tenens">Locum Tenens</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Organization Street Address <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required={affiliationMode === 'new'}
                  value={newOrgForm.address1}
                  onChange={(e) => setNewOrgForm({ ...newOrgForm, address1: e.target.value })}
                  placeholder="e.g. 500 Congress Ave, Suite 100"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    City <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required={affiliationMode === 'new'}
                    value={newOrgForm.city}
                    onChange={(e) => setNewOrgForm({ ...newOrgForm, city: e.target.value })}
                    placeholder="Austin"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    State <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required={affiliationMode === 'new'}
                    maxLength={2}
                    value={newOrgForm.state}
                    onChange={(e) => setNewOrgForm({ ...newOrgForm, state: e.target.value.toUpperCase() })}
                    placeholder="TX"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white font-mono focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Zip Code <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required={affiliationMode === 'new'}
                    maxLength={10}
                    value={newOrgForm.zipCode}
                    onChange={(e) => setNewOrgForm({ ...newOrgForm, zipCode: e.target.value })}
                    placeholder="78701"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white font-mono focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Organization Phone</label>
                  <input
                    type="tel"
                    value={newOrgForm.phone}
                    onChange={(e) => setNewOrgForm({ ...newOrgForm, phone: e.target.value })}
                    placeholder="(512) 555-0199"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Organization Email</label>
                  <input
                    type="email"
                    value={newOrgForm.email}
                    onChange={(e) => setNewOrgForm({ ...newOrgForm, email: e.target.value })}
                    placeholder="credentialing@arc-health.com"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Section 6: Credentialing & Status */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900">6. Credentialing Details & Status</h2>
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

        {/* Section 7: Payors / Payer Enrollment (Phase 4 Integration) */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">7. Payors / Payer Enrollment</h2>
              <p className="text-xs text-slate-500">
                Associate payors to initiate payer credentialing and enrollment applications
              </p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full border border-blue-200">
              {selectedPayers.length} {selectedPayers.length === 1 ? 'Payor' : 'Payors'} Selected
            </span>
          </div>

          {/* Search & Add Payor Controls */}
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 space-y-3">
            <div className="text-xs font-semibold text-slate-700">Select Existing Payor from Directory</div>

            {/* Quick search input */}
            <div className="relative">
              <input
                type="text"
                placeholder="Filter payor options by name or code..."
                value={payerSearch}
                onChange={(e) => setPayerSearch(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500"
              />
              {payerSearch && (
                <button
                  type="button"
                  onClick={() => setPayerSearch('')}
                  className="absolute right-2.5 top-1.5 text-xs text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-5">
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Payor <span className="text-rose-500">*</span>
                </label>
                <select
                  value={currentPayerId}
                  onChange={(e) => setCurrentPayerId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Choose a Payor --</option>
                  {payers
                    .filter((p) => {
                      if (selectedPayers.some((sp) => sp.payerId === p.id)) return false;
                      if (!payerSearch.trim()) return true;
                      const q = payerSearch.toLowerCase();
                      return (
                        p.name.toLowerCase().includes(q) ||
                        (p.shortName && p.shortName.toLowerCase().includes(q)) ||
                        (p.state && p.state.toLowerCase().includes(q))
                      );
                    })
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.shortName ? `(${p.shortName})` : ''} {p.state ? `• ${p.state}` : ''}
                      </option>
                    ))}
                </select>
              </div>

              <div className="md:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Enrollment Type</label>
                <select
                  value={currentEnrollmentType}
                  onChange={(e) => setCurrentEnrollmentType(e.target.value as 'individual' | 'group')}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500"
                >
                  <option value="individual">Individual</option>
                  <option value="group">Group / Clinic</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Initial Status</label>
                <select
                  value={currentStatus}
                  onChange={(e) => setCurrentStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500"
                >
                  <option value="not_started">Not Started</option>
                  <option value="in_progress">In Progress</option>
                  <option value="submitted">Submitted</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <button
                  type="button"
                  onClick={handleAddPayer}
                  disabled={!currentPayerId}
                  className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm transition"
                >
                  + Add Payor
                </button>
              </div>
            </div>

            {/* Note about Payor Directory */}
            <div className="text-[11px] text-slate-500 flex items-center justify-between pt-1">
              <span>
                Note: Payors must be registered in the Payers Directory. If a payor is not listed, an administrator can register it via Payers Directory.
              </span>
              <Link href="/admin/payers" target="_blank" className="text-blue-600 hover:underline">
                View Payers Directory ↗
              </Link>
            </div>
          </div>

          {/* Selected Payors Review Table */}
          {selectedPayers.length === 0 ? (
            <div className="text-center py-6 px-4 bg-slate-50/50 border border-dashed border-slate-200 rounded-lg text-xs text-slate-500">
              No payors selected yet. You can associate one or more payors to initiate payer enrollment, or onboard without payors and enroll later in the Payer Enrollment module.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 text-slate-600 uppercase text-[10px] tracking-wider font-semibold">
                  <tr>
                    <th className="px-4 py-2.5">Payor Name</th>
                    <th className="px-3 py-2.5">Code / State</th>
                    <th className="px-3 py-2.5">Type</th>
                    <th className="px-3 py-2.5">Initial Status</th>
                    <th className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedPayers.map((sp) => {
                    const payer = payers.find((p) => p.id === sp.payerId);
                    return (
                      <tr key={sp.payerId} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-medium text-slate-800">
                          {payer ? payer.name : sp.payerId}
                        </td>
                        <td className="px-3 py-2.5 text-slate-500">
                          {payer?.shortName || '—'} {payer?.state ? `(${payer.state})` : ''}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="capitalize px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-700">
                            {sp.enrollmentType}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                            {sp.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => handleRemovePayer(sp.payerId)}
                            className="text-rose-600 hover:text-rose-800 font-medium text-xs hover:underline"
                          >
                            ✕ Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
