'use client';

import React, { useState } from 'react';
import Link from 'next/link';

interface ValidationError {
  rowNumber: number;
  field: string;
  message: string;
  value?: any;
}

interface PreviewRow {
  rowNumber: number;
  firstName?: string;
  lastName?: string;
  npiNumber?: string;
  primaryTaxonomy?: string;
  email?: string;
  status?: string;
  isValid: boolean;
  errorCount: number;
}

export default function BulkProviderImportPage() {
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preview state
  const [previewResult, setPreviewResult] = useState<{
    totalRows: number;
    validCount: number;
    invalidCount: number;
    errors: ValidationError[];
    previewRows: PreviewRow[];
  } | null>(null);

  // Commit state
  const [commitResult, setCommitResult] = useState<{
    importedCount: number;
    failedCount: number;
    importedIds: string[];
  } | null>(null);

  const sampleCsv = `First Name,Last Name,NPI,Specialty,Email,Date of Birth,Gender,SSN
Sarah,Mitchell,9991234501,207Q00000X,dr.sarah@example.com,1978-04-12,Female,999-12-3456
James,Wilson,9991234502,207R00000X,dr.james@example.com,1982-11-23,Male,999-65-4321
Emily,Clark,9991234503,207N00000X,dr.emily@example.com,1985-07-30,Female,999-88-7766`;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError(null);
    setCommitResult(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setCsvText(content || '');
    };
    reader.readAsText(file);
  };

  const loadSample = () => {
    setCsvText(sampleCsv);
    setFileName('sample_providers.csv');
    setPreviewResult(null);
    setCommitResult(null);
    setError(null);
  };

  const handlePreview = async () => {
    if (!csvText.trim()) {
      setError('Please select a CSV file or paste CSV text first.');
      return;
    }

    setLoading(true);
    setError(null);
    setCommitResult(null);

    try {
      const res = await fetch('/api/v1/providers/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText, preview: true }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to preview CSV');
      }

      setPreviewResult({
        totalRows: data.totalRows,
        validCount: data.validCount,
        invalidCount: data.invalidCount,
        errors: data.errors || [],
        previewRows: data.previewRows || [],
      });
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during preview');
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!csvText.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/v1/providers/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText, preview: false }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to import providers');
      }

      setCommitResult({
        importedCount: data.importedCount,
        failedCount: data.failedCount,
        importedIds: data.importedIds || [],
      });
      setPreviewResult(null);
    } catch (err: any) {
      setError(err.message || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
            <Link href="/providers" className="hover:underline">Providers</Link>
            <span>/</span>
            <span className="text-slate-900 font-medium">Bulk Import</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Bulk Provider CSV Import</h1>
          <p className="text-sm text-slate-500 mt-1">
            Upload a CSV roster to validate, preview, and batch-onboard providers into the system
          </p>
        </div>
        <Link
          href="/providers"
          className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-medium rounded-lg transition"
        >
          Back to Directory
        </Link>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-start justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 font-bold ml-4">✕</button>
        </div>
      )}

      {/* Success banner after commit */}
      {commitResult && (
        <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-xl space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">✅</span>
            <h2 className="text-lg font-bold text-emerald-900">
              Bulk Import Successfully Completed!
            </h2>
          </div>
          <p className="text-sm text-emerald-800">
            <strong>{commitResult.importedCount}</strong> providers were imported and assigned initial credentialing workflows.
            {commitResult.failedCount > 0 && ` (${commitResult.failedCount} rows skipped due to validation errors)`}
          </p>
          <div className="flex gap-3 pt-2">
            <Link
              href="/providers"
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg"
            >
              View in Provider Directory
            </Link>
            <button
              onClick={() => {
                setCommitResult(null);
                setCsvText('');
                setFileName('');
              }}
              className="px-4 py-2 border border-emerald-300 text-emerald-800 hover:bg-emerald-100 text-sm font-medium rounded-lg"
            >
              Import Another File
            </button>
          </div>
        </div>
      )}

      {/* Upload & CSV Input Card */}
      {!commitResult && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-base font-semibold text-slate-900">1. Select or Paste CSV Data</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Required columns: First Name, Last Name, 10-digit NPI. Optional: Specialty, Email, SSN, DOB.
              </p>
            </div>
            <button
              type="button"
              onClick={loadSample}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline self-start sm:self-auto"
            >
              Load Sample Template
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* File drop zone */}
            <div className="border-2 border-dashed border-slate-300 hover:border-blue-400 rounded-lg p-6 flex flex-col items-center justify-center text-center bg-slate-50 transition cursor-pointer relative">
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileUpload}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <span className="text-3xl mb-2">📁</span>
              <p className="text-sm font-medium text-slate-700">
                {fileName ? fileName : 'Click or drag CSV file here'}
              </p>
              <p className="text-xs text-slate-400 mt-1">Accepts standard .csv files up to 5 MB</p>
            </div>

            {/* Direct text area */}
            <div>
              <textarea
                value={csvText}
                onChange={(e) => {
                  setCsvText(e.target.value);
                  setPreviewResult(null);
                }}
                rows={6}
                placeholder="Or paste comma-separated CSV text directly here..."
                className="w-full p-3 font-mono text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={handlePreview}
              disabled={loading || !csvText.trim()}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shadow-sm transition flex items-center gap-2"
            >
              {loading ? 'Validating...' : 'Preview & Validate'}
            </button>
          </div>
        </div>
      )}

      {/* Preview Section */}
      {previewResult && !commitResult && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-base font-semibold text-slate-900">2. Validation Summary</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Review row validity before committing to the database
              </p>
            </div>
            <div className="flex items-center gap-4 text-sm font-medium">
              <span className="text-slate-600">Total: <strong>{previewResult.totalRows}</strong></span>
              <span className="text-emerald-600">Valid: <strong>{previewResult.validCount}</strong></span>
              <span className="text-red-600">Invalid: <strong>{previewResult.invalidCount}</strong></span>
            </div>
          </div>

          {/* Error list if any */}
          {previewResult.errors.length > 0 && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
              <p className="text-xs font-bold text-amber-900 uppercase">
                Validation Warnings &amp; Errors ({previewResult.errors.length})
              </p>
              <ul className="text-xs text-amber-800 space-y-1 max-h-36 overflow-y-auto pl-4 list-disc">
                {previewResult.errors.map((err, i) => (
                  <li key={i}>
                    <strong>Row {err.rowNumber}</strong> ({err.field}): {err.message}
                    {err.value ? ` [Received: "${err.value}"]` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Table preview */}
          <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-80 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold sticky top-0">
                <tr>
                  <th className="p-2.5">Row</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5">First Name</th>
                  <th className="p-2.5">Last Name</th>
                  <th className="p-2.5">NPI</th>
                  <th className="p-2.5">Specialty</th>
                  <th className="p-2.5">Email</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {previewResult.previewRows.map((r) => (
                  <tr key={r.rowNumber} className={r.isValid ? 'hover:bg-slate-50' : 'bg-red-50/50'}>
                    <td className="p-2.5 font-mono text-slate-500">{r.rowNumber}</td>
                    <td className="p-2.5">
                      {r.isValid ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-800">
                          Valid
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-red-100 text-red-800">
                          {r.errorCount} Error{r.errorCount > 1 ? 's' : ''}
                        </span>
                      )}
                    </td>
                    <td className="p-2.5 font-medium text-slate-900">{r.firstName || '-'}</td>
                    <td className="p-2.5 font-medium text-slate-900">{r.lastName || '-'}</td>
                    <td className="p-2.5 font-mono text-slate-700">{r.npiNumber || '-'}</td>
                    <td className="p-2.5 text-slate-600">{r.primaryTaxonomy || '-'}</td>
                    <td className="p-2.5 text-slate-600">{r.email || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between pt-3">
            <p className="text-xs text-slate-500">
              Only valid rows ({previewResult.validCount}) will be inserted. Invalid rows will be skipped.
            </p>
            <button
              onClick={handleCommit}
              disabled={loading || previewResult.validCount === 0}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shadow-sm transition"
            >
              {loading ? 'Importing...' : `Confirm & Import ${previewResult.validCount} Providers`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
