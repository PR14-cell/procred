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
  coverageType: string | null;
  perClaimAmount: number | null;
  aggregateAmount: number | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  status: string;
  verified: boolean;
}

interface CaqhItem {
  id: string;
  caqhId: string;
  username: string | null;
  lastAttestationDate: string | null;
  nextAttestationDate: string | null;
  attestationStatus: string;
}

interface VerificationHistoryItem {
  id: string;
  entityType: string;
  entityId: string;
  method: string;
  source: string;
  status: string;
  verifiedDate: string;
  notes: string | null;
}

interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  taskType?: string;
  priority: string;
  status: string;
  dueDate: string | null;
  completedAt?: string | null;
  completionNotes?: string | null;
  assignedTo: { id: string; firstName: string; lastName: string; email: string } | null;
}

interface NoteItem {
  id: string;
  entityType: string;
  entityId: string;
  providerId: string | null;
  content: string;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; firstName: string; lastName: string; email: string } | null;
  updatedBy: { id: string; firstName: string; lastName: string; email: string } | null;
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
  verificationHistory: VerificationHistoryItem[];
  enrollments: Array<{
    id: string;
    enrollmentType: 'individual' | 'group';
    applicationType: string;
    status: string;
    groupNumber: string | null;
    groupNpi: string | null;
    submittedDate: string | null;
    effectiveDate: string | null;
    revalidationDate: string | null;
    followUpDate: string | null;
    trackingNumber: string | null;
    notes: string | null;
    missingItems: Array<{ id: string; category: string; description: string; isResolved: boolean }> | null;
    payer: { id: string; name: string; payerType: string | null; state: string | null };
    location: { id: string; name: string; city: string; state: string } | null;
    assignedTo: { firstName: string; lastName: string } | null;
  }>;
  organizations?: Array<{
    id: string;
    providerId: string;
    organizationId: string;
    isPrimary: boolean;
    employmentType: string | null;
    startDate: string | null;
    endDate: string | null;
    organization: {
      id: string;
      name: string;
      dbaName: string | null;
      npiNumber: string | null;
      organizationType: string;
      city: string;
      state: string;
      phone: string | null;
      status: string;
    };
  }>;
}

