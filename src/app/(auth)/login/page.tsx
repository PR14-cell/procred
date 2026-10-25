'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type LoginStep = 'password' | 'mfa_verify' | 'mfa_enroll';

interface MfaSetupData {
  secret: string;
  qrCodeDataUrl: string;
  backupCodes: string[];
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<LoginStep>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Mandatory Enrollment Data
  const [setupData, setSetupData] = useState<MfaSetupData | null>(null);
  const [copiedCodes, setCopiedCodes] = useState(false);

  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';
  const isExpired = searchParams.get('expired') === 'true';

  useEffect(() => {
    if (isExpired) {
      setError('Your session has expired. Please sign in again.');
    }
  }, [isExpired]);

  // Handle Initial Password Submission
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Login failed.');
      }

      setUserId(data.userId);

      if (data.authStage === 'mfa_enrollment_required') {
        // Fetch QR code & recovery codes for mandatory enrollment
        await loadMfaSetup();
        setStep('mfa_enroll');
        return;
      }

      if (data.authStage === 'mfa_pending' || data.mfaRequired) {
        setStep('mfa_verify');
        return;
      }

      // Password alone NEVER grants access - fallback to mfa_verify if unspecified
      setStep('mfa_verify');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  // Fetch QR Code and Secret for initial enrollment
  const loadMfaSetup = async () => {
    try {
      const res = await fetch('/api/v1/auth/mfa');
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Failed to initialize MFA setup.');
      }
      const data: MfaSetupData = await res.json();
      setSetupData(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not prepare MFA enrollment.');
    }
  };

  // Handle MFA Verification Challenge
  const handleMfaVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/v1/auth/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: mfaCode.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'MFA verification failed.');
      }

      router.push(callbackUrl);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'MFA verification failed.');
    } finally {
      setLoading(false);
    }
  };

  // Handle Mandatory MFA Initial Enrollment
  const handleMfaEnrollSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/v1/auth/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: mfaCode.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'MFA enrollment verification failed.');
      }

      router.push(callbackUrl);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'MFA enrollment failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg border border-slate-200 p-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-100 text-blue-600 mb-2 font-bold text-xl">
            PC
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Provider Credentialing</h1>
          <p className="text-sm text-slate-500 mt-1">Payer Enrollment Management System</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
            {error}
          </div>
        )}

        {/* STEP 1: PASSWORD AUTHENTICATION */}
        {step === 'password' && (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email address</label>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@organization.com"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-sm transition shadow-sm disabled:opacity-50"
            >
              {loading ? 'Verifying credentials...' : 'Continue'}
            </button>
          </form>
        )}

        {/* STEP 2: RETURNING USER MFA VERIFICATION */}
        {step === 'mfa_verify' && (
          <form onSubmit={handleMfaVerifySubmit} className="space-y-4">
            <div className="p-3 bg-blue-50 text-blue-800 rounded-lg text-xs leading-relaxed">
              Two-Factor Authentication is enforced. Please enter the 6-digit code from your authenticator app, or a single-use recovery code.
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Verification Code</label>
              <input
                type="text"
                required
                autoFocus
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder="123456 or XXXX-XXXX"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm text-center tracking-widest font-mono font-bold"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-sm transition shadow-sm disabled:opacity-50"
            >
              {loading ? 'Verifying token...' : 'Verify & Access'}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep('password');
                setMfaCode('');
              }}
              className="w-full py-2 text-slate-500 text-xs hover:text-slate-700"
            >
              ← Back to sign-in
            </button>
          </form>
        )}

        {/* STEP 3: MANDATORY INITIAL MFA ENROLLMENT */}
        {step === 'mfa_enroll' && (
          <form onSubmit={handleMfaEnrollSubmit} className="space-y-4">
            <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg text-xs leading-relaxed font-medium">
              Mandatory Two-Factor Authentication Setup. You must configure an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, etc.) to access your account.
            </div>

            {setupData ? (
              <div className="space-y-4">
                <div className="flex flex-col items-center justify-center p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <img
                    src={setupData.qrCodeDataUrl}
                    alt="Scan MFA QR Code"
                    className="w-44 h-44 rounded-md border border-slate-200 shadow-inner"
                  />
                  <p className="mt-2 text-xs text-slate-500 text-center">
                    Scan with your authenticator app or enter secret manually:
                  </p>
                  <code className="mt-1 px-2 py-0.5 bg-slate-200 text-slate-800 text-xs rounded font-mono select-all">
                    {setupData.secret}
                  </code>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Single-Use Recovery Codes (Save these now):
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 p-2 bg-slate-50 border border-slate-200 rounded font-mono text-xs text-slate-700 select-all">
                    {setupData.backupCodes.map((code, idx) => (
                      <span key={idx} className="px-1 py-0.5 bg-white border border-slate-200 rounded text-center">
                        {code}
                      </span>
                    ))}
                  </div>
                  <label className="mt-2 flex items-start gap-2 cursor-pointer text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={copiedCodes}
                      onChange={(e) => setCopiedCodes(e.target.checked)}
                      className="mt-0.5 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                    />
                    <span>I have securely written down or saved these 10 recovery codes.</span>
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Enter 6-digit code from authenticator:
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    placeholder="123456"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm text-center tracking-widest font-mono font-bold"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || !copiedCodes}
                  className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg text-sm transition shadow-sm disabled:opacity-50"
                >
                  {loading ? 'Activating MFA...' : 'Activate MFA & Access Platform'}
                </button>
              </div>
            ) : (
              <div className="text-center py-6 text-sm text-slate-500">
                Generating secure authenticator setup...
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setStep('password');
                setMfaCode('');
              }}
              className="w-full py-2 text-slate-500 text-xs hover:text-slate-700"
            >
              ← Back to sign-in
            </button>
          </form>
        )}

        <div className="mt-6 pt-4 border-t border-slate-200 text-center text-xs text-slate-400">
          HIPAA & NIST SP 800-63B Compliant Access Control
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-400">
          Loading sign-in portal...
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
