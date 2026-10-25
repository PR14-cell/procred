'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

interface ProviderAffiliation {
  id: string;
  isPrimary: boolean;
  employmentType: string | null;
  startDate: string | null;
  endDate: string | null;
  provider: {
    id: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    suffix: string | null;
    npiNumber: string;
    primaryTaxonomy: string | null;
    taxonomyDescription: string | null;
    status: string;
    credentialingStatus: string;
    email: string | null;
    phone: string | null;
  };
}

interface GroupEnrollment {
  id: string;
  enrollmentType: 'individual' | 'group';
  applicationType: string;
  status: string;
  groupNumber: string | null;
  groupNpi: string | null;
  effectiveDate: string | null;
  revalidationDate: string | null;
  payer: {
    id: string;
    name: string;
    payerType: string | null;
    state: string | null;
  };
  provider: {
    id: string;
    firstName: string;
    lastName: string;
    npiNumber: string;
  };
}

interface OrganizationDetail {
  id: string;
  name: string;
  dbaName: string | null;
  npiNumber: string | null;
  taxIdLastFour: string | null;
  maskedTaxId: string | null;
  taxId?: string | null;
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
  providers: ProviderAffiliation[];
  payerEnrollments: GroupEnrollment[];
  _count: {
    providers: number;
    enrollments: number;
  };
}

interface AuditHistoryItem {
  id: string;
  userEmail: string | null;
  action: string;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  createdAt: string;
}

interface DocumentItem {
  id: string;
  title: string;
  documentType: string;
  status: string;
  expirationDate: string | null;
  createdAt: string;
  currentVersion?: {
    id: string;
    versionNumber: number;
    fileName: string;
    fileSizeBytes: number;
  } | null;
}

interface AvailableProvider {
  id: string;
  firstName: string;
  lastName: string;
  npiNumber: string;
  primaryTaxonomy: string | null;
  taxonomyDescription: string | null;
}

