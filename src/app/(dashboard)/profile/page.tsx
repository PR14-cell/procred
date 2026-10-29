'use client';

import { useState, useEffect } from 'react';

interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface MfaStatus {
  mfaEnabled: boolean;
  mfaEnrolledAt: string | null;
  totalRecoveryCodes: number;
  unusedRecoveryCodes: number;
  isMandatory: boolean;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Edit details form
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Change password form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // MFA Setup Modal State
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [setupStep, setSetupStep] = useState<'qr' | 'codes'>('qr');
  const [setupQrCode, setSetupQrCode] = useState('');
  const [setupSecret, setSetupSecret] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [setupBackupCodes, setSetupBackupCodes] = useState<string[]>([]);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);

  // MFA Disable Modal State
  const [disableModalOpen, setDisableModalOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableToken, setDisableToken] = useState('');
  const [disableLoading, setDisableLoading] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);

  // Regenerate Backup Codes Modal State
  const [regenModalOpen, setRegenModalOpen] = useState(false);
  const [regenPassword, setRegenPassword] = useState('');
  const [regenToken, setRegenToken] = useState('');
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [newBackupCodes, setNewBackupCodes] = useState<string[] | null>(null);

  const fetchProfileAndMfa = async () => {
    try {
      setLoading(true);
      const [profileRes, mfaRes] = await Promise.all([
        fetch('/api/v1/profile'),
        fetch('/api/v1/profile/mfa'),
      ]);

      if (profileRes.ok) {
        const pData = await profileRes.json();
        setProfile(pData.user);
        setFirstName(pData.user.firstName || '');
        setLastName(pData.user.lastName || '');
      }

      if (mfaRes.ok) {
        const mData = await mfaRes.json();
        setMfaStatus(mData);
      }
    } catch (err) {
      console.error('Error fetching profile or MFA status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfileAndMfa();
  }, []);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMessage(null);
    try {
      setSavingProfile(true);
      const res = await fetch('/api/v1/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to update profile');
      }
      setProfileMessage({ type: 'success', text: 'Personal details updated successfully.' });
      setProfile(data.user);
    } catch (err: unknown) {
      setProfileMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error updating profile',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMessage(null);

    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'New password and confirmation do not match.' });
      return;
    }

    try {
      setSavingPassword(true);
      const res = await fetch('/api/v1/profile/change-password', {
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
        throw new Error(data.message || 'Failed to change password');
      }
      setPasswordMessage({
        type: 'success',
        text: 'Password updated successfully! Other active sessions have been invalidated.',
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      setPasswordMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error changing password',
      });
    } finally {
      setSavingPassword(false);
    }
  };

  // Start MFA Setup
  const handleStartMfaSetup = async () => {
    setSetupError(null);
    setVerificationCode('');
    setSetupStep('qr');
    setCopiedKey(false);
    setCopiedCodes(false);

    try {
      setSetupLoading(true);
      const res = await fetch('/api/v1/profile/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setup' }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to initiate MFA setup');
      }

      setSetupQrCode(data.qrCodeDataUrl);
      setSetupSecret(data.secret);
      setSetupModalOpen(true);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Could not initialize MFA setup');
    } finally {
      setSetupLoading(false);
    }
  };

  // Verify and Enable MFA
  const handleVerifyAndEnableMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetupError(null);

    if (!verificationCode.trim()) {
      setSetupError('Please enter the 6-digit code from your authenticator app.');
      return;
    }

    try {
      setSetupLoading(true);
      const res = await fetch('/api/v1/profile/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'verify_and_enable',
          token: verificationCode.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Verification failed');
      }

      setSetupBackupCodes(data.backupCodes || []);
      setSetupStep('codes');
      fetchProfileAndMfa();
    } catch (err: unknown) {
      setSetupError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setSetupLoading(false);
    }
  };

  // Copy secret key
  const handleCopySecret = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(setupSecret);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2500);
    }
  };

  // Copy backup codes
  const handleCopyBackupCodes = (codes: string[]) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(codes.join('\n'));
      setCopiedCodes(true);
      setTimeout(() => setCopiedCodes(false), 2500);
    }
  };

  // Download backup codes as .txt
  const handleDownloadBackupCodes = (codes: string[]) => {
    const text = `PROVIDER CREDENTIALING SYSTEM - MFA BACKUP RECOVERY CODES\nGenerated: ${new Date().toISOString()}\nAccount: ${profile?.email}\n\nIMPORTANT: Each backup recovery code can only be used once.\n\n${codes.join('\n')}\n`;
    const element = document.createElement('a');
    const file = new Blob([text], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `provider-credentialing-backup-codes-${Date.now()}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  // Disable MFA
  const handleDisableMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setDisableError(null);

    try {
      setDisableLoading(true);
      const res = await fetch('/api/v1/profile/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'disable',
          password: disablePassword,
          token: disableToken.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to disable MFA');
      }

      setDisableModalOpen(false);
      setDisablePassword('');
      setDisableToken('');
      fetchProfileAndMfa();
    } catch (err: unknown) {
      setDisableError(err instanceof Error ? err.message : 'Error disabling MFA');
    } finally {
      setDisableLoading(false);
    }
  };

  // Regenerate Backup Codes
  const handleRegenerateCodes = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegenError(null);

    try {
      setRegenLoading(true);
      const res = await fetch('/api/v1/profile/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'regenerate_backup_codes',
          password: regenPassword,
          token: regenToken.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to regenerate backup codes');
      }

      setNewBackupCodes(data.backupCodes || []);
      setRegenPassword('');
      setRegenToken('');
      fetchProfileAndMfa();
    } catch (err: unknown) {
      setRegenError(err instanceof Error ? err.message : 'Error regenerating backup codes');
    } finally {
      setRegenLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-400 text-sm">
        Loading profile & security settings...
      </div>
    );
  }

  const isMfaActive = mfaStatus?.mfaEnabled ?? profile?.mfaEnabled;

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Profile & Account Security</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Manage your personal staff details, password credentials, and multi-factor authentication
        </p>
      </div>

      {/* Grid: 2 columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Profile Details Card */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="font-semibold text-slate-900 text-base">Personal Details</h2>
            <span className="inline-block px-2.5 py-0.5 text-xs font-semibold rounded bg-blue-50 text-blue-700 border border-blue-200 capitalize">
              {profile?.role.replace('_', ' ')}
            </span>
          </div>

          {profileMessage && (
            <div
              className={`p-3 rounded-lg text-xs border ${
                profileMessage.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}
            >
              {profileMessage.text}
            </div>
          )}

          <form onSubmit={handleUpdateProfile} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email Address</label>
              <input
                type="text"
                disabled
                value={profile?.email || ''}
                className="w-full px-3 py-2 border border-slate-200 bg-slate-50 rounded-lg text-xs font-mono text-slate-500 cursor-not-allowed"
              />
              <p className="text-[11px] text-slate-400 mt-0.5">
                Email address is managed by organization administrators.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">First Name</label>
                <input
                  type="text"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Last Name</label>
                <input
                  type="text"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={savingProfile}
                className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs font-medium rounded-lg shadow-sm transition"
              >
                {savingProfile ? 'Saving...' : 'Save Personal Details'}
              </button>
            </div>
          </form>

          <div className="pt-3 border-t border-slate-100 text-xs text-slate-400 space-y-1">
            <div>Account Created: {profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString() : '—'}</div>
            <div>Last Active Session: {profile?.lastLoginAt ? new Date(profile.lastLoginAt).toLocaleString() : 'Current Session'}</div>
          </div>
        </div>

        {/* Change Password Card */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="font-semibold text-slate-900 text-base">Change Password</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Enforces 8+ characters, uppercase, lowercase, and numeric digits
            </p>
          </div>

          {passwordMessage && (
            <div
              className={`p-3 rounded-lg text-xs border ${
                passwordMessage.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}
            >
              {passwordMessage.text}
            </div>
          )}

          <form onSubmit={handleChangePassword} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Current Password</label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">New Password</label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Confirm New Password</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={savingPassword}
                className="w-full py-2 px-4 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-500 text-white text-xs font-medium rounded-lg shadow-sm transition"
              >
                {savingPassword ? 'Updating Password...' : 'Update Password'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Multi-Factor Authentication (MFA) Section - Dedicated Card */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center text-xl shrink-0">
              🛡️
            </div>
            <div>
              <h2 className="font-semibold text-slate-900 text-base">Multi-Factor Authentication (MFA)</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                TOTP Authenticator & Single-Use Recovery Codes
              </p>
            </div>
          </div>
          <div>
            {isMfaActive ? (
              <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>Active & Protected</span>
              </span>
            ) : (
              <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                <span>Disabled</span>
              </span>
            )}
          </div>
        </div>

        {isMfaActive ? (
          /* MFA Active State */
          <div className="space-y-4">
            <div className="p-4 bg-emerald-50/50 border border-emerald-200/80 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="font-semibold text-sm text-emerald-900 flex items-center space-x-2">
                  <span>✓ Authenticator App Configured</span>
                </div>
                <p className="text-xs text-emerald-800/80 mt-1">
                  Your account is secured with time-based one-time passwords (TOTP). You will be prompted for your 6-digit code on every login.
                </p>
                <div className="mt-2 text-[11px] text-emerald-700/80 font-mono">
                  {mfaStatus?.mfaEnrolledAt && (
                    <span>Enrolled: {new Date(mfaStatus.mfaEnrolledAt).toLocaleDateString()} • </span>
                  )}
                  <span>{mfaStatus?.unusedRecoveryCodes ?? 0} unused backup codes remaining</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setNewBackupCodes(null);
                    setRegenError(null);
                    setRegenModalOpen(true);
                  }}
                  className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg shadow-sm transition"
                >
                  Regenerate Backup Codes
                </button>
                {!mfaStatus?.isMandatory && (
                  <button
                    type="button"
                    onClick={() => {
                      setDisableError(null);
                      setDisablePassword('');
                      setDisableToken('');
                      setDisableModalOpen(true);
                    }}
                    className="px-3 py-1.5 bg-white border border-red-200 hover:bg-red-50 text-red-600 text-xs font-medium rounded-lg shadow-sm transition"
                  >
                    Disable MFA
                  </button>
                )}
              </div>
            </div>

            {mfaStatus?.isMandatory && (
              <p className="text-xs text-slate-400 italic">
                ℹ️ Two-factor authentication is required by system security policy and cannot be disabled.
              </p>
            )}
          </div>
        ) : (
          /* MFA Disabled State */
          <div className="p-5 bg-gradient-to-r from-slate-50 to-indigo-50/30 border border-slate-200 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
            <div className="space-y-1.5">
              <div className="font-semibold text-slate-900 text-sm">
                Enhance your account security with Two-Factor Authentication
              </div>
              <p className="text-xs text-slate-600 max-w-xl leading-relaxed">
                Add a second verification layer to safeguard provider and organization data. Works with any standard TOTP app such as{' '}
                <strong>Google Authenticator</strong>, <strong>Microsoft Authenticator</strong>, <strong>1Password</strong>, or <strong>Authy</strong>.
              </p>
            </div>

            <button
              type="button"
              id="enable-mfa-btn"
              onClick={handleStartMfaSetup}
              disabled={setupLoading}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-xs font-semibold rounded-lg shadow-md transition flex items-center space-x-2 shrink-0"
            >
              {setupLoading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>Generating Secret...</span>
                </>
              ) : (
                <>
                  <span>🔐</span>
                  <span>Enable Multi-Factor Authentication</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* MODAL 1: MFA SETUP & ENROLLMENT MODAL */}
      {setupModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            {setupStep === 'qr' ? (
              <>
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">Set Up Two-Factor Authentication</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Step 1 of 2: Scan QR code with your authenticator</p>
                  </div>
                  <button
                    onClick={() => setSetupModalOpen(false)}
                    className="text-slate-400 hover:text-slate-600 text-lg"
                  >
                    ✕
                  </button>
                </div>

                {setupError && (
                  <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs">
                    {setupError}
                  </div>
                )}

                <div className="flex flex-col items-center justify-center p-4 bg-slate-50 rounded-xl border border-slate-200">
                  {setupQrCode ? (
                    <img
                      src={setupQrCode}
                      alt="Scan MFA QR Code"
                      className="w-48 h-48 rounded-lg border border-slate-200 bg-white p-2 shadow-sm"
                    />
                  ) : (
                    <div className="w-48 h-48 flex items-center justify-center text-xs text-slate-400">
                      Loading QR Code...
                    </div>
                  )}

                  <div className="mt-3 text-center w-full">
                    <span className="text-[11px] text-slate-500 block">Unable to scan? Enter manual secret:</span>
                    <div className="mt-1 flex items-center justify-center space-x-2">
                      <code className="px-2.5 py-1 bg-white border border-slate-200 text-slate-800 text-xs rounded-md font-mono select-all">
                        {setupSecret}
                      </code>
                      <button
                        type="button"
                        onClick={handleCopySecret}
                        className="px-2 py-1 text-[11px] font-medium bg-slate-200 hover:bg-slate-300 text-slate-700 rounded transition"
                      >
                        {copiedKey ? '✓ Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                </div>

                <form onSubmit={handleVerifyAndEnableMfa} className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Enter 6-Digit Verification Code
                    </label>
                    <input
                      type="text"
                      autoFocus
                      required
                      maxLength={6}
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value.replace(/[^0-9]/g, ''))}
                      placeholder="000000"
                      className="w-full text-center px-4 py-2.5 border border-slate-300 rounded-lg text-lg font-mono tracking-widest focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                    <p className="text-[11px] text-slate-400 text-center mt-1">
                      Enter the 6-digit code currently generated by your app
                    </p>
                  </div>

                  <div className="flex space-x-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setSetupModalOpen(false)}
                      disabled={setupLoading}
                      className="w-1/3 py-2 px-3 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={setupLoading || verificationCode.length < 6}
                      className="w-2/3 py-2 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-xs font-semibold rounded-lg shadow-sm transition flex items-center justify-center space-x-1.5"
                    >
                      {setupLoading ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                          <span>Verifying...</span>
                        </>
                      ) : (
                        <span>Verify & Activate MFA →</span>
                      )}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              /* Step 2: Show Backup Codes */
              <>
                <div className="text-center space-y-1">
                  <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-2xl mx-auto mb-2">
                    ✓
                  </div>
                  <h3 className="font-bold text-slate-900 text-lg">MFA Successfully Activated!</h3>
                  <p className="text-xs text-slate-500">Step 2 of 2: Save your single-use recovery codes</p>
                </div>

                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
                  <div className="font-semibold flex items-center space-x-1.5">
                    <span>⚠️</span>
                    <span>Store these recovery codes safely</span>
                  </div>
                  <p className="text-amber-800/90 leading-relaxed">
                    If you lose access to your phone or authenticator app, each code can be used <strong>once</strong> to sign in. These codes will not be shown again.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs text-slate-800 text-center select-all">
                  {setupBackupCodes.map((code, idx) => (
                    <div key={idx} className="bg-white px-2 py-1.5 rounded border border-slate-200 shadow-2xs font-semibold text-[11px]">
                      {code}
                    </div>
                  ))}
                </div>

                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={() => handleCopyBackupCodes(setupBackupCodes)}
                    className="w-1/2 py-2 px-3 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg transition"
                  >
                    {copiedCodes ? '✓ Copied All Codes' : '📋 Copy All Codes'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadBackupCodes(setupBackupCodes)}
                    className="w-1/2 py-2 px-3 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg transition"
                  >
                    ⬇️ Download (.txt)
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setSetupModalOpen(false)}
                  className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
                >
                  I Have Saved My Recovery Codes
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* MODAL 2: DISABLE MFA MODAL */}
      {disableModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 space-y-4">
            <div className="flex items-center space-x-3 text-red-600 border-b border-slate-100 pb-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <h3 className="font-bold text-slate-900 text-base">Disable Two-Factor Authentication</h3>
                <p className="text-xs text-slate-500">Security verification required</p>
              </div>
            </div>

            {disableError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs">
                {disableError}
              </div>
            )}

            <p className="text-xs text-slate-600 leading-relaxed">
              Disabling MFA removes the second layer of security from your account. To proceed, please confirm your identity.
            </p>

            <form onSubmit={handleDisableMfa} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Your Current Password</label>
                <input
                  type="password"
                  required
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  6-Digit Authenticator Code (or Backup Code)
                </label>
                <input
                  type="text"
                  required
                  value={disableToken}
                  onChange={(e) => setDisableToken(e.target.value)}
                  placeholder="123456"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDisableModalOpen(false)}
                  disabled={disableLoading}
                  className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={disableLoading}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white text-xs font-medium rounded-lg shadow-sm transition"
                >
                  {disableLoading ? 'Disabling...' : 'Confirm & Disable MFA'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: REGENERATE BACKUP CODES MODAL */}
      {regenModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-base">Regenerate Backup Recovery Codes</h3>
                <p className="text-xs text-slate-500">Invalidates all previous codes</p>
              </div>
              <button
                onClick={() => setRegenModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg"
              >
                ✕
              </button>
            </div>

            {regenError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs">
                {regenError}
              </div>
            )}

            {!newBackupCodes ? (
              <form onSubmit={handleRegenerateCodes} className="space-y-3">
                <p className="text-xs text-slate-600 leading-relaxed">
                  Generating new backup codes will immediately invalidate any previous recovery codes. Please verify your credentials to continue.
                </p>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Your Password</label>
                  <input
                    type="password"
                    required
                    value={regenPassword}
                    onChange={(e) => setRegenPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">6-Digit Authenticator Code</label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={regenToken}
                    onChange={(e) => setRegenToken(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="000000"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono text-center tracking-widest"
                  />
                </div>

                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setRegenModalOpen(false)}
                    disabled={regenLoading}
                    className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={regenLoading}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-xs font-semibold rounded-lg shadow-sm transition"
                  >
                    {regenLoading ? 'Generating...' : 'Generate New Codes'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs">
                  ✓ 10 new recovery codes generated. Your previous codes are now invalid.
                </div>

                <div className="grid grid-cols-2 gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs text-slate-800 text-center select-all">
                  {newBackupCodes.map((code, idx) => (
                    <div key={idx} className="bg-white px-2 py-1.5 rounded border border-slate-200 shadow-2xs font-semibold text-[11px]">
                      {code}
                    </div>
                  ))}
                </div>

                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={() => handleCopyBackupCodes(newBackupCodes)}
                    className="w-1/2 py-2 px-3 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg transition"
                  >
                    {copiedCodes ? '✓ Copied All Codes' : '📋 Copy All Codes'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadBackupCodes(newBackupCodes)}
                    className="w-1/2 py-2 px-3 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg transition"
                  >
                    ⬇️ Download (.txt)
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setNewBackupCodes(null);
                    setRegenModalOpen(false);
                  }}
                  className="w-full py-2 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg transition"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
