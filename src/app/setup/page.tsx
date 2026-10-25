'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SetupPage() {
  const router = useRouter();
  const [setupToken, setSetupToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function checkAvailability() {
      try {
        const res = await fetch('/api/v1/auth/bootstrap');
        const data = await res.json();
        setIsAvailable(data.available);
        if (!data.available) {
          setError('Platform initialization has already been completed. This page is sealed.');
        }
      } catch {
        setError('Unable to verify bootstrap status.');
      }
    }
    checkAvailability();
  }, []);

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (password.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/v1/auth/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          setupToken,
          email,
          password,
          firstName,
          lastName,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Setup failed.');
      }

      // Successfully bootstrapped! Redirect to login to enroll MFA
      router.push('/login?step=setup-mfa');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Setup failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="max-w-lg w-full bg-white rounded-xl shadow-lg border border-slate-200 p-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 mb-2 font-bold text-xl">
            ⚙️
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Platform Provisioning</h1>
          <p className="text-sm text-slate-500 mt-1">Initial Administrator Setup & Bootstrapping</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
            {error}
          </div>
        )}

        {isAvailable === false ? (
          <div className="text-center py-6">
            <p className="text-sm text-slate-600 mb-4">
              The initial administrator account has already been provisioned. This setup endpoint is permanently disabled.
            </p>
            <button
              onClick={() => router.push('/login')}
              className="py-2 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
            >
              Go to Sign In
            </button>
          </div>
        ) : (
          <form onSubmit={handleSetupSubmit} className="space-y-4">
            <div className="p-3 bg-blue-50 border border-blue-200 text-blue-900 rounded-lg text-xs leading-relaxed">
              Enter your secret <code className="font-mono font-bold">INITIAL_SETUP_TOKEN</code> configured in your server environment to bootstrap the super administrator.
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">One-Time Setup Token</label>
              <input
                type="password"
                required
                autoFocus
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
                placeholder="Paste INITIAL_SETUP_TOKEN"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">First Name</label>
                <input
                  type="text"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Admin"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Last Name</label>
                <input
                  type="text"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Officer"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Admin Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@yourorganization.com"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password (Min 12 chars)</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Confirm Password</label>
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
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg text-sm transition shadow-sm disabled:opacity-50"
            >
              {loading ? 'Bootstrapping...' : 'Initialize Administrator & Enroll MFA'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
