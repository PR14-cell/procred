'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type LoginStep =
  | 'password'
  | 'password_change'
  | 'mfa_choice'
  | 'mfa_enroll'
  | 'mfa_verify'
  | 'security_confirmed';

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
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [mfaChosen, setMfaChosen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Setup / Enrollment Data
  const [setupData, setSetupData] = useState<MfaSetupData | null>(null);
  const [copiedCodes, setCopiedCodes] = useState(false);

  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';
  const isExpired = searchParams.get('expired') === 'true';
  const isIdleLogout = searchParams.get('reason') === 'inactivity';

  useEffect(() => {
    if (isExpired) {
      setError('Your session has expired. Please sign in again.');
    } else if (isIdleLogout) {
      setError('You were signed out after 15 minutes of inactivity. Please sign in again.');
    }
  }, [isExpired, isIdleLogout]);

  // Handle Initial Password Submission
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Login failed.');
      }

      setUserId(data.userId);

      // Check if temporary credentials require forced password change
      if (data.mustChangePassword || data.authStage === 'password_change_required') {
        setCurrentPassword(password);
        setStep('password_change');
        return;
      }

      // If user requires mandatory MFA enrollment
      if (data.authStage === 'mfa_enrollment_required') {
        await loadMfaSetup();
        setStep('mfa_enroll');
        return;
      }

      // If returning user has MFA enabled
      if (data.authStage === 'mfa_pending' || data.mfaRequired) {
        setStep('mfa_verify');
        return;
      }

      // If MFA is not required and user is authenticated
      if (data.authStage === 'authenticated') {
        router.push(callbackUrl);
        return;
      }

      setStep('mfa_verify');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  // Handle Forced Password Change
  const handlePasswordChangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/v1/auth/first-login-change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to update password.');
      }

      // Advance to optional/recommended MFA selection
      setStep('mfa_choice');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Password update failed.');
    } finally {
      setLoading(false);
    }
  };

  // Fetch QR Code and Secret for MFA enrollment
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

  // Skip MFA during initial setup
  const handleSkipMfa = async () => {
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/v1/auth/first-login-skip-mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to proceed.');
      }

      setMfaChosen(false);
      setStep('security_confirmed');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not finalize sign-in.');
    } finally {
      setLoading(false);
    }
  };

  // Handle MFA Enrollment Submission
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

      setMfaChosen(true);
      setStep('security_confirmed');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'MFA enrollment failed.');
    } finally {
      setLoading(false);
    }
  };

  // Handle Returning User MFA Verification Challenge
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
              <label htmlFor="login-email" className="block text-sm font-medium text-slate-700 mb-1">Username or Email</label>
              <input
                id="login-email"
                type="text"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin or name@organization.com"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input
                id="login-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>

            <button
              id="btn-login-submit"
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-sm transition shadow-sm disabled:opacity-50"
            >
              {loading ? 'Verifying credentials...' : 'Sign In'}
            </button>
          </form>
        )}

        {/* STEP 2: FORCED PASSWORD CHANGE */}
        {step === 'password_change' && (
          <form onSubmit={handlePasswordChangeSubmit} className="space-y-4">
            <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg text-xs leading-relaxed">
              <span className="font-semibold block mb-0.5">Password Change Required</span>
              You are signed in with a temporary bootstrap testing credential. You must choose a new secure password before accessing the system.
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Current Temporary Password</label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50 font-mono"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">New Password (Min 8 chars, uppercase, lowercase, number)</label>
              <input
                type="password"
                required
                autoFocus
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Confirm New Password</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            <button
              id="btn-change-password-submit"
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg text-sm transition shadow-sm disabled:opacity-50"
            >
              {loading ? 'Updating Password...' : 'Save New Password & Continue'}
            </button>
          </form>
        )}

        {/* STEP 3: OPTIONAL / RECOMMENDED MFA SETUP CHOICE */}
        {step === 'mfa_choice' && (
          <div className="space-y-4">
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg text-xs leading-relaxed font-medium">
              ✓ Password updated successfully!
            </div>

            <div className="text-center py-2">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-100 text-blue-600 mb-2 text-xl">
                🛡️
              </div>
              <h2 className="text-lg font-semibold text-slate-900">Enable Two-Factor Authentication?</h2>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                Protect sensitive healthcare provider and credentialing data with standard TOTP (Google Authenticator, Microsoft Authenticator, 1Password, etc.).
              </p>
            </div>

            <div className="space-y-2 pt-2">
              <button
                id="btn-enable-mfa-choice"
                type="button"
                disabled={loading}
                onClick={async () => {
                  await loadMfaSetup();
                  setStep('mfa_enroll');
                }}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-sm transition shadow-sm"
              >
                Enable Two-Factor Authentication (Recommended)
              </button>

              <button
                id="btn-skip-mfa-choice"
                type="button"
                disabled={loading}
                onClick={handleSkipMfa}
                className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg text-sm transition"
              >
                Skip for Now (I will configure it later in Settings)
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: MFA ENROLLMENT (QR CODE & BACKUP CODES) */}
        {step === 'mfa_enroll' && (
          <form onSubmit={handleMfaEnrollSubmit} className="space-y-4">
            <div className="p-3 bg-blue-50 border border-blue-200 text-blue-900 rounded-lg text-xs leading-relaxed font-medium">
              Scan the QR code below with your authenticator app, or enter the manual key.
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
                    Manual setup key:
                  </p>
                  <code id="mfa-secret-code" className="mt-1 px-2 py-0.5 bg-slate-200 text-slate-800 text-xs rounded font-mono select-all">
                    {setupData.secret}
                  </code>
                </div>

                {(setupData.backupCodes || []).length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Single-Use Recovery Codes (Save these now):
                    </label>
                    <div className="grid grid-cols-2 gap-1.5 p-2 bg-slate-50 border border-slate-200 rounded font-mono text-xs text-slate-700 select-all">
                      {(setupData.backupCodes || []).map((code, idx) => (
                        <span key={idx} className="px-1 py-0.5 bg-white border border-slate-200 rounded text-center">
                          {code}
                        </span>
                      ))}
                    </div>
                    <label htmlFor="confirm-saved-codes" className="mt-2 flex items-start gap-2 cursor-pointer text-xs text-slate-600">
                      <input
                        id="confirm-saved-codes"
                        type="checkbox"
                        checked={copiedCodes}
                        onChange={(e) => setCopiedCodes(e.target.checked)}
                        className="mt-0.5 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                      />
                      <span>I have securely written down or saved these 10 recovery codes.</span>
                    </label>
                  </div>
                )}

                <div>
                  <label htmlFor="mfa-enroll-input" className="block text-sm font-medium text-slate-700 mb-1">
                    Enter 6-digit code from authenticator:
                  </label>
                  <input
                    id="mfa-enroll-input"
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
                  id="btn-activate-mfa"
                  type="submit"
                  disabled={loading || !copiedCodes}
                  className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg text-sm transition shadow-sm disabled:opacity-50"
                >
                  {loading ? 'Activating MFA...' : 'Verify Code & Activate MFA'}
                </button>
              </div>
            ) : (
              <div className="text-center py-6 text-sm text-slate-500">
                Generating secure authenticator setup...
              </div>
            )}
          </form>
        )}

        {/* STEP 5: SECURITY CONFIRMATION */}
        {step === 'security_confirmed' && (
          <div className="space-y-4 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 mb-1 text-2xl font-bold">
              ✓
            </div>
            <h2 className="text-xl font-bold text-slate-900">Security Setup Complete</h2>
            <p className="text-sm text-slate-600">
              Your administrator account is now configured and ready to use.
            </p>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-left text-xs space-y-1.5 text-slate-700">
              <div className="flex items-center justify-between">
                <span>Account Password:</span>
                <span className="font-semibold text-emerald-600">✓ Changed & Secured</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Two-Factor Authentication:</span>
                <span className={`font-semibold ${mfaChosen ? 'text-emerald-600' : 'text-slate-500'}`}>
                  {mfaChosen ? '✓ Enabled (TOTP)' : 'Skipped (Configurable in Settings)'}
                </span>
              </div>
            </div>

            <button
              id="btn-go-to-dashboard"
              type="button"
              onClick={() => router.push(callbackUrl)}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-sm transition shadow-sm"
            >
              Enter Application Dashboard
            </button>
          </div>
        )}

        {/* STEP 6: RETURNING USER MFA VERIFICATION */}
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

        <div className="mt-6 pt-4 border-t border-slate-200 text-center text-xs text-slate-400">
          Secure access for authorized users
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
