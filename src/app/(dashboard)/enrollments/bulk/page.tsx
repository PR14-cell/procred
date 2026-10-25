'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface ProviderOption {
  id: string;
  firstName: string;
  lastName: string;
  npiNumber: string;
}

interface PayerOption {
  id: string;
  name: string;
  shortName: string | null;
  payerType: string;
}

export default function BulkEnrollmentCreationPage() {
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [payers, setPayers] = useState<PayerOption[]>([]);
  const [selectedProviderIds, setSelectedProviderIds] = useState<string[]>([]);
  const [selectedPayerIds, setSelectedPayerIds] = useState<string[]>([]);

  const [enrollmentType, setEnrollmentType] = useState<'individual' | 'group'>('individual');
  const [status, setStatus] = useState('initial_application');
  const [groupNpi, setGroupNpi] = useState('');
  const [groupNumber, setGroupNumber] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [result, setResult] = useState<{
    totalCombinations: number;
    createdCount: number;
    skippedCount: number;
    skippedDetails: Array<{ providerId: string; payerId: string; reason: string }>;
  } | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setFetchLoading(true);
        const [provRes, payRes] = await Promise.all([
          fetch('/api/v1/providers?limit=100'),
          fetch('/api/v1/payers?limit=100'),
        ]);

        const provData = await provRes.json();
        const payData = await payRes.json();

        setProviders(provData.providers || []);
        setPayers(payData.payers || []);
      } catch (err: any) {
        setError('Failed to load providers or payers for bulk enrollment');
      } finally {
        setFetchLoading(false);
      }
    }
    fetchData();
  }, []);

  const toggleProvider = (id: string) => {
    setSelectedProviderIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const selectAllProviders = () => {
    if (selectedProviderIds.length === providers.length) {
      setSelectedProviderIds([]);
    } else {
      setSelectedProviderIds(providers.map((p) => p.id));
    }
  };

  const togglePayer = (id: string) => {
    setSelectedPayerIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const selectAllPayers = () => {
    if (selectedPayerIds.length === payers.length) {
      setSelectedPayerIds([]);
    } else {
      setSelectedPayerIds(payers.map((p) => p.id));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedProviderIds.length === 0) {
      setError('Please select at least one provider.');
      return;
    }
    if (selectedPayerIds.length === 0) {
      setError('Please select at least one payer.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/v1/enrollments/bulk-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerIds: selectedProviderIds,
          payerIds: selectedPayerIds,
          enrollmentType,
          status,
          groupNpi: groupNpi.trim() || null,
          groupNumber: groupNumber.trim() || null,
          followUpDate: followUpDate || null,
          effectiveDate: effectiveDate || null,
          notes: notes.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to create bulk enrollments');
      }

      setResult({
        totalCombinations: data.totalCombinations,
        createdCount: data.createdCount,
        skippedCount: data.skippedCount,
        skippedDetails: data.skippedDetails || [],
      });
    } catch (err: any) {
      setError(err.message || 'Error executing bulk enrollment');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
            <Link href="/enrollments" className="hover:underline">Enrollments</Link>
            <span>/</span>
            <span className="text-slate-900 font-medium">Bulk Enrollment</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Bulk Payer Enrollment Creation</h1>
          <p className="text-sm text-slate-500 mt-1">
            Batch-enroll multiple providers across multiple payers simultaneously with duplicate protection
          </p>
        </div>
        <Link
          href="/enrollments"
          className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-medium rounded-lg transition"
        >
          Back to Enrollments
        </Link>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-start justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 font-bold ml-4">✕</button>
        </div>
      )}

      {/* Success Result Banner */}
      {result && (
        <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-xl space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎉</span>
            <h2 className="text-lg font-bold text-emerald-900">
              Bulk Enrollment Execution Complete!
            </h2>
          </div>
          <div className="text-sm text-emerald-800 space-y-1">
            <p>
              Total Combinations: <strong>{result.totalCombinations}</strong> | Created: <strong>{result.createdCount}</strong> | Skipped: <strong>{result.skippedCount}</strong>
            </p>
            {result.skippedCount > 0 && (
              <p className="text-xs text-emerald-700">
                (Skipped combinations already have active or pending enrollments in the system)
              </p>
            )}
          </div>
          <div className="flex gap-3 pt-2">
            <Link
              href="/enrollments"
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg"
            >
              View in Enrollment Management
            </Link>
            <button
              onClick={() => {
                setResult(null);
                setSelectedProviderIds([]);
                setSelectedPayerIds([]);
              }}
              className="px-4 py-2 border border-emerald-300 text-emerald-800 hover:bg-emerald-100 text-sm font-medium rounded-lg"
            >
              Start Another Batch
            </button>
          </div>
        </div>
      )}

      {/* Main Form */}
      {!result && (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Step 1: Select Providers */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">1. Select Providers ({selectedProviderIds.length})</h3>
                  <p className="text-xs text-slate-500">Choose providers to include in this batch</p>
                </div>
                <button
                  type="button"
                  onClick={selectAllProviders}
                  className="text-xs text-blue-600 hover:underline font-medium"
                >
                  {selectedProviderIds.length === providers.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              {fetchLoading ? (
                <div className="py-8 text-center text-xs text-slate-400">Loading provider roster...</div>
              ) : providers.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">No active providers found</div>
              ) : (
                <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1 divide-y divide-slate-100">
                  {providers.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-2.5 p-2 rounded hover:bg-slate-50 cursor-pointer text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={selectedProviderIds.includes(p.id)}
                        onChange={() => toggleProvider(p.id)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div className="flex-1">
                        <span className="font-medium text-slate-900">{p.firstName} {p.lastName}</span>
                        <span className="text-slate-400 font-mono ml-2">NPI: {p.npiNumber}</span>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Step 2: Select Payers */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">2. Select Payers ({selectedPayerIds.length})</h3>
                  <p className="text-xs text-slate-500">Choose payers to enroll providers with</p>
                </div>
                <button
                  type="button"
                  onClick={selectAllPayers}
                  className="text-xs text-blue-600 hover:underline font-medium"
                >
                  {selectedPayerIds.length === payers.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              {fetchLoading ? (
                <div className="py-8 text-center text-xs text-slate-400">Loading payers directory...</div>
              ) : payers.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">No payers available</div>
              ) : (
                <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1 divide-y divide-slate-100">
                  {payers.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-2.5 p-2 rounded hover:bg-slate-50 cursor-pointer text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={selectedPayerIds.includes(p.id)}
                        onChange={() => togglePayer(p.id)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div className="flex-1">
                        <span className="font-medium text-slate-900">{p.name}</span>
                        {p.shortName && <span className="text-slate-400 font-mono ml-2">({p.shortName})</span>}
                        <span className="text-[11px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded ml-2">
                          {p.payerType}
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Step 3: Enrollment Parameters */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 pb-2 border-b border-slate-100">
              3. Batch Enrollment Parameters
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Enrollment Type</label>
                <select
                  value={enrollmentType}
                  onChange={(e) => setEnrollmentType(e.target.value as any)}
                  className="w-full p-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="individual">Individual</option>
                  <option value="group">Group / Organization</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Initial Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="initial_application">Initial Application</option>
                  <option value="draft">Draft</option>
                  <option value="submitted">Submitted</option>
                  <option value="in_progress">In Progress</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Follow-Up Date</label>
                <input
                  type="date"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {enrollmentType === 'group' && (
                <>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Group NPI (Optional)</label>
                    <input
                      type="text"
                      value={groupNpi}
                      onChange={(e) => setGroupNpi(e.target.value)}
                      placeholder="10-digit Group NPI"
                      className="w-full p-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Group Number (Optional)</label>
                    <input
                      type="text"
                      value={groupNumber}
                      onChange={(e) => setGroupNumber(e.target.value)}
                      placeholder="e.g. GRP-9999"
                      className="w-full p-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block font-medium text-slate-700 mb-1">Effective Date (Optional)</label>
                <input
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1 text-xs">Batch Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes to attach to status history of all created enrollments..."
                rows={2}
                className="w-full p-2.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Action Bar */}
          <div className="flex items-center justify-between bg-slate-50 p-4 rounded-xl border border-slate-200">
            <span className="text-xs text-slate-600 font-medium">
              Calculated batch size: <strong>{selectedProviderIds.length}</strong> providers × <strong>{selectedPayerIds.length}</strong> payers = <strong>{selectedProviderIds.length * selectedPayerIds.length}</strong> enrollments
            </span>
            <button
              type="submit"
              disabled={loading || selectedProviderIds.length === 0 || selectedPayerIds.length === 0}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shadow-sm transition"
            >
              {loading ? 'Processing Batch...' : `Execute Bulk Enrollment (${selectedProviderIds.length * selectedPayerIds.length})`}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
