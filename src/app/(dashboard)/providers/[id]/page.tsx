'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

interface TaxonomyCode {
  code: string;
  classification: string;
  specialization: string | null;
}

interface SpecialtyLink {
  id: string;
  taxonomyCode: string;
  isPrimary: boolean;
  taxonomy: TaxonomyCode;
}

interface LocationLink {
  id: string;
  locationId: string;
  isPrimary: boolean;
  location: {
    id: string;
    name: string;
    address1: string;
    city: string;
    state: string;
    zipCode: string;
    phone: string | null;
  };
}

interface StateLicenseItem {
  id: string;
  state: string;
  licenseNumber: string;
  licenseType: string | null;
  status: string;
  expirationDate: string | null;
  verified: boolean;
}

interface DeaItem {
  id: string;
  deaNumber: string;
  state: string | null;
  status: string;
  expirationDate: string | null;
  verified: boolean;
}

interface BoardCertItem {
  id: string;
  boardName: string;
  specialty: string;
  status: string;
  expirationDate: string | null;
  verified: boolean;
}

interface MalpracticeItem {
  id: string;
  carrierName: string;
  policyNumber: string | null;
  expirationDate: string | null;
  status: string;
}

interface CaqhItem {
  id: string;
  caqhId: string;
  nextAttestationDate: string | null;
  attestationStatus: string;
}

interface AuditItem {
  id: string;
  userEmail: string | null;
  action: string;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  createdAt: string;
}

interface ProviderProfile {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  ssn: string | null;
  hasSsn: boolean;
  email: string | null;
  phone: string | null;
  npiNumber: string;
  npiType: number | null;
  npiEnumerationDate: string | null;
  primaryTaxonomy: string | null;
  taxonomyDescription: string | null;
  caqhId: string | null;
  status: string;
  credentialingStatus: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  specialties: SpecialtyLink[];
  locations: LocationLink[];
  stateLicenses: StateLicenseItem[];
  deaRegistrations: DeaItem[];
  boardCertifications: BoardCertItem[];
  malpracticePolicies: MalpracticeItem[];
  caqhProfile: CaqhItem | null;
  enrollments: Array<{
    id: string;
    status: string;
    effectiveDate: string | null;
    payer: { name: string };
  }>;
}

