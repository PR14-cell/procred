'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface DocumentVersion {
  id: string;
  versionNumber: number;
  fileName: string;
  fileSize: number;
  mimeType: string;
  checksumSha256: string | null;
  createdAt: string;
  uploadedBy?: { id: string; firstName: string; lastName: string } | null;
}

interface DocumentItem {
  id: string;
  entityType: string;
  entityId: string;
  providerId: string | null;
  documentType: string;
  title: string;
  description: string | null;
  status: string;
  issueDate: string | null;
  expirationDate: string | null;
  verifiedAt: string | null;
  verificationNotes: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  provider?: {
    id: string;
    firstName: string;
    lastName: string;
    npiNumber: string | null;
  } | null;
  uploadedBy?: { id: string; firstName: string; lastName: string; email: string } | null;
  verifiedBy?: { id: string; firstName: string; lastName: string; email: string } | null;
  currentVersion?: DocumentVersion | null;
  versions?: DocumentVersion[];
}

interface SummaryCounts {
  totalCount: number;
  pendingReviewCount: number;
  verifiedCount: number;
  rejectedCount: number;
  expiringSoonCount: number;
  expiredCount: number;
}

interface CurrentUser {
  id: string;
  email: string;
  role: string;
  firstName?: string;
  lastName?: string;
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [summaryCounts, setSummaryCounts] = useState<SummaryCounts>({
    totalCount: 0,
    pendingReviewCount: 0,
    verifiedCount: 0,
    rejectedCount: 0,
    expiringSoonCount: 0,
    expiredCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [expiringFilter, setExpiringFilter] = useState<'all' | 'expiring' | 'expired'>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Modals state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<DocumentItem | null>(null);
  const [docToDelete, setDocToDelete] = useState<DocumentItem | null>(null);

  // Upload Form state
  const [providersList, setProvidersList] = useState<{ id: string; firstName: string; lastName: string; npiNumber: string | null }[]>([]);
  const [uploadFormData, setUploadFormData] = useState({
    providerId: '',
    documentType: 'state_license',
    title: '',
    description: '',
    issueDate: '',
    expirationDate: '',
  });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    title?: string;
    documentType?: string;
    file?: string;
    issueDate?: string;
    expirationDate?: string;
  }>({});

  // Version Form state
  const [versionFile, setVersionFile] = useState<File | null>(null);
  const [versionNotes, setVersionNotes] = useState('');

  // Verify Form state
  const [verifyStatus, setVerifyStatus] = useState<'verified' | 'rejected'>('verified');
  const [verificationNotes, setVerificationNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  // Fetch current user identity & role
  useEffect(() => {
    fetch('/api/v1/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (d.user) setCurrentUser(d.user);
      })
      .catch((e) => console.warn('Could not load current user profile:', e));
  }, []);

  const isAdmin = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (typeFilter !== 'all') params.set('documentType', typeFilter);
      if (expiringFilter === 'expiring') params.set('isExpiringSoon', 'true');
      if (expiringFilter === 'expired') params.set('isExpired', 'true');
      params.set('page', page.toString());
      params.set('limit', '15');

      const res = await fetch(`/api/v1/documents?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents || []);
        if (data.summaryCounts) setSummaryCounts(data.summaryCounts);
        if (data.pagination) setTotalPages(data.pagination.totalPages || 1);
      }
    } catch (err) {
      console.error('Failed to load documents:', err);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, typeFilter, expiringFilter, page]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // Load providers for upload selector
  useEffect(() => {
    fetch('/api/v1/providers?limit=100')
      .then((r) => r.json())
      .then((d) => setProvidersList(d.providers || []))
      .catch((e) => console.warn('Could not load providers list:', e));
  }, []);

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setFormError(null);
    const errors: typeof fieldErrors = {};

    // 1. Title validation (required, no whitespace-only, min 2 chars)
    const trimmedTitle = uploadFormData.title.trim();
    if (!trimmedTitle) {
      errors.title = 'Document title is required.';
    } else if (trimmedTitle.length < 2) {
      errors.title = 'Document title must be at least 2 characters.';
    }

    // 2. Category validation (required)
    if (!uploadFormData.documentType) {
      errors.documentType = 'Document category is required.';
    }

    // 3. File validation (required, <= 25MB, supported MIME)
    if (!uploadFile) {
      errors.file = 'Please select a file to upload.';
    } else {
      if (uploadFile.size > 25 * 1024 * 1024) {
        errors.file = `File size (${(uploadFile.size / (1024 * 1024)).toFixed(2)} MB) exceeds 25 MB limit.`;
      }
      const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
      if (!allowedTypes.includes(uploadFile.type)) {
        errors.file = 'Only PDF, JPEG, and PNG files are supported.';
      }
    }

    // 4. Date range validation
    if (uploadFormData.issueDate && uploadFormData.expirationDate) {
      if (new Date(uploadFormData.expirationDate) < new Date(uploadFormData.issueDate)) {
        errors.expirationDate = 'Expiration date must be on or after issue date.';
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = (reader.result as string).split(',')[1];
        const res = await fetch('/api/v1/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            providerId: uploadFormData.providerId ? uploadFormData.providerId : null,
            documentType: uploadFormData.documentType,
            title: trimmedTitle,
            description: uploadFormData.description.trim() || null,
            issueDate: uploadFormData.issueDate || null,
            expirationDate: uploadFormData.expirationDate || null,
            fileName: uploadFile!.name,
            mimeType: uploadFile!.type || 'application/pdf',
            fileBase64: base64Data,
          }),
        });

        if (res.ok) {
          setShowUploadModal(false);
          setUploadFile(null);
          setFieldErrors({});
          setUploadFormData({
            providerId: '',
            documentType: 'state_license',
            title: '',
            description: '',
            issueDate: '',
            expirationDate: '',
          });
          fetchDocuments();
        } else {
          const errData = await res.json();
          if (errData.details && typeof errData.details === 'object') {
            const serverFieldErrors: typeof fieldErrors = {};
            for (const [key, val] of Object.entries(errData.details)) {
              if (Array.isArray(val) && val.length > 0) {
                serverFieldErrors[key as keyof typeof fieldErrors] = val[0] as string;
              }
            }
            setFieldErrors(serverFieldErrors);
          }
          setFormError(errData.message || 'Upload failed.');
        }
        setIsSubmitting(false);
      };
      reader.readAsDataURL(uploadFile!);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Upload failed');
      setIsSubmitting(false);
    }
  };

  const handleAddVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDoc || !versionFile || isSubmitting) return;

    setIsSubmitting(true);
    setFormError(null);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = (reader.result as string).split(',')[1];
        const res = await fetch(`/api/v1/documents/${selectedDoc.id}/versions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: versionFile.name,
            mimeType: versionFile.type || 'application/pdf',
            fileBase64: base64Data,
            notes: versionNotes.trim() || null,
          }),
        });

        if (res.ok) {
          setShowVersionModal(false);
          setVersionFile(null);
          setVersionNotes('');
          fetchDocuments();
        } else {
          const errData = await res.json();
          setFormError(errData.message || 'Failed to upload revised version.');
        }
        setIsSubmitting(false);
      };
      reader.readAsDataURL(versionFile);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Version upload failed');
      setIsSubmitting(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDoc || isSubmitting) return;

    if (verifyStatus === 'rejected' && (!rejectionReason || rejectionReason.trim().length < 3)) {
      setFormError('Rejection reason of at least 3 characters is required.');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      const res = await fetch(`/api/v1/documents/${selectedDoc.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: verifyStatus,
          verificationNotes: verificationNotes.trim() || null,
          rejectionReason: verifyStatus === 'rejected' ? rejectionReason.trim() : null,
        }),
      });

      if (res.ok) {
        setShowVerifyModal(false);
        setVerificationNotes('');
        setRejectionReason('');
        fetchDocuments();
      } else {
        const errData = await res.json();
        setFormError(errData.message || 'Failed to update verification status.');
      }
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteDocument = async () => {
    if (!docToDelete || isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);

    try {
      const res = await fetch(`/api/v1/documents/${docToDelete.id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setShowDeleteModal(false);
        setDocToDelete(null);
        fetchDocuments();
      } else {
        const errData = await res.json();
        setDeleteError(errData.message || 'Failed to delete document.');
      }
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Deletion failed');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleTriggerScan = async () => {
    try {
      const res = await fetch('/api/v1/documents/scan', { method: 'POST' });
      if (res.ok) {
        alert('Document expiration and backlog scan completed.');
        fetchDocuments();
      }
    } catch {
      alert('Failed to trigger scan.');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'verified':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">Verified</span>;
      case 'pending_review':
      case 'uploaded':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">Pending Review</span>;
      case 'rejected':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-300">Rejected</span>;
      case 'expired':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-200 text-slate-800 border border-slate-300">Expired</span>;
      case 'superseded':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-300">Superseded</span>;
      default:
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">{status}</span>;
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Documents Repository & Verification</h1>
          <p className="text-sm text-slate-500 mt-1">
            Secure multi-version storage, primary source verification, and expiration monitoring.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={handleTriggerScan}
            className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 shadow-sm"
          >
            ⚡ Scan Expirations
          </button>
          <button
            onClick={() => {
              setFormError(null);
              setFieldErrors({});
              setShowUploadModal(true);
            }}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition"
          >
            + Upload Document
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div
          onClick={() => { setStatusFilter('all'); setExpiringFilter('all'); }}
          className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm cursor-pointer hover:border-blue-400 transition"
        >
          <div className="text-xs font-medium text-slate-500">Total Documents</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{summaryCounts.totalCount}</div>
        </div>
        <div
          onClick={() => { setStatusFilter('pending_review'); setExpiringFilter('all'); }}
          className="bg-white p-4 rounded-xl border border-amber-200 shadow-sm cursor-pointer hover:border-amber-400 transition"
        >
          <div className="text-xs font-medium text-amber-700 flex items-center justify-between">
            <span>Pending Review</span>
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
          </div>
          <div className="text-2xl font-bold text-amber-900 mt-1">{summaryCounts.pendingReviewCount}</div>
        </div>
        <div
          onClick={() => { setStatusFilter('verified'); setExpiringFilter('all'); }}
          className="bg-white p-4 rounded-xl border border-emerald-200 shadow-sm cursor-pointer hover:border-emerald-400 transition"
        >
          <div className="text-xs font-medium text-emerald-700">Verified</div>
          <div className="text-2xl font-bold text-emerald-900 mt-1">{summaryCounts.verifiedCount}</div>
        </div>
        <div
          onClick={() => { setStatusFilter('rejected'); setExpiringFilter('all'); }}
          className="bg-white p-4 rounded-xl border border-rose-200 shadow-sm cursor-pointer hover:border-rose-400 transition"
        >
          <div className="text-xs font-medium text-rose-700">Rejected</div>
          <div className="text-2xl font-bold text-rose-900 mt-1">{summaryCounts.rejectedCount}</div>
        </div>
        <div
          onClick={() => { setExpiringFilter('expiring'); setStatusFilter('all'); }}
          className="bg-white p-4 rounded-xl border border-orange-200 shadow-sm cursor-pointer hover:border-orange-400 transition"
        >
          <div className="text-xs font-medium text-orange-700">Expiring Soon (30d)</div>
          <div className="text-2xl font-bold text-orange-900 mt-1">{summaryCounts.expiringSoonCount}</div>
        </div>
        <div
          onClick={() => { setExpiringFilter('expired'); setStatusFilter('all'); }}
          className="bg-white p-4 rounded-xl border border-slate-300 shadow-sm cursor-pointer hover:border-slate-500 transition"
        >
          <div className="text-xs font-medium text-slate-600">Expired</div>
          <div className="text-2xl font-bold text-slate-800 mt-1">{summaryCounts.expiredCount}</div>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex-1 max-w-md">
          <input
            type="text"
            placeholder="Search document title, description, or provider..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Document Types</option>
            <option value="state_license">State License</option>
            <option value="dea_registration">DEA Registration</option>
            <option value="board_certification">Board Certification</option>
            <option value="malpractice_insurance">Malpractice Policy</option>
            <option value="caqh_profile">CAQH Profile</option>
            <option value="payer_application">Payer Application</option>
            <option value="payer_approval_letter">Payer Approval Letter</option>
            <option value="w9">W-9 Form</option>
            <option value="identity_proof">Identity / Passport</option>
            <option value="cme_certificate">CME Certificate</option>
            <option value="other">Other Credential</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Statuses</option>
            <option value="pending_review">Pending Review</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
            <option value="expired">Expired</option>
          </select>
        </div>
      </div>

      {/* Documents Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-sm text-slate-500">Loading documents...</div>
        ) : documents.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-4xl mb-3">📄</div>
            <div className="text-base font-semibold text-slate-800">No documents found</div>
            <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
              No document records match the active criteria. Click &quot;+ Upload Document&quot; to upload credentials or enrollment forms.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  <th className="px-5 py-3">Document Title & Type</th>
                  <th className="px-5 py-3">Associated Provider</th>
                  <th className="px-5 py-3">Current Version</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Expiration Date</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {documents.map((doc) => {
                  const isExpSoon =
                    doc.expirationDate &&
                    new Date(doc.expirationDate) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) &&
                    new Date(doc.expirationDate) >= new Date();
                  const isPast = doc.expirationDate && new Date(doc.expirationDate) < new Date();

                  return (
                    <tr key={doc.id} className="hover:bg-slate-50/75 transition">
                      <td className="px-5 py-4">
                        <div className="font-semibold text-slate-900">{doc.title}</div>
                        <div className="text-xs text-slate-500 flex items-center space-x-2 mt-0.5">
                          <span className="capitalize">{doc.documentType.replace(/_/g, ' ')}</span>
                          <span>•</span>
                          <span>Uploaded {new Date(doc.createdAt).toLocaleDateString()}</span>
                        </div>
                        {doc.rejectionReason && (
                          <div className="mt-1.5 text-xs text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 inline-block">
                            Rejection: {doc.rejectionReason}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {doc.provider ? (
                          <div>
                            <Link
                              href={`/providers/${doc.provider.id}`}
                              className="font-medium text-blue-600 hover:underline"
                            >
                              Dr. {doc.provider.firstName} {doc.provider.lastName}
                            </Link>
                            {doc.provider.npiNumber && (
                              <div className="text-xs text-slate-400">NPI: {doc.provider.npiNumber}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 capitalize">
                            {doc.entityType === 'general' ? 'General Record (No Provider)' : `${doc.entityType.replace(/_/g, ' ')} Record`}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {doc.currentVersion ? (
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-blue-100 text-blue-800 rounded">
                                v{doc.currentVersion.versionNumber}
                              </span>
                              <span className="text-xs text-slate-600 truncate max-w-[140px]" title={doc.currentVersion.fileName}>
                                {doc.currentVersion.fileName}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              {formatFileSize(doc.currentVersion.fileSize)} • {doc.currentVersion.mimeType.split('/')[1]?.toUpperCase()}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">No file</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {getStatusBadge(doc.status)}
                        {doc.verifiedBy && (
                          <div className="text-[11px] text-slate-400 mt-1">
                            by {doc.verifiedBy.firstName} {doc.verifiedBy.lastName}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {doc.expirationDate ? (
                          <div className={`text-xs font-medium ${isPast ? 'text-rose-700' : isExpSoon ? 'text-amber-700' : 'text-slate-700'}`}>
                            {new Date(doc.expirationDate).toLocaleDateString()}
                            {isPast && <span className="block text-[10px] font-bold text-rose-600">EXPIRED</span>}
                            {isExpSoon && <span className="block text-[10px] font-bold text-amber-600">EXPIRING SOON</span>}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">N/A</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <a
                            href={`/api/v1/documents/${doc.id}/download`}
                            download
                            className="px-2.5 py-1 text-xs font-medium rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 transition"
                            title="Download Current File"
                          >
                            Download
                          </a>
                          <button
                            onClick={() => {
                              setSelectedDoc(doc);
                              setVerifyStatus('verified');
                              setVerificationNotes('');
                              setRejectionReason('');
                              setFormError(null);
                              setShowVerifyModal(true);
                            }}
                            className="px-2.5 py-1 text-xs font-semibold rounded bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100 transition"
                          >
                            Review
                          </button>
                          <button
                            onClick={() => {
                              setSelectedDoc(doc);
                              setVersionFile(null);
                              setVersionNotes('');
                              setFormError(null);
                              setShowVersionModal(true);
                            }}
                            className="px-2.5 py-1 text-xs font-medium rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 transition"
                          >
                            + Revise
                          </button>
                          <button
                            onClick={() => {
                              setSelectedDoc(doc);
                              setShowHistoryModal(true);
                            }}
                            className="px-2 py-1 text-xs font-medium rounded text-slate-500 hover:bg-slate-100 transition"
                            title="Version History"
                          >
                            History ({doc.versions?.length || 1})
                          </button>
                          {isAdmin && (
                            <button
                              onClick={() => {
                                setDocToDelete(doc);
                                setDeleteError(null);
                                setShowDeleteModal(true);
                              }}
                              className="px-2.5 py-1 text-xs font-semibold rounded bg-rose-50 text-rose-700 border border-rose-300 hover:bg-rose-100 transition"
                              title="Delete Document (Administrator only)"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
            <div>Page {page} of {totalPages}</div>
            <div className="flex space-x-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1 rounded border border-slate-300 bg-white disabled:opacity-50"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 rounded border border-slate-300 bg-white disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Upload Document Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-4">
              <h3 className="text-lg font-bold text-slate-900">Upload New Credentialing Document</h3>
              <button
                onClick={() => {
                  if (!isSubmitting) setShowUploadModal(false);
                }}
                className="text-slate-400 hover:text-slate-600 text-lg"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
                {formError}
              </div>
            )}

            <form onSubmit={handleFileUpload} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                  Associated Provider <span className="text-slate-400 lowercase font-normal">(optional)</span>
                </label>
                <select
                  value={uploadFormData.providerId}
                  onChange={(e) => setUploadFormData({ ...uploadFormData, providerId: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">No Provider (General Organization Document)</option>
                  {providersList.map((p) => (
                    <option key={p.id} value={p.id}>
                      Dr. {p.firstName} {p.lastName} {p.npiNumber ? `(NPI: ${p.npiNumber})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                    Document Category <span className="text-rose-600">*</span>
                  </label>
                  <select
                    value={uploadFormData.documentType}
                    onChange={(e) => {
                      setUploadFormData({ ...uploadFormData, documentType: e.target.value });
                      if (fieldErrors.documentType) {
                        setFieldErrors({ ...fieldErrors, documentType: undefined });
                      }
                    }}
                    className={`w-full px-3 py-2 text-sm rounded-lg border ${
                      fieldErrors.documentType ? 'border-rose-400 bg-rose-50/50' : 'border-slate-300'
                    } focus:ring-2 focus:ring-blue-500`}
                  >
                    <option value="state_license">State License</option>
                    <option value="dea_registration">DEA Registration</option>
                    <option value="board_certification">Board Certification</option>
                    <option value="malpractice_insurance">Malpractice Insurance</option>
                    <option value="caqh_profile">CAQH Profile / Attestation</option>
                    <option value="payer_application">Payer Application</option>
                    <option value="payer_approval_letter">Payer Approval Letter</option>
                    <option value="w9">W-9 Form</option>
                    <option value="identity_proof">Identity / Passport</option>
                    <option value="cme_certificate">CME Certificate</option>
                    <option value="other">Other Credential</option>
                  </select>
                  {fieldErrors.documentType && (
                    <p className="text-xs text-rose-600 mt-1">{fieldErrors.documentType}</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                    Document Title <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Texas Medical License 2026"
                    value={uploadFormData.title}
                    onChange={(e) => {
                      setUploadFormData({ ...uploadFormData, title: e.target.value });
                      if (fieldErrors.title) {
                        setFieldErrors({ ...fieldErrors, title: undefined });
                      }
                    }}
                    className={`w-full px-3 py-2 text-sm rounded-lg border ${
                      fieldErrors.title ? 'border-rose-400 bg-rose-50/50' : 'border-slate-300'
                    } focus:ring-2 focus:ring-blue-500`}
                  />
                  {fieldErrors.title && (
                    <p className="text-xs text-rose-600 mt-1">{fieldErrors.title}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Issue Date</label>
                  <input
                    type="date"
                    value={uploadFormData.issueDate}
                    onChange={(e) => {
                      setUploadFormData({ ...uploadFormData, issueDate: e.target.value });
                      if (fieldErrors.issueDate || fieldErrors.expirationDate) {
                        setFieldErrors({ ...fieldErrors, issueDate: undefined, expirationDate: undefined });
                      }
                    }}
                    className={`w-full px-3 py-2 text-sm rounded-lg border ${
                      fieldErrors.issueDate ? 'border-rose-400 bg-rose-50/50' : 'border-slate-300'
                    } focus:ring-2 focus:ring-blue-500`}
                  />
                  {fieldErrors.issueDate && (
                    <p className="text-xs text-rose-600 mt-1">{fieldErrors.issueDate}</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Expiration Date</label>
                  <input
                    type="date"
                    value={uploadFormData.expirationDate}
                    onChange={(e) => {
                      setUploadFormData({ ...uploadFormData, expirationDate: e.target.value });
                      if (fieldErrors.expirationDate) {
                        setFieldErrors({ ...fieldErrors, expirationDate: undefined });
                      }
                    }}
                    className={`w-full px-3 py-2 text-sm rounded-lg border ${
                      fieldErrors.expirationDate ? 'border-rose-400 bg-rose-50/50' : 'border-slate-300'
                    } focus:ring-2 focus:ring-blue-500`}
                  />
                  {fieldErrors.expirationDate && (
                    <p className="text-xs text-rose-600 mt-1">{fieldErrors.expirationDate}</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Description / Notes</label>
                <textarea
                  rows={2}
                  placeholder="Primary source notes, verification ID, etc."
                  value={uploadFormData.description}
                  onChange={(e) => setUploadFormData({ ...uploadFormData, description: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                  Document File (PDF, JPEG, PNG, max 25MB) <span className="text-rose-600">*</span>
                </label>
                <div
                  className={`border-2 border-dashed rounded-xl p-4 text-center transition ${
                    fieldErrors.file ? 'border-rose-400 bg-rose-50/30' : 'border-slate-300 hover:border-blue-500'
                  }`}
                >
                  <input
                    type="file"
                    required
                    accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        const file = e.target.files[0];
                        setUploadFile(file);
                        if (fieldErrors.file) {
                          setFieldErrors({ ...fieldErrors, file: undefined });
                        }
                      }
                    }}
                    className="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                  />
                  {uploadFile && (
                    <div className="mt-2 text-xs text-emerald-700 font-medium">
                      Selected: {uploadFile.name} ({formatFileSize(uploadFile.size)})
                    </div>
                  )}
                </div>
                {fieldErrors.file && (
                  <p className="text-xs text-rose-600 mt-1">{fieldErrors.file}</p>
                )}
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition"
                >
                  {isSubmitting ? 'Uploading to S3...' : 'Upload Document'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add New Version Modal */}
      {showVersionModal && selectedDoc && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Upload Revised Version</h3>
                <p className="text-xs text-slate-500 mt-0.5">{selectedDoc.title}</p>
              </div>
              <button
                onClick={() => {
                  if (!isSubmitting) setShowVersionModal(false);
                }}
                className="text-slate-400 hover:text-slate-600 text-lg"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
                {formError}
              </div>
            )}

            <form onSubmit={handleAddVersion} className="space-y-4">
              <div className="p-3 bg-blue-50 rounded-lg text-xs text-blue-800 border border-blue-200">
                Uploading a revised version will increment the document to <strong>v{(selectedDoc.currentVersion?.versionNumber || 0) + 1}</strong> and automatically reset its status to <strong>Pending Review</strong>.
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">New File *</label>
                <input
                  type="file"
                  required
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      setVersionFile(e.target.files[0]);
                    }
                  }}
                  className="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer border border-slate-300 rounded-lg p-2"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Version Revision Notes</label>
                <textarea
                  rows={2}
                  placeholder="Reason for revision, renewal date, etc."
                  value={versionNotes}
                  onChange={(e) => setVersionNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setShowVersionModal(false)}
                  className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !versionFile}
                  className="px-5 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSubmitting ? 'Uploading Version...' : 'Save New Version'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Review & Verify Modal */}
      {showVerifyModal && selectedDoc && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Review & Primary Source Verification</h3>
                <p className="text-xs text-slate-500 mt-0.5">{selectedDoc.title}</p>
              </div>
              <button
                onClick={() => {
                  if (!isSubmitting) setShowVerifyModal(false);
                }}
                className="text-slate-400 hover:text-slate-600 text-lg"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
                {formError}
              </div>
            )}

            <form onSubmit={handleVerify} className="space-y-4">
              <div className="p-3 bg-slate-50 rounded-lg text-xs space-y-1 text-slate-600 border border-slate-200">
                <div><strong>Current File:</strong> {selectedDoc.currentVersion?.fileName || 'N/A'} (v{selectedDoc.currentVersion?.versionNumber || 1})</div>
                <div><strong>Current Status:</strong> {selectedDoc.status.toUpperCase()}</div>
                <div>
                  <a
                    href={`/api/v1/documents/${selectedDoc.id}/download`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 font-semibold hover:underline inline-flex items-center space-x-1 mt-1"
                  >
                    <span>Inspect / Download File ↗</span>
                  </a>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-2">Review Decision *</label>
                <div className="grid grid-cols-2 gap-3">
                  <label
                    className={`flex items-center p-3 rounded-xl border cursor-pointer transition ${
                      verifyStatus === 'verified'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-900 font-bold'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="decision"
                      checked={verifyStatus === 'verified'}
                      onChange={() => setVerifyStatus('verified')}
                      className="mr-2"
                    />
                    <span>✓ Verify & Approve</span>
                  </label>
                  <label
                    className={`flex items-center p-3 rounded-xl border cursor-pointer transition ${
                      verifyStatus === 'rejected'
                        ? 'border-rose-500 bg-rose-50 text-rose-900 font-bold'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="decision"
                      checked={verifyStatus === 'rejected'}
                      onChange={() => setVerifyStatus('rejected')}
                      className="mr-2"
                    />
                    <span>✕ Reject Document</span>
                  </label>
                </div>
              </div>

              {verifyStatus === 'rejected' && (
                <div>
                  <label className="block text-xs font-semibold text-rose-700 uppercase mb-1">
                    Rejection Reason *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Expired seal, illegible signature, wrong provider name"
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-rose-300 bg-rose-50/50 focus:ring-2 focus:ring-rose-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Verification Notes</label>
                <textarea
                  rows={2}
                  placeholder="Primary source board verified, confirmation #, etc."
                  value={verificationNotes}
                  onChange={(e) => setVerificationNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setShowVerifyModal(false)}
                  className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`px-5 py-2 text-sm font-semibold rounded-lg text-white shadow-sm transition disabled:opacity-50 ${
                    verifyStatus === 'verified' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {isSubmitting ? 'Recording Decision...' : verifyStatus === 'verified' ? 'Approve & Mark Verified' : 'Reject Document'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Version History Modal */}
      {showHistoryModal && selectedDoc && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Version History</h3>
                <p className="text-xs text-slate-500 mt-0.5">{selectedDoc.title}</p>
              </div>
              <button onClick={() => setShowHistoryModal(false)} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
            </div>

            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              {(selectedDoc.versions || []).map((v) => (
                <div
                  key={v.id}
                  className={`p-4 rounded-xl border flex items-center justify-between transition ${
                    v.id === selectedDoc.currentVersion?.id
                      ? 'bg-blue-50/60 border-blue-300'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="px-2 py-0.5 rounded bg-blue-600 text-white font-bold text-xs">
                        v{v.versionNumber}
                      </span>
                      <span className="font-semibold text-slate-900 text-sm">{v.fileName}</span>
                      {v.id === selectedDoc.currentVersion?.id && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 uppercase">
                          Current Active
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-1 flex items-center space-x-3">
                      <span>{formatFileSize(v.fileSize)}</span>
                      <span>•</span>
                      <span>{new Date(v.createdAt).toLocaleString()}</span>
                      {v.uploadedBy && (
                        <>
                          <span>•</span>
                          <span>Uploaded by {v.uploadedBy.firstName} {v.uploadedBy.lastName}</span>
                        </>
                      )}
                    </div>
                    {v.checksumSha256 && (
                      <div className="text-[10px] text-slate-400 font-mono mt-1">
                        SHA-256: {v.checksumSha256.slice(0, 16)}...
                      </div>
                    )}
                  </div>

                  <a
                    href={`/api/v1/documents/${selectedDoc.id}/download?versionId=${v.id}`}
                    download
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 shadow-sm transition"
                  >
                    Download
                  </a>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-200 mt-4">
              <button
                onClick={() => setShowHistoryModal(false)}
                className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Delete Confirmation Modal */}
      {showDeleteModal && docToDelete && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
              <div className="flex items-center space-x-2 text-rose-700">
                <span className="text-xl">⚠️</span>
                <h3 className="text-lg font-bold text-slate-900">Confirm Document Deletion</h3>
              </div>
              <button
                onClick={() => {
                  if (!isDeleting) setShowDeleteModal(false);
                }}
                className="text-slate-400 hover:text-slate-600 text-lg"
              >
                ✕
              </button>
            </div>

            {deleteError && (
              <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
                {deleteError}
              </div>
            )}

            <div className="space-y-3 text-sm text-slate-600 mb-6">
              <p>
                Are you sure you want to permanently delete this document and all associated version files from storage?
              </p>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
                <div><strong className="text-slate-800">Title:</strong> {docToDelete.title}</div>
                <div><strong className="text-slate-800">Category:</strong> {docToDelete.documentType.replace(/_/g, ' ')}</div>
                <div>
                  <strong className="text-slate-800">Provider:</strong>{' '}
                  {docToDelete.provider ? `Dr. ${docToDelete.provider.firstName} ${docToDelete.provider.lastName}` : 'General Record (No Provider)'}
                </div>
                <div><strong className="text-slate-800">Version Count:</strong> {docToDelete.versions?.length || 1}</div>
              </div>
              <p className="text-xs text-rose-600 font-medium">
                This action is irreversible and will be logged in the immutable audit log.
              </p>
            </div>

            <div className="flex justify-end space-x-3 pt-3 border-t border-slate-200">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleDeleteDocument}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 shadow-sm"
              >
                {isDeleting ? 'Deleting...' : 'Yes, Delete Document'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