export default function OrganizationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const organizationId = params?.id;

  const [org, setOrg] = useState<OrganizationDetail | null>(null);
  const [auditHistory, setAuditHistory] = useState<AuditHistoryItem[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'roster' | 'enrollments' | 'documents' | 'audit'>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reveal TIN / Tax ID
  const [revealingTaxId, setRevealingTaxId] = useState(false);
  const [unmaskedTaxId, setUnmaskedTaxId] = useState<string | null>(null);

  // Add Provider to Roster Modal State
  const [showAddProviderModal, setShowAddProviderModal] = useState(false);
  const [availableProviders, setAvailableProviders] = useState<AvailableProvider[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [rosterEmploymentType, setRosterEmploymentType] = useState('employed');
  const [rosterIsPrimary, setRosterIsPrimary] = useState(false);
  const [addingProvider, setAddingProvider] = useState(false);
  const [providerSearch, setProviderSearch] = useState('');

  // Edit Organization Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({
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
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Upload Group Document State
  const [showUploadDocModal, setShowUploadDocModal] = useState(false);
  const [docTitle, setDocTitle] = useState('');
  const [docType, setDocType] = useState('group_npi_letter');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docExpDate, setDocExpDate] = useState('');
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fetchOrganization = useCallback(async () => {
    if (!organizationId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/v1/organizations/${organizationId}`);
      if (!res.ok) {
        throw new Error('Failed to load organization profile');
      }
      const data = await res.json();
      setOrg(data.organization);
      setAuditHistory(data.auditHistory || []);

      // Populate edit form
      setEditForm({
        name: data.organization.name || '',
        dbaName: data.organization.dbaName || '',
        npiNumber: data.organization.npiNumber || '',
        taxId: '',
        organizationType: data.organization.organizationType || 'medical_group',
        address1: data.organization.address1 || '',
        address2: data.organization.address2 || '',
        city: data.organization.city || '',
        state: data.organization.state || 'TX',
        zipCode: data.organization.zipCode || '',
        phone: data.organization.phone || '',
        email: data.organization.email || '',
        website: data.organization.website || '',
        status: data.organization.status || 'active',
        notes: data.organization.notes || '',
      });

      // Load organization documents
      fetch(`/api/v1/documents?entityType=organization&entityId=${organizationId}`)
        .then((r) => r.json())
        .then((d) => setDocuments(d.documents || []))
        .catch(() => {});
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading organization');
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    fetchOrganization();
  }, [fetchOrganization]);

  // Load available providers for roster modal
  const loadAvailableProviders = async () => {
    try {
      setLoadingProviders(true);
      const res = await fetch('/api/v1/providers?limit=100&status=active');
      if (res.ok) {
        const data = await res.json();
        setAvailableProviders(data.providers || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingProviders(false);
    }
  };

  const handleRevealTaxId = async () => {
    if (unmaskedTaxId) {
      setUnmaskedTaxId(null);
      return;
    }
    try {
      setRevealingTaxId(true);
      const res = await fetch(`/api/v1/organizations/${organizationId}?revealTaxId=true`);
      if (!res.ok) throw new Error('Unauthorized or unable to decrypt Tax ID');
      const data = await res.json();
      setUnmaskedTaxId(data.organization.taxId);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Could not decrypt Tax ID');
    } finally {
      setRevealingTaxId(false);
    }
  };

  const handleAddProviderToRoster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProviderId || !organizationId) return;

    try {
      setAddingProvider(true);
      const res = await fetch(`/api/v1/organizations/${organizationId}/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: selectedProviderId,
          employmentType: rosterEmploymentType || null,
          isPrimary: rosterIsPrimary,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to add provider to roster');

      setShowAddProviderModal(false);
      setSelectedProviderId('');
      setRosterEmploymentType('employed');
      setRosterIsPrimary(false);
      fetchOrganization();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error adding provider to roster');
    } finally {
      setAddingProvider(false);
    }
  };

  const handleSetPrimaryRoster = async (providerId: string, employmentType: string | null) => {
    if (!organizationId) return;
    try {
      const res = await fetch(`/api/v1/organizations/${organizationId}/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId,
          employmentType: employmentType || null,
          isPrimary: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to set primary status');
      }
      fetchOrganization();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error updating primary status');
    }
  };

  const handleRemoveFromRoster = async (providerId: string, providerName: string) => {
    if (!organizationId) return;
    if (
      !confirm(
        `Are you sure you want to remove Dr. ${providerName} from this organization? The provider profile, credentials, and individual records will remain completely intact.`
      )
    )
      return;

    try {
      const res = await fetch(`/api/v1/organizations/${organizationId}/providers?providerId=${providerId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to disassociate provider');
      fetchOrganization();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error removing provider from roster');
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizationId) return;
    setEditError(null);
    setEditSubmitting(true);

    try {
      const payload: Record<string, unknown> = {
        name: editForm.name.trim(),
        dbaName: editForm.dbaName.trim() || null,
        npiNumber: editForm.npiNumber.trim() || null,
        organizationType: editForm.organizationType,
        address1: editForm.address1.trim(),
        address2: editForm.address2.trim() || null,
        city: editForm.city.trim(),
        state: editForm.state.trim().toUpperCase(),
        zipCode: editForm.zipCode.trim(),
        phone: editForm.phone.trim() || null,
        email: editForm.email.trim() || null,
        website: editForm.website.trim() || null,
        status: editForm.status,
        notes: editForm.notes.trim() || null,
      };

      if (editForm.taxId && editForm.taxId.trim() !== '') {
        payload.taxId = editForm.taxId.trim();
      }

      const res = await fetch(`/api/v1/organizations/${organizationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to update organization');

      setShowEditModal(false);
      fetchOrganization();
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'Error updating organization');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleArchiveOrganization = async () => {
    if (!org) return;
    if (
      !confirm(
        `Are you sure you want to archive "${org.name}"? Active providers and enrollments will be preserved, and the group status will be changed to archived.`
      )
    )
      return;

    try {
      const res = await fetch(`/api/v1/organizations/${org.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to archive organization');
      fetchOrganization();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error archiving organization');
    }
  };

  const handleUploadGroupDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docFile || !organizationId) return;
    setUploadError(null);
    setUploadingDoc(true);

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const res = reader.result as string;
          const commaIdx = res.indexOf(',');
          resolve(commaIdx >= 0 ? res.substring(commaIdx + 1) : res);
        };
        reader.onerror = reject;
      });
      reader.readAsDataURL(docFile);
      const fileContentBase64 = await base64Promise;

      const payload = {
        title: docTitle.trim(),
        documentType: docType,
        entityType: 'organization',
        entityId: organizationId,
        fileName: docFile.name,
        fileBase64: fileContentBase64,
        mimeType: docFile.type || 'application/pdf',
        fileSizeBytes: docFile.size,
        expirationDate: docExpDate ? new Date(docExpDate).toISOString() : null,
      };

      const res = await fetch('/api/v1/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to upload document');

      setShowUploadDocModal(false);
      setDocTitle('');
      setDocFile(null);
      setDocExpDate('');
      const updatedDocs = await fetch(`/api/v1/documents?entityType=organization&entityId=${organizationId}`).then((r) => r.json());
      setDocuments(updatedDocs.documents || []);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Error uploading document');
    } finally {
      setUploadingDoc(false);
    }
  };

  if (loading && !org) {
    return (
      <div className="py-24 text-center text-slate-400 text-sm">
        Loading organization details...
      </div>
    );
  }

  if (error || !org) {
    return (
      <div className="max-w-4xl mx-auto p-6 bg-red-50 text-red-700 rounded-xl border border-red-200 text-sm space-y-2">
        <div className="font-bold">Error Loading Organization</div>
        <div>{error || 'Organization not found.'}</div>
        <Link href="/organizations" className="text-blue-600 underline font-medium block">
          ← Back to Organizations Directory
        </Link>
      </div>
    );
  }

  // Filtered providers for add modal
  const existingProviderIds = new Set(org.providers.map((p) => p.provider.id));
  const candidateProviders = availableProviders.filter((p) => {
    if (existingProviderIds.has(p.id)) return false;
    if (!providerSearch) return true;
    const q = providerSearch.toLowerCase();
    const fullName = `${p.firstName} ${p.lastName}`.toLowerCase();
    return fullName.includes(q) || p.npiNumber.includes(q);
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Breadcrumb Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-xs text-slate-500 mb-1">
            <Link href="/dashboard" className="hover:underline">Dashboard</Link>
            <span>/</span>
            <Link href="/organizations" className="hover:underline">Groups & Organizations</Link>
            <span>/</span>
            <span className="text-slate-800 font-medium">{org.name}</span>
          </div>

          <div className="flex items-center space-x-3">
            <h1 className="text-2xl font-bold text-slate-900">{org.name}</h1>
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                org.status === 'active'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : org.status === 'archived'
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}
            >
              {org.status}
            </span>
            <span className="capitalize px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-700 border border-slate-200">
              {org.organizationType.replace('_', ' ')}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 mt-2">
            {org.dbaName && (
              <>
                <div>DBA: <span className="font-semibold text-slate-800">{org.dbaName}</span></div>
                <div>•</div>
              </>
            )}
            <div>
              Type 2 NPI: <span className="font-mono font-bold text-slate-800">{org.npiNumber || 'None'}</span>
            </div>
            <div>•</div>
            <div>
              Location: <span className="text-slate-800">{org.city}, {org.state}</span>
            </div>
            {org.phone && (
              <>
                <div>•</div>
                <div>Phone: <span className="text-slate-800">{org.phone}</span></div>
              </>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={() => setShowEditModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
          >
            Edit Organization
          </button>
          {org.status !== 'archived' && (
            <button
              onClick={handleArchiveOrganization}
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
          Overview & Details
        </button>

        <button
          onClick={() => setActiveTab('roster')}
          className={`pb-3 transition flex items-center space-x-1.5 ${
            activeTab === 'roster'
              ? 'text-blue-600 font-bold border-b-2 border-blue-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>Provider Roster</span>
          <span className="px-1.5 py-0.2 rounded-full text-[11px] bg-slate-100 text-slate-600">
            {org.providers.length}
          </span>
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
            {org.payerEnrollments.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('documents')}
          className={`pb-3 transition flex items-center space-x-1.5 ${
            activeTab === 'documents'
              ? 'text-blue-600 font-bold border-b-2 border-blue-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>Group Documents</span>
          <span className="px-1.5 py-0.2 rounded-full text-[11px] bg-slate-100 text-slate-600">
            {documents.length}
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

      {/* Tab 1: Overview & Details */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Organization Legal Entity Details */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2">
              Legal Identification & Tax Data
            </h3>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-slate-400 block mb-0.5">Legal Name</span>
                <span className="font-semibold text-slate-800">{org.name}</span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">DBA / Practice Name</span>
                <span className="font-semibold text-slate-800">{org.dbaName || 'None recorded'}</span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">Type 2 Group NPI</span>
                <span className="font-mono font-semibold text-slate-800">{org.npiNumber || 'Not recorded'}</span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">Federal Tax ID (EIN)</span>
                <div className="flex items-center space-x-2">
                  <span className="font-mono font-semibold text-slate-800">
                    {unmaskedTaxId || org.maskedTaxId || (org.taxIdLastFour ? `XX-XXX${org.taxIdLastFour}` : 'None recorded')}
                  </span>
                  {(org.taxIdLastFour || unmaskedTaxId) && (
                    <button
                      type="button"
                      onClick={handleRevealTaxId}
                      disabled={revealingTaxId}
                      className="text-[11px] text-blue-600 hover:text-blue-800 underline font-medium"
                    >
                      {revealingTaxId ? 'Decrypting...' : unmaskedTaxId ? 'Mask' : 'Reveal'}
                    </button>
                  )}
                </div>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">Organization Type</span>
                <span className="font-semibold text-slate-800 capitalize">{org.organizationType.replace('_', ' ')}</span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">Registered Date</span>
                <span className="font-semibold text-slate-800">{new Date(org.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {/* Physical Address & Contact Information */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2">
              Practice Address & Contact Information
            </h3>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="col-span-2">
                <span className="text-slate-400 block mb-0.5">Physical Practice Address</span>
                <span className="font-semibold text-slate-800">
                  {org.address1} {org.address2 ? `, ${org.address2}` : ''}
                  <br />
                  {org.city}, {org.state} {org.zipCode}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">Central Phone</span>
                <span className="font-semibold text-slate-800">{org.phone || 'None on file'}</span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">Contact Email</span>
                <span className="font-semibold text-slate-800 font-mono">{org.email || 'None on file'}</span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">Website</span>
                {org.website ? (
                  <a href={org.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    {org.website}
                  </a>
                ) : (
                  <span className="text-slate-400">None on file</span>
                )}
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">Last Updated</span>
                <span className="font-semibold text-slate-800">{new Date(org.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {/* Internal Notes Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 col-span-1 md:col-span-2">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2 mb-3">
              Internal Group Onboarding & Payer Guidelines
            </h3>
            <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">
              {org.notes || 'No internal notes recorded for this organization.'}
            </p>
          </div>
        </div>
      )}

      {/* Tab 2: Provider Roster (Many-to-Many) */}
      {activeTab === 'roster' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Provider Roster ({org.providers.length})</h2>
              <p className="text-xs text-slate-500">
                Healthcare providers affiliated with this practice group for credentialing and payer billing
              </p>
            </div>
            <button
              onClick={() => {
                loadAvailableProviders();
                setShowAddProviderModal(true);
              }}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
            >
              + Add Provider to Roster
            </button>
          </div>

          {org.providers.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs space-y-2">
              <div className="text-2xl">👤</div>
              <div className="font-semibold text-slate-600">No Providers on Roster</div>
              <p className="text-slate-400 max-w-sm mx-auto">
                No healthcare clinicians are currently affiliated with this organization.
                Click &quot;+ Add Provider to Roster&quot; to associate an existing provider.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-700 uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="px-4 py-3">Provider Name</th>
                    <th className="px-3 py-3">Type 1 NPI</th>
                    <th className="px-3 py-3">Specialty / Taxonomy</th>
                    <th className="px-3 py-3">Affiliation Type</th>
                    <th className="px-3 py-3">Primary Group</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {org.providers.map((pAff) => {
                    const p = pAff.provider;
                    const fullName = `${p.firstName} ${p.lastName}${p.suffix ? ` ${p.suffix}` : ''}`;
                    return (
                      <tr key={pAff.id} className="hover:bg-slate-50/70 transition">
                        <td className="px-4 py-3">
                          <Link
                            href={`/providers/${p.id}`}
                            className="font-bold text-slate-900 hover:text-blue-600 hover:underline block"
                          >
                            Dr. {fullName}
                          </Link>
                          {p.email && <span className="text-[11px] text-slate-400 font-mono">{p.email}</span>}
                        </td>
                        <td className="px-3 py-3 font-mono font-medium text-slate-800">
                          {p.npiNumber}
                        </td>
                        <td className="px-3 py-3 text-slate-700">
                          {p.taxonomyDescription || p.primaryTaxonomy || 'General Practice'}
                        </td>
                        <td className="px-3 py-3">
                          <span className="capitalize px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-700">
                            {pAff.employmentType ? pAff.employmentType.replace('_', ' ') : 'Affiliate'}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          {pAff.isPrimary ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                              ★ PRIMARY
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleSetPrimaryRoster(p.id, pAff.employmentType)}
                              className="px-2 py-0.5 rounded text-[10px] font-medium border border-slate-300 text-slate-600 hover:bg-white"
                            >
                              Make Primary
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                              p.status === 'active'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {p.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right space-x-2">
                          <Link
                            href={`/providers/${p.id}`}
                            className="text-xs font-semibold text-blue-600 hover:underline"
                          >
                            View Provider
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleRemoveFromRoster(p.id, fullName)}
                            className="text-xs font-medium text-rose-600 hover:text-rose-800 hover:underline"
                          >
                            Remove
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
      )}

      {/* Tab 3: Payer Enrollments */}
      {activeTab === 'enrollments' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Group Payer Enrollments ({org.payerEnrollments.length})
              </h2>
              <p className="text-xs text-slate-500">
                Payer credentialing applications linked to this organization and group billing NPI
              </p>
            </div>
            <Link
              href="/enrollments/new"
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
            >
              + New Enrollment Application
            </Link>
          </div>

          {org.payerEnrollments.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs space-y-2">
              <div className="text-2xl">📝</div>
              <div className="font-semibold text-slate-600">No Payer Enrollments Linked</div>
              <p className="text-slate-400 max-w-sm mx-auto">
                No payer enrollment applications have been submitted under this organization yet.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-700 uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="px-4 py-3">Payer / Insurance</th>
                    <th className="px-3 py-3">Provider</th>
                    <th className="px-3 py-3">Enrollment Type</th>
                    <th className="px-3 py-3">Group Number</th>
                    <th className="px-3 py-3">Effective Date</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {org.payerEnrollments.map((enr) => (
                    <tr key={enr.id} className="hover:bg-slate-50/70 transition">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {enr.payer.name} {enr.payer.state ? `(${enr.payer.state})` : ''}
                      </td>
                      <td className="px-3 py-3">
                        <Link
                          href={`/providers/${enr.provider.id}`}
                          className="text-blue-600 hover:underline font-medium"
                        >
                          Dr. {enr.provider.firstName} {enr.provider.lastName}
                        </Link>
                      </td>
                      <td className="px-3 py-3 capitalize">{enr.enrollmentType}</td>
                      <td className="px-3 py-3 font-mono text-slate-700">{enr.groupNumber || '—'}</td>
                      <td className="px-3 py-3 font-mono">
                        {enr.effectiveDate ? new Date(enr.effectiveDate).toLocaleDateString() : 'Pending'}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-medium border ${
                            enr.status === 'approved'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : enr.status === 'in_progress' || enr.status === 'submitted'
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          {enr.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/enrollments/${enr.id}`}
                          className="text-xs font-semibold text-blue-600 hover:underline"
                        >
                          View Details →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Group Documents */}
      {activeTab === 'documents' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Group Legal Documents ({documents.length})</h2>
              <p className="text-xs text-slate-500">
                Form W-9, Type 2 Group NPI confirmation letters, group malpractice COIs, and master agreements
              </p>
            </div>
            <button
              onClick={() => setShowUploadDocModal(true)}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
            >
              + Upload Group Document
            </button>
          </div>

          {documents.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs space-y-2">
              <div className="text-2xl">📄</div>
              <div className="font-semibold text-slate-600">No Group Documents Uploaded</div>
              <p className="text-slate-400 max-w-sm mx-auto">
                Upload organization Form W-9, Group NPI Letter, or Group Malpractice COI.
              </p>
              <button
                onClick={() => setShowUploadDocModal(true)}
                className="mt-2 px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold"
              >
                + Upload Document
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="p-4 rounded-xl border border-slate-200 hover:border-blue-300 transition bg-white flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-sm text-slate-900">{doc.title}</div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-700 shrink-0">
                        {doc.status}
                      </span>
                    </div>

                    <div className="text-xs text-slate-500 mt-1 flex items-center space-x-2">
                      <span className="capitalize">{doc.documentType.replace(/_/g, ' ')}</span>
                      {doc.currentVersion && (
                        <>
                          <span>•</span>
                          <span className="font-bold text-blue-700">v{doc.currentVersion.versionNumber}</span>
                        </>
                      )}
                    </div>

                    {doc.expirationDate && (
                      <div className="text-xs text-slate-600 mt-2">
                        Expires: <span className="font-medium">{new Date(doc.expirationDate).toLocaleDateString()}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                    <span className="text-slate-400 text-[11px]">
                      {doc.currentVersion?.fileName || 'file'}
                    </span>
                    <a
                      href={`/api/v1/documents/${doc.id}/download`}
                      download
                      className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded transition"
                    >
                      Download
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 5: Audit History */}
      {activeTab === 'audit' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900">Immutable Audit Trail ({auditHistory.length})</h2>
            <p className="text-xs text-slate-500">
              Cryptographically timestamped compliance history and change tracking
            </p>
          </div>

          {auditHistory.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              No audit logs recorded for this entity yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {auditHistory.map((item) => (
                <div key={item.id} className="py-3 flex items-start justify-between text-xs">
                  <div>
                    <span className="font-mono font-semibold text-slate-900 uppercase">
                      {item.action.replace(/_/g, ' ')}
                    </span>
                    <div className="text-slate-500 text-[11px] mt-0.5">
                      By: <strong className="text-slate-700">{item.userEmail || 'System'}</strong>
                    </div>
                  </div>
                  <div className="text-slate-400 text-[11px] font-mono">
                    {new Date(item.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal: Add Provider to Roster */}
      {showAddProviderModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-1">Add Provider to Roster</h3>
            <p className="text-xs text-slate-500 mb-4">
              Select an existing provider from the directory to affiliate with {org.name}
            </p>

            <form onSubmit={handleAddProviderToRoster} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Filter Providers
                </label>
                <input
                  type="text"
                  placeholder="Search by provider name or NPI..."
                  value={providerSearch}
                  onChange={(e) => setProviderSearch(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs mb-2"
                />

                <label className="block font-semibold text-slate-700 mb-1">
                  Select Provider *
                </label>
                {loadingProviders ? (
                  <div className="p-3 bg-slate-50 text-slate-400 text-xs rounded-lg">
                    Loading providers...
                  </div>
                ) : candidateProviders.length === 0 ? (
                  <div className="p-3 bg-slate-50 text-slate-400 text-xs rounded-lg">
                    No available providers matching search criteria.
                  </div>
                ) : (
                  <select
                    required
                    value={selectedProviderId}
                    onChange={(e) => setSelectedProviderId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">-- Choose a provider --</option>
                    {candidateProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        Dr. {p.firstName} {p.lastName} — NPI: {p.npiNumber} ({p.taxonomyDescription || 'General'})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Employment / Affiliation Type
                </label>
                <select
                  value={rosterEmploymentType}
                  onChange={(e) => setRosterEmploymentType(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="employed">W-2 Employed</option>
                  <option value="contractor">1099 Independent Contractor</option>
                  <option value="affiliate">Affiliated Staff</option>
                  <option value="owner">Partner / Owner</option>
                  <option value="locum_tenens">Locum Tenens</option>
                </select>
              </div>

              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="rosterIsPrimary"
                  checked={rosterIsPrimary}
                  onChange={(e) => setRosterIsPrimary(e.target.checked)}
                  className="h-4 w-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                />
                <label htmlFor="rosterIsPrimary" className="text-slate-700 font-medium cursor-pointer">
                  Mark as provider&apos;s primary group affiliation
                </label>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddProviderModal(false)}
                  className="px-3.5 py-1.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingProvider || !selectedProviderId}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg"
                >
                  {addingProvider ? 'Affiliating...' : 'Add to Roster'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Organization */}
      {showEditModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-xl w-full p-6 border border-slate-200 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h3 className="text-base font-bold text-slate-900">Edit Organization Information</h3>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            {editError && (
              <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200 mb-4">
                {editError}
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Organization Legal Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Doing Business As (DBA)
                  </label>
                  <input
                    type="text"
                    value={editForm.dbaName}
                    onChange={(e) => setEditForm({ ...editForm, dbaName: e.target.value })}
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
                    value={editForm.npiNumber}
                    onChange={(e) => setEditForm({ ...editForm, npiNumber: e.target.value.replace(/\D/g, '') })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Update Tax ID / EIN (Leave blank to keep existing)
                  </label>
                  <input
                    type="text"
                    maxLength={10}
                    value={editForm.taxId}
                    onChange={(e) => setEditForm({ ...editForm, taxId: e.target.value })}
                    placeholder="XX-XXXXXXX"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Organization Type</label>
                  <select
                    value={editForm.organizationType}
                    onChange={(e) => setEditForm({ ...editForm, organizationType: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="medical_group">Medical Group / Practice</option>
                    <option value="hospital_system">Hospital / Health System</option>
                    <option value="solo_practice">Solo Practice Entity</option>
                    <option value="clinic">Clinic / Urgent Care</option>
                    <option value="ipa">IPA</option>
                    <option value="asc">ASC</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status</label>
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Street Address *</label>
                <input
                  type="text"
                  required
                  value={editForm.address1}
                  onChange={(e) => setEditForm({ ...editForm, address1: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">City *</label>
                  <input
                    type="text"
                    required
                    value={editForm.city}
                    onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">State *</label>
                  <input
                    type="text"
                    required
                    maxLength={2}
                    value={editForm.state}
                    onChange={(e) => setEditForm({ ...editForm, state: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Zip *</label>
                  <input
                    type="text"
                    required
                    maxLength={10}
                    value={editForm.zipCode}
                    onChange={(e) => setEditForm({ ...editForm, zipCode: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={editForm.phone}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Internal Notes</label>
                <textarea
                  rows={2}
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-3.5 py-1.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg"
                >
                  {editSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Upload Group Document */}
      {showUploadDocModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-1">Upload Group Document</h3>
            <p className="text-xs text-slate-500 mb-4">
              Upload a legal or compliance document associated with {org.name}
            </p>

            {uploadError && (
              <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200 mb-4">
                {uploadError}
              </div>
            )}

            <form onSubmit={handleUploadGroupDoc} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Document Title *</label>
                <input
                  type="text"
                  required
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="e.g. 2026 Form W-9 Signed"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Document Category *</label>
                <select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="group_npi_letter">Group NPI Enumeration Letter</option>
                  <option value="w9">Form W-9 (Taxpayer ID & Certification)</option>
                  <option value="group_malpractice_coi">Group Malpractice Certificate (COI)</option>
                  <option value="group_payer_agreement">Group Payer Contract / Agreement</option>
                  <option value="other">Other Group Document</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Expiration Date (Optional)</label>
                <input
                  type="date"
                  value={docExpDate}
                  onChange={(e) => setDocExpDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Select File *</label>
                <input
                  type="file"
                  required
                  onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowUploadDocModal(false)}
                  className="px-3.5 py-1.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploadingDoc || !docFile || !docTitle.trim()}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg"
                >
                  {uploadingDoc ? 'Uploading...' : 'Upload Document'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