export default function ProviderProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const providerId = params?.id;

  const [provider, setProvider] = useState<ProviderProfile | null>(null);
  const [auditHistory, setAuditHistory] = useState<AuditItem[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'specialties' | 'locations' | 'credentials' | 'enrollments' | 'audit'>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reveal SSN state
  const [revealingSsn, setRevealingSsn] = useState(false);
  const [unmaskedSsn, setUnmaskedSsn] = useState<string | null>(null);

  // Add Specialty Modal
  const [showAddSpecialtyModal, setShowAddSpecialtyModal] = useState(false);
  const [allTaxonomies, setAllTaxonomies] = useState<TaxonomyCode[]>([]);
  const [newSpecialtyCode, setNewSpecialtyCode] = useState('');
  const [newSpecialtyPrimary, setNewSpecialtyPrimary] = useState(false);

  // Link Location Modal
  const [showLinkLocationModal, setShowLinkLocationModal] = useState(false);
  const [allLocations, setAllLocations] = useState<Array<{ id: string; name: string; city: string; state: string }>>([]);
  const [newLocationId, setNewLocationId] = useState('');
  const [newLocationPrimary, setNewLocationPrimary] = useState(false);

  const fetchProvider = useCallback(async () => {
    if (!providerId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/v1/providers/${providerId}`);
      if (!res.ok) {
        throw new Error('Failed to load provider profile');
      }
      const data = await res.json();
      setProvider(data.provider);
      setAuditHistory(data.auditHistory || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading provider');
    } finally {
      setLoading(false);
    }
  }, [providerId]);

  useEffect(() => {
    fetchProvider();
  }, [fetchProvider]);

  // Load lookup data for modals
  const loadLookups = async () => {
    try {
      const [taxRes, locRes] = await Promise.all([
        fetch('/api/v1/taxonomy'),
        fetch('/api/v1/locations'),
      ]);
      if (taxRes.ok) {
        const taxData = await taxRes.json();
        setAllTaxonomies(taxData.taxonomyCodes || []);
      }
      if (locRes.ok) {
        const locData = await locRes.json();
        setAllLocations(locData.locations || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRevealSsn = async () => {
    if (unmaskedSsn) {
      setUnmaskedSsn(null);
      return;
    }
    try {
      setRevealingSsn(true);
      const res = await fetch(`/api/v1/providers/${providerId}?revealSsn=true`);
      if (!res.ok) throw new Error('Unable to decrypt SSN or unauthorized');
      const data = await res.json();
      setUnmaskedSsn(data.provider.ssn);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Could not reveal SSN');
    } finally {
      setRevealingSsn(false);
    }
  };

  const handleAddSpecialty = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`/api/v1/providers/${providerId}/specialties`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taxonomyCode: newSpecialtyCode,
          isPrimary: newSpecialtyPrimary,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to add specialty');
      setShowAddSpecialtyModal(false);
      setNewSpecialtyCode('');
      setNewSpecialtyPrimary(false);
      fetchProvider();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error adding specialty');
    }
  };

  const handleRemoveSpecialty = async (taxonomyCode: string) => {
    if (!confirm(`Are you sure you want to remove specialty code ${taxonomyCode}?`)) return;
    try {
      const res = await fetch(`/api/v1/providers/${providerId}/specialties?taxonomyCode=${taxonomyCode}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to remove specialty');
      }
      fetchProvider();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error removing specialty');
    }
  };

  const handleLinkLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`/api/v1/providers/${providerId}/locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: newLocationId,
          isPrimary: newLocationPrimary,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to link location');
      setShowLinkLocationModal(false);
      setNewLocationId('');
      setNewLocationPrimary(false);
      fetchProvider();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error linking location');
    }
  };

  const handleUnlinkLocation = async (locationId: string, locationName: string) => {
    if (!confirm(`Are you sure you want to unlink location '${locationName}'?`)) return;
    try {
      const res = await fetch(`/api/v1/providers/${providerId}/locations?locationId=${locationId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to unlink location');
      }
      fetchProvider();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error unlinking location');
    }
  };

  const handleArchive = async () => {
    if (!provider) return;
    const name = `${provider.firstName} ${provider.lastName}`;
    if (!confirm(`Are you sure you want to archive provider ${name}?`)) return;
    try {
      const res = await fetch(`/api/v1/providers/${provider.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to archive');
      }
      router.push('/providers');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error archiving');
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center text-slate-400">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent mb-3"></div>
        <div>Loading provider profile...</div>
      </div>
    );
  }

  if (error || !provider) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 text-red-700 rounded-xl">
        <h2 className="font-bold text-base mb-1">Provider Not Found</h2>
        <p className="text-sm">{error || 'The requested provider could not be found.'}</p>
        <Link href="/providers" className="mt-4 inline-block text-xs font-semibold text-blue-600 hover:underline">
          ← Return to Provider Directory
        </Link>
      </div>
    );
  }

  const fullName = `${provider.firstName} ${provider.middleName ? `${provider.middleName} ` : ''}${provider.lastName}${
    provider.suffix ? `, ${provider.suffix}` : ''
  }`;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Breadcrumb & Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2 text-xs text-slate-500">
          <Link href="/providers" className="hover:underline">
            Providers
          </Link>
          <span>/</span>
          <span className="font-medium text-slate-800">{fullName}</span>
        </div>
        <Link
          href="/providers"
          className="text-xs text-blue-600 hover:underline flex items-center space-x-1"
        >
          <span>← Back to Directory</span>
        </Link>
      </div>

      {/* Provider Hero Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-start space-x-4">
          <div className="w-14 h-14 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xl shrink-0">
            {provider.firstName[0]}
            {provider.lastName[0]}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold text-slate-900">{fullName}</h1>
              <span
                className={`px-2.5 py-0.5 rounded text-xs font-semibold capitalize ${
                  provider.status === 'active'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : provider.status === 'archived'
                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                    : 'bg-slate-100 text-slate-600 border border-slate-200'
                }`}
              >
                {provider.status}
              </span>
              <span className="px-2.5 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                Cred: {provider.credentialingStatus.replace('_', ' ')}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 mt-2">
              <div>
                NPI: <span className="font-mono font-bold text-slate-800">{provider.npiNumber}</span>
              </div>
              <div>•</div>
              <div>
                Type: <span className="text-slate-800">{provider.npiType === 2 ? 'Organization (Type 2)' : 'Individual (Type 1)'}</span>
              </div>
              {provider.primaryTaxonomy && (
                <>
                  <div>•</div>
                  <div>
                    Specialty:{' '}
                    <span className="text-slate-800 font-medium">
                      {provider.taxonomyDescription || provider.primaryTaxonomy}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-2 shrink-0">
          <Link
            href={`/providers/${provider.id}/edit`}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
          >
            Edit Profile
          </Link>
          {provider.status !== 'archived' && (
            <button
              onClick={handleArchive}
              className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold rounded-lg transition"
            >
              Archive
            </button>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-slate-200 flex space-x-6 text-sm font-medium">
        <button
          onClick={() => setActiveTab('overview')}
          className={`pb-3 transition relative ${
            activeTab === 'overview'
              ? 'text-blue-600 font-bold border-b-2 border-blue-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          Overview & Demographics
        </button>

        <button
          onClick={() => {
            setActiveTab('specialties');
            loadLookups();
          }}
          className={`pb-3 transition flex items-center space-x-1.5 ${
            activeTab === 'specialties'
              ? 'text-blue-600 font-bold border-b-2 border-blue-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>Specialties</span>
          <span className="px-1.5 py-0.2 rounded-full text-[11px] bg-slate-100 text-slate-600">
            {provider.specialties.length}
          </span>
        </button>

        <button
          onClick={() => {
            setActiveTab('locations');
            loadLookups();
          }}
          className={`pb-3 transition flex items-center space-x-1.5 ${
            activeTab === 'locations'
              ? 'text-blue-600 font-bold border-b-2 border-blue-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>Locations</span>
          <span className="px-1.5 py-0.2 rounded-full text-[11px] bg-slate-100 text-slate-600">
            {provider.locations.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('credentials')}
          className={`pb-3 transition ${
            activeTab === 'credentials'
              ? 'text-blue-600 font-bold border-b-2 border-blue-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          Credentials Summary
        </button>

        <button
          onClick={() => setActiveTab('enrollments')}
          className={`pb-3 transition flex items-center space-x-1.5 ${
            activeTab === 'enrollments'
              ? 'text-blue-600 font-bold border-b-2 border-blue-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>Payer Enrollments</span>
          <span className="px-1.5 py-0.2 rounded-full text-[11px] bg-slate-100 text-slate-600">
            {provider.enrollments.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          className={`pb-3 transition flex items-center space-x-1.5 ${
            activeTab === 'audit'
              ? 'text-blue-600 font-bold border-b-2 border-blue-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>Audit History</span>
          <span className="px-1.5 py-0.2 rounded-full text-[11px] bg-slate-100 text-slate-600">
            {auditHistory.length}
          </span>
        </button>
      </div>

      {/* Tab 1: Overview & Demographics */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Demographics Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider text-xs border-b border-slate-100 pb-2">
              Identification & Demographics
            </h3>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-slate-400 block mb-0.5">Full Legal Name</span>
                <span className="font-semibold text-slate-800">{fullName}</span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">Date of Birth</span>
                <span className="font-semibold text-slate-800">
                  {provider.dateOfBirth
                    ? new Date(provider.dateOfBirth).toLocaleDateString()
                    : 'Not specified'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">Gender</span>
                <span className="font-semibold text-slate-800">{provider.gender || 'Not specified'}</span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">Social Security Number</span>
                <div className="flex items-center space-x-2">
                  <span className="font-mono font-semibold text-slate-800">
                    {unmaskedSsn || provider.ssn || 'None recorded'}
                  </span>
                  {provider.hasSsn && (
                    <button
                      type="button"
                      onClick={handleRevealSsn}
                      disabled={revealingSsn}
                      className="text-[11px] text-blue-600 hover:text-blue-800 underline font-medium"
                    >
                      {revealingSsn ? 'Decrypting...' : unmaskedSsn ? 'Mask' : 'Reveal'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Contact Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider text-xs border-b border-slate-100 pb-2">
              Contact Information
            </h3>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-slate-400 block mb-0.5">Email Address</span>
                <span className="font-semibold text-slate-800 font-mono">
                  {provider.email || 'None on file'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">Phone Number</span>
                <span className="font-semibold text-slate-800">{provider.phone || 'None on file'}</span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">CAQH Provider ID</span>
                <span className="font-semibold text-slate-800 font-mono">
                  {provider.caqhId || 'Not registered'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">NPI Enumeration Date</span>
                <span className="font-semibold text-slate-800">
                  {provider.npiEnumerationDate
                    ? new Date(provider.npiEnumerationDate).toLocaleDateString()
                    : 'Unknown'}
                </span>
              </div>
            </div>
          </div>

          {/* Notes Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 col-span-1 md:col-span-2">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider text-xs border-b border-slate-100 pb-2 mb-3">
              Internal Onboarding & Credentialing Notes
            </h3>
            <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">
              {provider.notes || 'No notes added for this provider.'}
            </p>
          </div>
        </div>
      )}

      {/* Tab 2: Multiple Specialties */}
      {activeTab === 'specialties' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Clinical Specialties (Many-to-Many)</h2>
              <p className="text-xs text-slate-500">Board certified or declared specialties associated with this provider</p>
            </div>
            <button
              onClick={() => setShowAddSpecialtyModal(true)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
            >
              + Add Specialty
            </button>
          </div>

          {provider.specialties.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-xs">
              No clinical specialties linked. Click &quot;Add Specialty&quot; to link one.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {provider.specialties.map((spec) => (
                <div
                  key={spec.taxonomyCode}
                  className="p-3.5 rounded-lg border border-slate-200 flex items-center justify-between"
                >
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-slate-800 text-xs">
                        {spec.taxonomy.specialization || spec.taxonomy.classification}
                      </span>
                      {spec.isPrimary && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold text-[10px]">
                          ★ PRIMARY
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                      {spec.taxonomyCode} • {spec.taxonomy.classification}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveSpecialty(spec.taxonomyCode)}
                    className="text-xs text-rose-600 hover:text-rose-800 hover:underline px-2 py-1"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Practice Locations */}
      {activeTab === 'locations' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Practice Locations (Many-to-Many)</h2>
              <p className="text-xs text-slate-500">Facilities and practice clinics where this provider offers patient care</p>
            </div>
            <button
              onClick={() => setShowLinkLocationModal(true)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
            >
              + Link Location
            </button>
          </div>

          {provider.locations.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-xs">
              No practice locations linked. Click &quot;Link Location&quot; to assign a practice site.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {provider.locations.map((locLink) => (
                <div
                  key={locLink.locationId}
                  className="p-3.5 rounded-lg border border-slate-200 flex items-center justify-between"
                >
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-slate-800 text-xs">{locLink.location.name}</span>
                      {locLink.isPrimary && (
                        <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold text-[10px]">
                          ★ PRIMARY
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {locLink.location.address1}, {locLink.location.city}, {locLink.location.state} {locLink.location.zipCode}
                    </div>
                    {locLink.location.phone && (
                      <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                        Phone: {locLink.location.phone}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleUnlinkLocation(locLink.locationId, locLink.location.name)}
                    className="text-xs text-rose-600 hover:text-rose-800 hover:underline px-2 py-1"
                  >
                    Unlink
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Credentials Summary */}
      {activeTab === 'credentials' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
              State Medical Licenses ({provider.stateLicenses.length})
            </h3>
            {provider.stateLicenses.length === 0 ? (
              <p className="text-xs text-slate-400">No state licenses recorded yet (Tracked in Phase 2 core data).</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {provider.stateLicenses.map((lic) => (
                  <div key={lic.id} className="p-3 border rounded-lg text-xs">
                    <div className="font-bold text-slate-800">{lic.state} License #{lic.licenseNumber}</div>
                    <div className="text-slate-500 mt-1">Status: {lic.status}</div>
                    <div className="text-slate-500">Exp: {lic.expirationDate ? new Date(lic.expirationDate).toLocaleDateString() : 'N/A'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
              DEA Registrations ({provider.deaRegistrations.length})
            </h3>
            {provider.deaRegistrations.length === 0 ? (
              <p className="text-xs text-slate-400">No DEA certificates registered.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {provider.deaRegistrations.map((dea) => (
                  <div key={dea.id} className="p-3 border rounded-lg text-xs">
                    <div className="font-bold text-slate-800">DEA #{dea.deaNumber}</div>
                    <div className="text-slate-500 mt-1">State: {dea.state || 'National'}</div>
                    <div className="text-slate-500">Exp: {dea.expirationDate ? new Date(dea.expirationDate).toLocaleDateString() : 'N/A'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
              Board Certifications ({provider.boardCertifications.length})
            </h3>
            {provider.boardCertifications.length === 0 ? (
              <p className="text-xs text-slate-400">No board certifications recorded.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {provider.boardCertifications.map((b) => (
                  <div key={b.id} className="p-3 border rounded-lg text-xs">
                    <div className="font-bold text-slate-800">{b.boardName} - {b.specialty}</div>
                    <div className="text-slate-500 mt-1">Status: {b.status}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 5: Payer Enrollments */}
      {activeTab === 'enrollments' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900">Payer Enrollments ({provider.enrollments.length})</h2>
            <p className="text-xs text-slate-500">Commercial and government insurance payer enrollments (Phase 3)</p>
          </div>

          {provider.enrollments.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-xs">
              No payer enrollments created yet. Payer enrollment workflow is scheduled for Phase 3.
            </div>
          ) : (
            <div className="space-y-2">
              {provider.enrollments.map((enr) => (
                <div key={enr.id} className="p-3 border rounded-lg text-xs flex justify-between items-center">
                  <div>
                    <span className="font-bold text-slate-800">{enr.payer.name}</span>
                    <span className="ml-2 text-slate-500">Status: {enr.status}</span>
                  </div>
                  <div className="text-slate-400 font-mono text-[11px]">
                    Effective: {enr.effectiveDate ? new Date(enr.effectiveDate).toLocaleDateString() : 'Pending'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 6: Audit History */}
      {activeTab === 'audit' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900">Provider Audit Trail</h2>
            <p className="text-xs text-slate-500">
              Immutable record of all creations, updates, sensitive data accesses, and changes
            </p>
          </div>

          {auditHistory.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-xs">
              No audit records logged for this provider.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {auditHistory.map((item) => (
                <div key={item.id} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs">
                  <div>
                    <span className="font-semibold text-slate-800">{item.action.replace('_', ' ').toUpperCase()}</span>
                    <span className="text-slate-400 ml-2">by {item.userEmail || 'System'}</span>
                    {item.changes && (
                      <div className="mt-1 font-mono text-[11px] text-slate-500 bg-slate-50 p-1.5 rounded max-w-xl">
                        {JSON.stringify(item.changes)}
                      </div>
                    )}
                  </div>
                  <div className="text-slate-400 text-[11px] font-mono shrink-0">
                    {new Date(item.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal: Add Specialty */}
      {showAddSpecialtyModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-3">Add Specialty to Provider</h3>
            <form onSubmit={handleAddSpecialty} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Taxonomy Specialty Code *
                </label>
                <select
                  required
                  value={newSpecialtyCode}
                  onChange={(e) => setNewSpecialtyCode(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  <option value="">-- Select Specialty --</option>
                  {allTaxonomies.map((tax) => (
                    <option key={tax.code} value={tax.code}>
                      {tax.code} — {tax.specialization || tax.classification}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center space-x-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newSpecialtyPrimary}
                  onChange={(e) => setNewSpecialtyPrimary(e.target.checked)}
                  className="rounded text-blue-600"
                />
                <span>Set as Primary Specialty for Provider</span>
              </label>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddSpecialtyModal(false)}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 text-xs rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg"
                >
                  Link Specialty
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Link Location */}
      {showLinkLocationModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-3">Link Practice Location</h3>
            <form onSubmit={handleLinkLocation} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Practice Location *
                </label>
                <select
                  required
                  value={newLocationId}
                  onChange={(e) => setNewLocationId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  <option value="">-- Select Location --</option>
                  {allLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} ({loc.city}, {loc.state})
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center space-x-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newLocationPrimary}
                  onChange={(e) => setNewLocationPrimary(e.target.checked)}
                  className="rounded text-indigo-600"
                />
                <span>Set as Primary Practice Location</span>
              </label>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowLinkLocationModal(false)}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 text-xs rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg"
                >
                  Link Location
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