function renderExpirationBadge(dateStr: string | null | undefined) {
  if (!dateStr) return <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600">Lifetime / None</span>;
  const exp = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.ceil((Date.UTC(exp.getUTCFullYear(), exp.getUTCMonth(), exp.getUTCDate()) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">EXPIRED ({Math.abs(diffDays)}d ago)</span>;
  }
  if (diffDays <= 14) {
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800 border border-red-200 animate-pulse">{diffDays}d remaining</span>;
  }
  if (diffDays <= 30) {
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">{diffDays}d remaining</span>;
  }
  if (diffDays <= 60 || diffDays <= 90) {
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-yellow-100 text-yellow-800 border border-yellow-200">{diffDays}d remaining</span>;
  }
  return <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200">{diffDays}d remaining</span>;
}

export default function ProviderProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const providerId = params?.id;

  const [provider, setProvider] = useState<ProviderProfile | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [auditHistory, setAuditHistory] = useState<AuditItem[]>([]);
  const [providerDocs, setProviderDocs] = useState<any[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [providerNotes, setProviderNotes] = useState<NoteItem[]>([]);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newNotePinned, setNewNotePinned] = useState(false);
  const [submittingNote, setSubmittingNote] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'organizations' | 'specialties' | 'locations' | 'credentials' | 'enrollments' | 'documents' | 'tasks' | 'notes' | 'audit'>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reveal SSN state
  const [revealingSsn, setRevealingSsn] = useState(false);
  const [unmaskedSsn, setUnmaskedSsn] = useState<string | null>(null);

  // Group / Organization Affiliation State
  const [showAffiliateOrgModal, setShowAffiliateOrgModal] = useState(false);
  const [allOrganizations, setAllOrganizations] = useState<Array<{ id: string; name: string; dbaName: string | null; npiNumber: string | null; city: string; state: string }>>([]);
  const [affiliateOrgId, setAffiliateOrgId] = useState('');
  const [affiliateEmploymentType, setAffiliateEmploymentType] = useState('employed');
  const [affiliateIsPrimary, setAffiliateIsPrimary] = useState(false);
  const [affiliateSubmitting, setAffiliateSubmitting] = useState(false);

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

  // Phase 3 Credential Modals & State
  const [showAddCredentialModal, setShowAddCredentialModal] = useState(false);
  const [addCredType, setAddCredType] = useState('state_license');
  const [addCredState, setAddCredState] = useState('');
  const [addCredNumber, setAddCredNumber] = useState('');
  const [addCredSubtype, setAddCredSubtype] = useState('');
  const [addCredIssueDate, setAddCredIssueDate] = useState('');
  const [addCredExpDate, setAddCredExpDate] = useState('');
  const [addCredSubmitting, setAddCredSubmitting] = useState(false);

  // PSV Modal State
  const [verifyingCred, setVerifyingCred] = useState<{ id: string; type: string; title: string } | null>(null);
  const [verifMethod, setVerifMethod] = useState('primary_source');
  const [verifSource, setVerifSource] = useState('Official Licensing Board Website');
  const [verifStatus, setVerifStatus] = useState('verified');
  const [verifNotes, setVerifNotes] = useState('');
  const [verifSubmitting, setVerifSubmitting] = useState(false);

  // Task Modal State
  const [taskModalCred, setTaskModalCred] = useState<{ id: string; type: string; title: string; expDate: string | null } | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskPriority, setTaskPriority] = useState('high');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [taskSubmitting, setTaskSubmitting] = useState(false);

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
      setTasks(data.tasks || []);
      setAuditHistory(data.auditHistory || []);
      // Also fetch documents and notes for this provider
      fetch(`/api/v1/documents?providerId=${providerId}`)
        .then((r) => r.json())
        .then((d) => setProviderDocs(d.documents || []))
        .catch(() => {});
      fetch(`/api/v1/notes?providerId=${providerId}`)
        .then((r) => r.json())
        .then((d) => setProviderNotes(d.notes || []))
        .catch(() => {});
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
      const [taxRes, locRes, orgRes] = await Promise.all([
        fetch('/api/v1/taxonomy'),
        fetch('/api/v1/locations'),
        fetch('/api/v1/organizations?limit=100&status=active'),
      ]);
      if (taxRes.ok) {
        const taxData = await taxRes.json();
        setAllTaxonomies(taxData.taxonomyCodes || []);
      }
      if (locRes.ok) {
        const locData = await locRes.json();
        setAllLocations(locData.locations || []);
      }
      if (orgRes.ok) {
        const orgData = await orgRes.json();
        setAllOrganizations(orgData.organizations || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAffiliateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!affiliateOrgId || !providerId) return;
    try {
      setAffiliateSubmitting(true);
      const res = await fetch(`/api/v1/organizations/${affiliateOrgId}/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId,
          employmentType: affiliateEmploymentType || null,
          isPrimary: affiliateIsPrimary,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to affiliate organization');
      setShowAffiliateOrgModal(false);
      setAffiliateOrgId('');
      setAffiliateEmploymentType('employed');
      setAffiliateIsPrimary(false);
      fetchProvider();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error affiliating organization');
    } finally {
      setAffiliateSubmitting(false);
    }
  };

  const handleSetPrimaryOrg = async (orgId: string, currentEmploymentType: string | null) => {
    try {
      const res = await fetch(`/api/v1/organizations/${orgId}/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId,
          employmentType: currentEmploymentType || null,
          isPrimary: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to set primary organization');
      }
      fetchProvider();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error updating primary organization');
    }
  };

  const handleDisassociateOrg = async (orgId: string, orgName: string) => {
    if (
      !confirm(
        `Are you sure you want to disassociate provider from "${orgName}"? Provider records, licenses, documents, and enrollments will remain intact.`
      )
    )
      return;
    try {
      const res = await fetch(`/api/v1/organizations/${orgId}/providers?providerId=${providerId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to disassociate organization');
      fetchProvider();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error disassociating organization');
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

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteContent.trim() || !providerId) return;
    setSubmittingNote(true);
    try {
      const res = await fetch('/api/v1/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: 'provider',
          entityId: providerId,
          providerId,
          content: newNoteContent.trim(),
          isPinned: newNotePinned,
        }),
      });
      if (!res.ok) throw new Error('Failed to create note');
      setNewNoteContent('');
      setNewNotePinned(false);
      const updated = await fetch(`/api/v1/notes?providerId=${providerId}`).then((r) => r.json());
      setProviderNotes(updated.notes || []);
    } catch (err: any) {
      alert(err.message || 'Error creating note');
    } finally {
      setSubmittingNote(false);
    }
  };

  const handleTogglePinNote = async (noteId: string, currentPinned: boolean) => {
    try {
      const res = await fetch(`/api/v1/notes/${noteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPinned: !currentPinned }),
      });
      if (!res.ok) throw new Error('Failed to update note pin');
      const updated = await fetch(`/api/v1/notes?providerId=${providerId}`).then((r) => r.json());
      setProviderNotes(updated.notes || []);
    } catch (err: any) {
      alert(err.message || 'Error updating note');
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!confirm('Are you sure you want to delete this note?')) return;
    try {
      const res = await fetch(`/api/v1/notes/${noteId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete note');
      const updated = await fetch(`/api/v1/notes?providerId=${providerId}`).then((r) => r.json());
      setProviderNotes(updated.notes || []);
    } catch (err: any) {
      alert(err.message || 'Error deleting note');
    }
  };

  const handleCompleteProviderTask = async (taskId: string) => {
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completionNotes: 'Completed from Provider Profile' }),
      });
      if (!res.ok) throw new Error('Failed to complete task');
      fetchProvider();
    } catch (err: any) {
      alert(err.message || 'Error completing task');
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

  // Phase 3 Credential Handlers
  const handleAddCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setAddCredSubmitting(true);
      let payload: Record<string, unknown> = {
        providerId,
        credentialType: addCredType,
      };

      if (addCredType === 'state_license') {
        payload = {
          ...payload,
          state: addCredState.toUpperCase(),
          licenseNumber: addCredNumber,
          licenseType: addCredSubtype || 'MD',
          issueDate: addCredIssueDate || undefined,
          expirationDate: addCredExpDate,
        };
      } else if (addCredType === 'dea_registration') {
        payload = {
          ...payload,
          deaNumber: addCredNumber.toUpperCase(),
          schedule: addCredSubtype || 'Schedules 2, 2N, 3, 3N, 4, 5',
          state: addCredState.toUpperCase() || undefined,
          issueDate: addCredIssueDate || undefined,
          expirationDate: addCredExpDate,
        };
      } else if (addCredType === 'board_certification') {
        payload = {
          ...payload,
          boardName: addCredSubtype || 'American Board of Medical Specialties',
          specialty: addCredNumber,
          initialCertDate: addCredIssueDate || undefined,
          expirationDate: addCredExpDate || undefined,
        };
      } else if (addCredType === 'malpractice_insurance') {
        payload = {
          ...payload,
          carrierName: addCredSubtype || 'The Doctors Company',
          policyNumber: addCredNumber,
          coverageType: 'occurrence',
          effectiveDate: addCredIssueDate || undefined,
          expirationDate: addCredExpDate,
        };
      } else if (addCredType === 'caqh_profile') {
        payload = {
          ...payload,
          caqhId: addCredNumber,
          lastAttestationDate: addCredIssueDate || undefined,
          nextAttestationDate: addCredExpDate,
        };
      }

      const res = await fetch('/api/v1/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to add credential');
      setShowAddCredentialModal(false);
      setAddCredNumber('');
      setAddCredState('');
      setAddCredSubtype('');
      setAddCredIssueDate('');
      setAddCredExpDate('');
      fetchProvider();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error adding credential');
    } finally {
      setAddCredSubmitting(false);
    }
  };

  const handleDeactivateCredential = async (type: string, id: string) => {
    if (!confirm('Are you sure you want to deactivate this credential?')) return;
    try {
      const res = await fetch(`/api/v1/credentials/${type}/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to deactivate credential');
      }
      fetchProvider();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error deactivating');
    }
  };

  const handleSubmitVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyingCred) return;
    try {
      setVerifSubmitting(true);
      const res = await fetch(`/api/v1/credentials/${verifyingCred.type}/${verifyingCred.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId,
          method: verifMethod,
          source: verifSource,
          status: verifStatus,
          notes: verifNotes,
        }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Verification logging failed');
      }
      setVerifyingCred(null);
      fetchProvider();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setVerifSubmitting(false);
    }
  };

  const handleSubmitTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskModalCred) return;
    try {
      setTaskSubmitting(true);
      const res = await fetch('/api/v1/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: taskTitle,
          description: `Work item for ${taskModalCred.title} expiring on ${taskModalCred.expDate ? new Date(taskModalCred.expDate).toLocaleDateString() : 'N/A'}.`,
          entityType: taskModalCred.type,
          entityId: taskModalCred.id,
          priority: taskPriority,
          dueDate: taskDueDate || undefined,
        }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Task creation failed');
      }
      setTaskModalCred(null);
      fetchProvider();
      alert('Task created successfully!');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Task creation failed');
    } finally {
      setTaskSubmitting(false);
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
            setActiveTab('organizations');
            loadLookups();
          }}
          className={`pb-3 transition flex items-center space-x-1.5 ${
            activeTab === 'organizations'
              ? 'text-blue-600 font-bold border-b-2 border-blue-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>Organizations / Groups</span>
          <span className="px-1.5 py-0.2 rounded-full text-[11px] bg-slate-100 text-slate-600">
            {provider.organizations?.length || 0}
          </span>
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
          onClick={() => {
            setActiveTab('documents');
            fetch(`/api/v1/documents?providerId=${providerId}`)
              .then((r) => r.json())
              .then((d) => setProviderDocs(d.documents || []))
              .catch(() => {});
          }}
          className={`pb-3 transition flex items-center space-x-1.5 ${
            activeTab === 'documents'
              ? 'text-blue-600 font-bold border-b-2 border-blue-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>Documents</span>
          <span className="px-1.5 py-0.2 rounded-full text-[11px] bg-slate-100 text-slate-600">
            {providerDocs.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('tasks')}
          className={`pb-3 transition flex items-center space-x-1.5 ${
            activeTab === 'tasks'
              ? 'text-blue-600 font-bold border-b-2 border-blue-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>Tasks</span>
          <span className="px-1.5 py-0.2 rounded-full text-[11px] bg-slate-100 text-slate-600">
            {tasks.length}
          </span>
        </button>

        <button
          onClick={() => {
            setActiveTab('notes');
            fetch(`/api/v1/notes?providerId=${providerId}`)
              .then((r) => r.json())
              .then((d) => setProviderNotes(d.notes || []))
              .catch(() => {});
          }}
          className={`pb-3 transition flex items-center space-x-1.5 ${
            activeTab === 'notes'
              ? 'text-blue-600 font-bold border-b-2 border-blue-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>Notes</span>
          <span className="px-1.5 py-0.2 rounded-full text-[11px] bg-slate-100 text-slate-600">
            {providerNotes.length}
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

          {/* Affiliated Organizations / Groups Overview Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 col-span-1 md:col-span-2 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider text-xs">
                  Affiliated Organizations / Groups
                </h3>
                <p className="text-[11px] text-slate-500">
                  Medical groups and health systems billing or credentialing for this provider
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('organizations');
                  loadLookups();
                }}
                className="text-xs text-blue-600 hover:text-blue-800 font-semibold hover:underline"
              >
                Manage All Affiliations ({provider.organizations?.length || 0}) →
              </button>
            </div>

            {!provider.organizations || provider.organizations.length === 0 ? (
              <div className="py-4 px-3 bg-slate-50 rounded-lg text-slate-500 text-xs flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-700">Solo / Independent Practitioner</span>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    No medical group or organization affiliations currently linked to this provider.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    loadLookups();
                    setShowAffiliateOrgModal(true);
                  }}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold"
                >
                  + Affiliate Group
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {provider.organizations.map((po) => (
                  <div
                    key={po.id}
                    className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/50 flex flex-col justify-between space-y-2"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center space-x-2">
                          <Link
                            href={`/organizations/${po.organization.id}`}
                            className="font-bold text-slate-900 text-xs hover:text-blue-600 hover:underline"
                          >
                            {po.organization.name}
                          </Link>
                          {po.isPrimary && (
                            <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-bold text-[10px]">
                              ★ PRIMARY
                            </span>
                          )}
                        </div>
                        {po.organization.dbaName && (
                          <div className="text-[11px] text-slate-500">DBA: {po.organization.dbaName}</div>
                        )}
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium uppercase bg-slate-200 text-slate-700">
                        {po.employmentType ? po.employmentType.replace('_', ' ') : 'Affiliate'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-200/60">
                      <span>
                        NPI: <strong className="font-mono text-slate-700">{po.organization.npiNumber || 'N/A'}</strong>
                      </span>
                      <span>
                        {po.organization.city}, {po.organization.state}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
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

      {/* Tab: Organizations Affiliations (Many-to-Many) */}
      {activeTab === 'organizations' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Affiliated Organizations / Groups (Many-to-Many)</h2>
              <p className="text-xs text-slate-500">
                Healthcare organizations, medical groups, and hospitals where this provider is credentialed
              </p>
            </div>
            <button
              onClick={() => {
                loadLookups();
                setShowAffiliateOrgModal(true);
              }}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
            >
              + Affiliate Organization
            </button>
          </div>

          {!provider.organizations || provider.organizations.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs space-y-2">
              <div className="text-2xl">🏢</div>
              <div className="font-semibold text-slate-600">No Organization Affiliations</div>
              <p className="text-slate-400 max-w-sm mx-auto">
                This provider is currently designated as a solo / independent practitioner.
                Click &quot;+ Affiliate Organization&quot; to link to an established medical group.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {provider.organizations.map((po) => (
                <div
                  key={po.id}
                  className="p-4 hover:bg-slate-50/70 transition flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <Link
                        href={`/organizations/${po.organization.id}`}
                        className="font-bold text-sm text-slate-900 hover:text-blue-600 hover:underline"
                      >
                        {po.organization.name}
                      </Link>
                      {po.isPrimary ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                          ★ PRIMARY AFFILIATION
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSetPrimaryOrg(po.organization.id, po.employmentType)}
                          className="px-2 py-0.5 rounded text-[10px] font-medium border border-slate-300 text-slate-600 hover:bg-white"
                        >
                          Make Primary
                        </button>
                      )}
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium capitalize bg-slate-100 text-slate-700">
                        {po.employmentType ? po.employmentType.replace('_', ' ') : 'Affiliate'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      {po.organization.dbaName && (
                        <span>
                          DBA: <strong>{po.organization.dbaName}</strong>
                        </span>
                      )}
                      <span>
                        Type 2 NPI:{' '}
                        <strong className="font-mono text-slate-800">
                          {po.organization.npiNumber || 'N/A'}
                        </strong>
                      </span>
                      <span>•</span>
                      <span>Type: {po.organization.organizationType.replace('_', ' ')}</span>
                      <span>•</span>
                      <span>
                        {po.organization.city}, {po.organization.state}
                      </span>
                      {po.organization.phone && (
                        <>
                          <span>•</span>
                          <span>{po.organization.phone}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    <Link
                      href={`/organizations/${po.organization.id}`}
                      className="px-3 py-1.5 border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-medium rounded-lg"
                    >
                      View Organization
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDisassociateOrg(po.organization.id, po.organization.name)}
                      className="px-3 py-1.5 border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-medium rounded-lg"
                    >
                      Disassociate
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
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

      {/* Tab 4: Credentials Management (Phase 3) */}
      {activeTab === 'credentials' && (
        <div className="space-y-6">
          {/* Header & Add Credential Action */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Provider Credentials & Expirations</h2>
              <p className="text-xs text-slate-500">
                Track licenses, DEA, board certifications, malpractice insurance, and CAQH profiles with alert windows.
              </p>
            </div>
            <button
              onClick={() => setShowAddCredentialModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition flex items-center space-x-1.5 self-start sm:self-auto"
            >
              <span>+ Add Credential</span>
            </button>
          </div>

          {/* Section 1: State Medical Licenses */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-900">
                State Medical Licenses ({provider.stateLicenses.length})
              </h3>
            </div>
            {provider.stateLicenses.length === 0 ? (
              <p className="text-xs text-slate-400">No state medical licenses recorded. Click &quot;+ Add Credential&quot; to add one.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {provider.stateLicenses.map((lic) => (
                  <div key={lic.id} className="p-4 border rounded-xl bg-slate-50/50 hover:bg-slate-50 transition space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 text-xs">
                        {lic.state} License #{lic.licenseNumber}
                      </span>
                      {lic.verified ? (
                        <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                          ✓ Verified
                        </span>
                      ) : (
                        <span className="text-[10px] text-amber-700 font-semibold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                          ⚠ Unverified
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      Type: {lic.licenseType || 'MD/DO'} • Status: {lic.status}
                    </div>
                    <div className="text-[11px] text-slate-600 flex items-center justify-between">
                      <span>Expires: {lic.expirationDate ? new Date(lic.expirationDate).toLocaleDateString() : 'N/A'}</span>
                      {renderExpirationBadge(lic.expirationDate)}
                    </div>
                    <div className="pt-2 border-t border-slate-200/60 flex items-center justify-end space-x-2 text-[11px]">
                      <button
                        onClick={() => {
                          setVerifyingCred({ id: lic.id, type: 'state_license', title: `${lic.state} License #${lic.licenseNumber}` });
                          setVerifMethod('state_board_website');
                          setVerifSource(`${lic.state} State Medical Board`);
                        }}
                        className="text-blue-600 hover:underline"
                      >
                        Verify
                      </button>
                      <button
                        onClick={() => {
                          setTaskModalCred({ id: lic.id, type: 'state_license', title: `${lic.state} License #${lic.licenseNumber}`, expDate: lic.expirationDate });
                          setTaskTitle(`Renew ${lic.state} License for Dr. ${provider.lastName}`);
                        }}
                        className="text-indigo-600 hover:underline"
                      >
                        + Task
                      </button>
                      <button
                        onClick={() => handleDeactivateCredential('state_license', lic.id)}
                        className="text-rose-600 hover:underline"
                      >
                        Deactivate
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 2: DEA Registrations */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-900">
                DEA Registrations ({provider.deaRegistrations.length})
              </h3>
            </div>
            {provider.deaRegistrations.length === 0 ? (
              <p className="text-xs text-slate-400">No DEA certificates registered.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {provider.deaRegistrations.map((dea) => (
                  <div key={dea.id} className="p-4 border rounded-xl bg-slate-50/50 hover:bg-slate-50 transition space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 text-xs font-mono">
                        DEA #{dea.deaNumber}
                      </span>
                      {dea.verified ? (
                        <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                          ✓ Verified
                        </span>
                      ) : (
                        <span className="text-[10px] text-amber-700 font-semibold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                          ⚠ Unverified
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      State: {dea.state || 'National'} • Status: {dea.status}
                    </div>
                    <div className="text-[11px] text-slate-600 flex items-center justify-between">
                      <span>Expires: {dea.expirationDate ? new Date(dea.expirationDate).toLocaleDateString() : 'N/A'}</span>
                      {renderExpirationBadge(dea.expirationDate)}
                    </div>
                    <div className="pt-2 border-t border-slate-200/60 flex items-center justify-end space-x-2 text-[11px]">
                      <button
                        onClick={() => {
                          setVerifyingCred({ id: dea.id, type: 'dea_registration', title: `DEA #${dea.deaNumber}` });
                          setVerifMethod('primary_source');
                          setVerifSource('DEA Diversion Control Division');
                        }}
                        className="text-blue-600 hover:underline"
                      >
                        Verify
                      </button>
                      <button
                        onClick={() => {
                          setTaskModalCred({ id: dea.id, type: 'dea_registration', title: `DEA #${dea.deaNumber}`, expDate: dea.expirationDate });
                          setTaskTitle(`Renew DEA #${dea.deaNumber} for Dr. ${provider.lastName}`);
                        }}
                        className="text-indigo-600 hover:underline"
                      >
                        + Task
                      </button>
                      <button
                        onClick={() => handleDeactivateCredential('dea_registration', dea.id)}
                        className="text-rose-600 hover:underline"
                      >
                        Deactivate
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 3: Board Certifications */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-900">
                Board Certifications ({provider.boardCertifications.length})
              </h3>
            </div>
            {provider.boardCertifications.length === 0 ? (
              <p className="text-xs text-slate-400">No board certifications recorded.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {provider.boardCertifications.map((b) => (
                  <div key={b.id} className="p-4 border rounded-xl bg-slate-50/50 hover:bg-slate-50 transition space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 text-xs">
                        {b.boardName} — {b.specialty}
                      </span>
                      {b.verified ? (
                        <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                          ✓ Verified
                        </span>
                      ) : (
                        <span className="text-[10px] text-amber-700 font-semibold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                          ⚠ Unverified
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Status: {b.status}
                    </div>
                    <div className="text-[11px] text-slate-600 flex items-center justify-between">
                      <span>Expires: {b.expirationDate ? new Date(b.expirationDate).toLocaleDateString() : 'Lifetime'}</span>
                      {renderExpirationBadge(b.expirationDate)}
                    </div>
                    <div className="pt-2 border-t border-slate-200/60 flex items-center justify-end space-x-2 text-[11px]">
                      <button
                        onClick={() => {
                          setVerifyingCred({ id: b.id, type: 'board_certification', title: `${b.boardName} (${b.specialty})` });
                          setVerifMethod('abms');
                          setVerifSource('ABMS CertCheck');
                        }}
                        className="text-blue-600 hover:underline"
                      >
                        Verify
                      </button>
                      <button
                        onClick={() => {
                          setTaskModalCred({ id: b.id, type: 'board_certification', title: `${b.boardName} (${b.specialty})`, expDate: b.expirationDate });
                          setTaskTitle(`MOC / Recertification for ${b.specialty}`);
                        }}
                        className="text-indigo-600 hover:underline"
                      >
                        + Task
                      </button>
                      <button
                        onClick={() => handleDeactivateCredential('board_certification', b.id)}
                        className="text-rose-600 hover:underline"
                      >
                        Deactivate
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 4: Malpractice Insurance */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-900">
                Malpractice Insurance Policies ({provider.malpracticePolicies.length})
              </h3>
            </div>
            {provider.malpracticePolicies.length === 0 ? (
              <p className="text-xs text-slate-400">No malpractice policies recorded.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {provider.malpracticePolicies.map((m) => (
                  <div key={m.id} className="p-4 border rounded-xl bg-slate-50/50 hover:bg-slate-50 transition space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 text-xs">
                        {m.carrierName}
                      </span>
                      {m.verified ? (
                        <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                          ✓ Verified
                        </span>
                      ) : (
                        <span className="text-[10px] text-amber-700 font-semibold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                          ⚠ Unverified
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      Policy #{m.policyNumber || 'On file'} • {m.coverageType || 'Occurrence'}
                    </div>
                    <div className="text-[11px] text-slate-600 flex items-center justify-between">
                      <span>Expires: {m.expirationDate ? new Date(m.expirationDate).toLocaleDateString() : 'N/A'}</span>
                      {renderExpirationBadge(m.expirationDate)}
                    </div>
                    <div className="pt-2 border-t border-slate-200/60 flex items-center justify-end space-x-2 text-[11px]">
                      <button
                        onClick={() => {
                          setVerifyingCred({ id: m.id, type: 'malpractice_insurance', title: `Malpractice: ${m.carrierName}` });
                          setVerifMethod('primary_source');
                          setVerifSource('Carrier Certificate of Insurance (COI)');
                        }}
                        className="text-blue-600 hover:underline"
                      >
                        Verify
                      </button>
                      <button
                        onClick={() => {
                          setTaskModalCred({ id: m.id, type: 'malpractice_insurance', title: `Malpractice: ${m.carrierName}`, expDate: m.expirationDate });
                          setTaskTitle(`Renew Malpractice COI with ${m.carrierName}`);
                        }}
                        className="text-indigo-600 hover:underline"
                      >
                        + Task
                      </button>
                      <button
                        onClick={() => handleDeactivateCredential('malpractice_insurance', m.id)}
                        className="text-rose-600 hover:underline"
                      >
                        Deactivate
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 5: CAQH ProView Profile */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-900">
                CAQH ProView Profile
              </h3>
            </div>
            {!provider.caqhProfile ? (
              <p className="text-xs text-slate-400">No CAQH profile linked. Click &quot;+ Add Credential&quot; to register CAQH information.</p>
            ) : (
              <div className="p-4 border rounded-xl bg-slate-50/50 space-y-2 max-w-lg">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 text-xs font-mono">
                    CAQH ID: {provider.caqhProfile.caqhId}
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                    provider.caqhProfile.attestationStatus === 'current'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}>
                    {provider.caqhProfile.attestationStatus.toUpperCase()}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  Username: {provider.caqhProfile.username || 'Not set'}
                </div>
                <div className="text-[11px] text-slate-600 flex items-center justify-between">
                  <span>Next Attestation Due: {provider.caqhProfile.nextAttestationDate ? new Date(provider.caqhProfile.nextAttestationDate).toLocaleDateString() : 'Unknown'}</span>
                  {renderExpirationBadge(provider.caqhProfile.nextAttestationDate)}
                </div>
                <div className="pt-2 border-t border-slate-200/60 flex items-center justify-end space-x-2 text-[11px]">
                  <button
                    onClick={() => {
                      setVerifyingCred({ id: provider.caqhProfile!.id, type: 'caqh_profile', title: `CAQH ID #${provider.caqhProfile!.caqhId}` });
                      setVerifMethod('caqh_proview');
                      setVerifSource('CAQH ProView Portal Direct Inspection');
                    }}
                    className="text-blue-600 hover:underline"
                  >
                    Attest / Verify
                  </button>
                  <button
                    onClick={() => {
                      setTaskModalCred({ id: provider.caqhProfile!.id, type: 'caqh_profile', title: `CAQH ID #${provider.caqhProfile!.caqhId}`, expDate: provider.caqhProfile!.nextAttestationDate });
                      setTaskTitle(`CAQH ProView 120-Day Re-attestation`);
                    }}
                    className="text-indigo-600 hover:underline"
                  >
                    + Task
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Section 6: Active Tasks for this Provider */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-900">
                Active Credential Tasks ({tasks.length})
              </h3>
            </div>
            {tasks.length === 0 ? (
              <p className="text-xs text-slate-400">No active work tasks for this provider or credentials.</p>
            ) : (
              <div className="space-y-2">
                {tasks.map((task) => (
                  <div key={task.id} className="p-3 border rounded-lg bg-slate-50 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-semibold text-slate-800">{task.title}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Due: {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'N/A'} • Assigned to: {task.assignedTo ? `${task.assignedTo.firstName} ${task.assignedTo.lastName}` : 'Unassigned'}
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        task.priority === 'urgent'
                          ? 'bg-red-100 text-red-800'
                          : task.priority === 'high'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}>
                        {task.priority}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] bg-slate-200 text-slate-700 font-semibold uppercase">
                        {task.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 7: Primary Source Verification (PSV) Log */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <div className="border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-900">
                Primary Source Verification (PSV) Audit Log
              </h3>
              <p className="text-xs text-slate-500">Historical records of primary-source verifications conducted for this provider</p>
            </div>
            {(!provider.verificationHistory || provider.verificationHistory.length === 0) ? (
              <p className="text-xs text-slate-400">No verification events recorded yet.</p>
            ) : (
              <div className="divide-y divide-slate-100 text-xs">
                {provider.verificationHistory.map((v) => (
                  <div key={v.id} className="py-2.5 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-slate-800">{v.entityType.replace('_', ' ').toUpperCase()}</span>
                      <span className="text-slate-500 ml-2">via {v.method} ({v.source})</span>
                      {v.notes && <div className="text-[11px] text-slate-400 mt-0.5">{v.notes}</div>}
                    </div>
                    <div className="text-right">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 uppercase">
                        {v.status}
                      </span>
                      <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                        {new Date(v.verifiedDate).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 5: Payer Enrollments (Phase 4) */}
      {activeTab === 'enrollments' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">Payer Enrollments ({provider.enrollments.length})</h2>
              <p className="text-xs text-slate-500">Commercial & government payer network participation (Individual & Group)</p>
            </div>
            <Link
              href="/enrollments"
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
            >
              Open Enrollment Work Queue →
            </Link>
          </div>

          {provider.enrollments.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              No payer enrollments recorded for this provider. Visit the Enrollment Work Queue to begin an application.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {provider.enrollments.map((enr) => {
                const missing = enr.missingItems || [];
                const openMissing = missing.filter((m) => !m.isResolved).length;

                return (
                  <div key={enr.id} className="p-4 border rounded-xl bg-slate-50/50 hover:bg-slate-50 transition space-y-2.5">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-bold text-slate-900 text-xs">{enr.payer.name}</div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {enr.payer.payerType || 'Commercial'} • {enr.payer.state || 'National'}
                        </div>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                        ['approved', 'active'].includes(enr.status)
                          ? 'bg-emerald-100 text-emerald-800'
                          : enr.status === 'needs_info'
                          ? 'bg-amber-100 text-amber-800'
                          : enr.status === 'denied'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {enr.status.replace('_', ' ')}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2 text-[11px]">
                      {enr.enrollmentType === 'group' ? (
                        <span className="px-1.5 py-0.2 rounded font-bold text-[10px] bg-indigo-100 text-indigo-800 font-mono">
                          GROUP (NPI: {enr.groupNpi || 'None'})
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.2 rounded font-semibold text-[10px] bg-slate-200 text-slate-700">
                          INDIVIDUAL
                        </span>
                      )}
                      {enr.trackingNumber && (
                        <span className="text-slate-400 font-mono text-[10px]">
                          Ref: {enr.trackingNumber}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 pt-1 border-t border-slate-200/60">
                      <div>
                        <span className="text-slate-400 block text-[10px]">Effective Date</span>
                        <span className="font-mono font-medium">
                          {enr.effectiveDate ? new Date(enr.effectiveDate).toLocaleDateString() : 'Pending'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Next Follow-Up</span>
                        <span className="font-mono font-medium">
                          {enr.followUpDate ? new Date(enr.followUpDate).toLocaleDateString() : 'None set'}
                        </span>
                      </div>
                      {enr.revalidationDate && (
                        <div>
                          <span className="text-slate-400 block text-[10px]">Revalidation Due</span>
                          <span className="font-mono font-medium text-purple-700">
                            {new Date(enr.revalidationDate).toLocaleDateString()}
                          </span>
                        </div>
                      )}
                      <div>
                        <span className="text-slate-400 block text-[10px]">Missing Checklist</span>
                        {openMissing > 0 ? (
                          <span className="text-amber-700 font-semibold text-[10px]">
                            ⚠ {openMissing} open items
                          </span>
                        ) : (
                          <span className="text-emerald-700 text-[10px]">✓ All complete</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 6: Documents & Verification */}
      {activeTab === 'documents' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Provider Documents Repository</h2>
              <p className="text-xs text-slate-500">
                Primary source documents, licenses, certifications, contracts, and version records
              </p>
            </div>
            <Link
              href="/documents"
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm transition"
            >
              + Upload in Document Center
            </Link>
          </div>

          {providerDocs.length === 0 ? (
            <div className="py-12 text-center">
              <div className="text-3xl mb-2">📄</div>
              <div className="text-xs font-semibold text-slate-700">No documents uploaded for this provider yet</div>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Upload credential certificates, malpractice policies, or signed agreements in the Document Center.
              </p>
              <Link
                href="/documents"
                className="mt-3 inline-block px-3 py-1.5 text-xs font-medium text-blue-600 hover:underline"
              >
                Go to Document Center →
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {providerDocs.map((doc: any) => (
                <div
                  key={doc.id}
                  className="p-4 rounded-xl border border-slate-200 hover:border-blue-300 transition bg-white flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-sm text-slate-900">{doc.title}</div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${
                          doc.status === 'verified'
                            ? 'bg-emerald-100 text-emerald-800'
                            : doc.status === 'rejected'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {doc.status.replace(/_/g, ' ')}
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

                    {doc.rejectionReason && (
                      <div className="mt-2 text-xs text-rose-700 bg-rose-50 p-2 rounded border border-rose-200">
                        <strong>Rejection Reason:</strong> {doc.rejectionReason}
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

      {/* Tab: Tasks */}
      {activeTab === 'tasks' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Provider Operational Tasks</h2>
              <p className="text-xs text-slate-500">
                Actionable tasks, verifications, and reminders associated with this provider
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/tasks"
                className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50 transition"
              >
                Open Full Work Queue →
              </Link>
            </div>
          </div>

          {tasks.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-xs">
              <div className="text-2xl mb-1">✅</div>
              No operational tasks logged for this provider.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 border-b border-slate-200 uppercase font-semibold text-slate-500">
                  <tr>
                    <th className="py-2.5 px-3">Task</th>
                    <th className="py-2.5 px-3">Priority</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Due Date</th>
                    <th className="py-2.5 px-3">Assigned To</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tasks.map((task) => (
                    <tr key={task.id} className="hover:bg-slate-50/60">
                      <td className="py-2.5 px-3 font-medium text-slate-900">
                        {task.title}
                        {task.description && (
                          <div className="text-slate-400 text-[11px] font-normal">{task.description}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                            task.priority === 'urgent'
                              ? 'bg-rose-100 text-rose-800'
                              : task.priority === 'high'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {task.priority}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium capitalize ${
                            task.status === 'completed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : task.status === 'in_progress'
                              ? 'bg-sky-100 text-sky-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {task.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        {task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : '—'}
                      </td>
                      <td className="py-2.5 px-3">
                        {task.assignedTo ? `${task.assignedTo.firstName} ${task.assignedTo.lastName}` : 'Unassigned'}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {task.status !== 'completed' ? (
                          <button
                            onClick={() => handleCompleteProviderTask(task.id)}
                            className="px-2 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded border border-emerald-200 text-[11px] font-medium transition"
                          >
                            ✓ Complete
                          </button>
                        ) : (
                          <span className="text-emerald-600 font-medium text-[11px]">Completed</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Notes */}
      {activeTab === 'notes' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-6">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900">Provider Operational Notes</h2>
            <p className="text-xs text-slate-500">
              Collaborative notes, call logs, and context preserved across the credentialing lifecycle
            </p>
          </div>

          {/* New Note Form */}
          <form onSubmit={handleAddNote} className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
            <label className="block text-xs font-semibold text-slate-700">Add Operational Note</label>
            <textarea
              required
              rows={3}
              value={newNoteContent}
              onChange={(e) => setNewNoteContent(e.target.value)}
              placeholder="Record a follow-up call, provider update, or verification detail..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex items-center justify-between">
              <label className="flex items-center space-x-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newNotePinned}
                  onChange={(e) => setNewNotePinned(e.target.checked)}
                  className="rounded text-blue-600"
                />
                <span>📌 Pin this note to the top</span>
              </label>
              <button
                type="submit"
                disabled={submittingNote || !newNoteContent.trim()}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium disabled:opacity-50 transition"
              >
                {submittingNote ? 'Saving...' : 'Post Note'}
              </button>
            </div>
          </form>

          {/* Notes List */}
          {providerNotes.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-xs">
              <div className="text-2xl mb-1">📝</div>
              No operational notes recorded yet.
            </div>
          ) : (
            <div className="space-y-3">
              {providerNotes.map((note) => (
                <div
                  key={note.id}
                  className={`p-4 rounded-xl border transition ${
                    note.isPinned
                      ? 'bg-amber-50/40 border-amber-300 shadow-sm'
                      : 'bg-white border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {note.isPinned && (
                        <span className="text-xs bg-amber-100 text-amber-800 font-bold px-1.5 py-0.5 rounded border border-amber-200">
                          📌 Pinned
                        </span>
                      )}
                      <span className="text-xs font-bold text-slate-800">
                        {note.createdBy
                          ? `${note.createdBy.firstName} ${note.createdBy.lastName}`
                          : 'Staff Member'}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {new Date(note.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleTogglePinNote(note.id, note.isPinned)}
                        className="text-xs text-slate-500 hover:text-slate-800"
                        title={note.isPinned ? 'Unpin' : 'Pin to top'}
                      >
                        {note.isPinned ? 'Unpin' : '📌 Pin'}
                      </button>
                      <button
                        onClick={() => handleDeleteNote(note.id)}
                        className="text-xs text-rose-500 hover:text-rose-700"
                        title="Delete note"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {note.content}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 7: Audit History */}
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
      {/* Modal: Add Credential */}
      {showAddCredentialModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-1">Add Provider Credential</h3>
            <p className="text-xs text-slate-500 mb-4">Register new license, certificate, policy, or profile</p>
            <form onSubmit={handleAddCredential} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Credential Type *
                </label>
                <select
                  value={addCredType}
                  onChange={(e) => setAddCredType(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="state_license">State Medical License</option>
                  <option value="dea_registration">DEA Registration</option>
                  <option value="board_certification">Board Certification</option>
                  <option value="malpractice_insurance">Malpractice Insurance</option>
                  <option value="caqh_profile">CAQH ProView Profile</option>
                </select>
              </div>

              {(addCredType === 'state_license' || addCredType === 'dea_registration') && (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    State / Jurisdiction (2 Letters) {addCredType === 'state_license' ? '*' : ''}
                  </label>
                  <input
                    type="text"
                    maxLength={2}
                    required={addCredType === 'state_license'}
                    value={addCredState}
                    onChange={(e) => setAddCredState(e.target.value.toUpperCase())}
                    placeholder="e.g. CA, NY, TX"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {addCredType === 'state_license'
                    ? 'License Number *'
                    : addCredType === 'dea_registration'
                    ? 'DEA Registration # (2 Letters + 7 Digits) *'
                    : addCredType === 'board_certification'
                    ? 'Specialty Area *'
                    : addCredType === 'malpractice_insurance'
                    ? 'Policy Number'
                    : 'CAQH ID (8-10 Digits) *'}
                </label>
                <input
                  type="text"
                  required
                  value={addCredNumber}
                  onChange={(e) => setAddCredNumber(e.target.value)}
                  placeholder={
                    addCredType === 'dea_registration'
                      ? 'e.g. AB1234567'
                      : addCredType === 'caqh_profile'
                      ? 'e.g. 12345678'
                      : 'Identifier / number'
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>

              {addCredType !== 'caqh_profile' && (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {addCredType === 'state_license'
                      ? 'License Type (e.g. MD, DO)'
                      : addCredType === 'dea_registration'
                      ? 'Authorized Drug Schedules'
                      : addCredType === 'board_certification'
                      ? 'Certifying Board Organization (e.g. ABIM)'
                      : 'Insurance Carrier Name'}
                  </label>
                  <input
                    type="text"
                    value={addCredSubtype}
                    onChange={(e) => setAddCredSubtype(e.target.value)}
                    placeholder="Details / issuing body"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {addCredType === 'caqh_profile' ? 'Last Attested' : 'Issue / Effective Date'}
                  </label>
                  <input
                    type="date"
                    value={addCredIssueDate}
                    onChange={(e) => setAddCredIssueDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {addCredType === 'caqh_profile' ? 'Next Due *' : 'Expiration Date *'}
                  </label>
                  <input
                    type="date"
                    required
                    value={addCredExpDate}
                    onChange={(e) => setAddCredExpDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddCredentialModal(false)}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addCredSubmitting}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg"
                >
                  {addCredSubmitting ? 'Saving...' : 'Add Credential'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Verify Credential */}
      {verifyingCred && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-1">
              Primary Source Verification (PSV)
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Recording PSV for {verifyingCred.title}
            </p>

            <form onSubmit={handleSubmitVerification} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Verification Method *
                </label>
                <select
                  value={verifMethod}
                  onChange={(e) => setVerifMethod(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="state_board_website">State Board Online Registry</option>
                  <option value="primary_source">Primary Source Direct Attestation</option>
                  <option value="nppes">NPPES Public Registry</option>
                  <option value="abms">ABMS Certification Database</option>
                  <option value="caqh_proview">CAQH ProView Portal</option>
                  <option value="phone">Direct Phone Verification</option>
                  <option value="manual">Document Inspection</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Verification Source / URL *
                </label>
                <input
                  type="text"
                  required
                  value={verifSource}
                  onChange={(e) => setVerifSource(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Verification Outcome *
                </label>
                <select
                  value={verifStatus}
                  onChange={(e) => setVerifStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="verified">Verified (No discrepancies)</option>
                  <option value="discrepancy">Discrepancy Noted</option>
                  <option value="unable_to_verify">Unable to Verify</option>
                  <option value="pending">Pending Follow-up</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Verification Notes
                </label>
                <textarea
                  rows={2}
                  value={verifNotes}
                  onChange={(e) => setVerifNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  placeholder="Notes, license status confirmed, etc."
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setVerifyingCred(null)}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={verifSubmitting}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg"
                >
                  {verifSubmitting ? 'Saving...' : 'Save PSV Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create Task for Credential */}
      {taskModalCred && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-1">
              Create Credential Task
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Add actionable task for {taskModalCred.title}
            </p>

            <form onSubmit={handleSubmitTask} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Task Title *
                </label>
                <input
                  type="text"
                  required
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Priority *
                  </label>
                  <select
                    value={taskPriority}
                    onChange={(e) => setTaskPriority(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="urgent">Urgent</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={taskDueDate}
                    onChange={(e) => setTaskDueDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTaskModalCred(null)}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={taskSubmitting}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-lg"
                >
                  {taskSubmitting ? 'Creating...' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Affiliate Organization */}
      {showAffiliateOrgModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-1">Affiliate Organization</h3>
            <p className="text-xs text-slate-500 mb-4">
              Associate this provider with an existing medical group or healthcare system
            </p>

            <form onSubmit={handleAffiliateOrg} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Select Organization *
                </label>
                {allOrganizations.length === 0 ? (
                  <div className="text-xs text-slate-500 p-3 bg-slate-50 rounded-lg">
                    Loading organizations from directory...
                  </div>
                ) : (
                  <select
                    required
                    value={affiliateOrgId}
                    onChange={(e) => setAffiliateOrgId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">-- Choose an organization --</option>
                    {allOrganizations.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name} {org.dbaName ? `(${org.dbaName})` : ''} - NPI: {org.npiNumber || 'N/A'} ({org.city}, {org.state})
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
                  value={affiliateEmploymentType}
                  onChange={(e) => setAffiliateEmploymentType(e.target.value)}
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
                  id="affiliateIsPrimary"
                  checked={affiliateIsPrimary}
                  onChange={(e) => setAffiliateIsPrimary(e.target.checked)}
                  className="h-4 w-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                />
                <label htmlFor="affiliateIsPrimary" className="text-slate-700 font-medium cursor-pointer">
                  Set as primary organization affiliation
                </label>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAffiliateOrgModal(false)}
                  className="px-3.5 py-1.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={affiliateSubmitting || !affiliateOrgId}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg"
                >
                  {affiliateSubmitting ? 'Affiliating...' : 'Affiliate Provider'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
