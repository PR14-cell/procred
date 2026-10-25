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

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
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

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/profile');
      if (res.ok) {
        const data = await res.json();
        setProfile(data.user);
        setFirstName(data.user.firstName || '');
        setLastName(data.user.lastName || '');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
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

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-400 text-sm">
        Loading profile & security settings...
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Profile & Account Security</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Manage your personal staff details, password credentials, and authentication preferences
        </p>
      </div>

      {/* Grid: 2 columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Profile Details Card */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="font-semibold text-slate-900 text-base">Personal Details</h2>
            <span className="inline-block px-2.5 py-0.5 text-xs font-semibold rounded bg-blue-50 text-blue-700 border border-blue-200">
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

          {/* MFA Info */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs">
            <div>
              <div className="font-medium text-slate-700">Multi-Factor Authentication (MFA)</div>
              <div className="text-slate-400">TOTP Authenticator & Backup Codes</div>
            </div>
            {profile?.mfaEnabled ? (
              <span className="text-emerald-600 font-semibold">✓ Enabled</span>
            ) : (
              <span className="text-slate-400">Disabled</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
