'use client';

import React, { useState, useEffect } from 'react';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

interface Preferences {
  emailEnabled: boolean;
  expirationAlerts: boolean;
  revalidationAlerts: boolean;
  taskAlerts: boolean;
  missingDocAlerts: boolean;
  dailyDigest: boolean;
}

export default function NotificationsPage() {
  const [activeTab, setActiveTab] = useState<'all' | 'unread' | 'preferences'>('all');
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [filterType, setFilterType] = useState<string>('all');
  const [preferences, setPreferences] = useState<Preferences>({
    emailEnabled: true,
    expirationAlerts: true,
    revalidationAlerts: true,
    taskAlerts: true,
    missingDocAlerts: true,
    dailyDigest: true,
  });
  const [prefLoading, setPrefLoading] = useState<boolean>(false);
  const [prefSavedMessage, setPrefSavedMessage] = useState<string>('');

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const url = new URL('/api/v1/notifications', window.location.origin);
      url.searchParams.set('limit', '50');
      if (activeTab === 'unread') {
        url.searchParams.set('unreadOnly', 'true');
      }
      if (filterType !== 'all') {
        url.searchParams.set('type', filterType);
      }

      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.items || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  const fetchPreferences = async () => {
    try {
      const res = await fetch('/api/v1/notifications/preferences');
      if (res.ok) {
        const data = await res.json();
        if (data.preferences) {
          setPreferences({
            emailEnabled: data.preferences.emailEnabled ?? true,
            expirationAlerts: data.preferences.expirationAlerts ?? true,
            revalidationAlerts: data.preferences.revalidationAlerts ?? true,
            taskAlerts: data.preferences.taskAlerts ?? true,
            missingDocAlerts: data.preferences.missingDocAlerts ?? true,
            dailyDigest: data.preferences.dailyDigest ?? true,
          });
        }
      }
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    if (activeTab === 'preferences') {
      fetchPreferences();
    } else {
      fetchNotifications();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, filterType]);

  const handleMarkAsRead = async (id: string) => {
    try {
      await fetch(`/api/v1/notifications/${id}/read`, { method: 'PATCH' });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // Ignore
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await fetch('/api/v1/notifications/mark-all-read', { method: 'POST' });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {
      // Ignore
    }
  };

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    setPrefLoading(true);
    setPrefSavedMessage('');
    try {
      const res = await fetch('/api/v1/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      });
      if (res.ok) {
        setPrefSavedMessage('Notification preferences updated successfully.');
        setTimeout(() => setPrefSavedMessage(''), 3000);
      }
    } catch {
      setPrefSavedMessage('Failed to update preferences.');
    } finally {
      setPrefLoading(false);
    }
  };

  const getBadge = (type: string) => {
    if (type.includes('expired')) {
      return <span className="px-2 py-0.5 text-xs font-bold bg-red-100 text-red-700 rounded-full">EXPIRED</span>;
    }
    if (type.includes('expiring')) {
      return <span className="px-2 py-0.5 text-xs font-semibold bg-amber-100 text-amber-800 rounded-full">EXPIRING</span>;
    }
    if (type.includes('task')) {
      return <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">TASK</span>;
    }
    if (type.includes('enrollment') || type.includes('revalidation')) {
      return <span className="px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-800 rounded-full">ENROLLMENT</span>;
    }
    return <span className="px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-700 rounded-full">SYSTEM</span>;
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Notification Center</h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage your in-app alerts, credential expiration notices, and automated email preferences.
          </p>
        </div>

        {activeTab !== 'preferences' && unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition"
          >
            Mark all read ({unreadCount})
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="flex space-x-6">
          <button
            onClick={() => setActiveTab('all')}
            className={`py-3 text-sm font-medium border-b-2 transition ${
              activeTab === 'all'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
            }`}
          >
            All Notifications
          </button>
          <button
            onClick={() => setActiveTab('unread')}
            className={`py-3 text-sm font-medium border-b-2 transition flex items-center space-x-2 ${
              activeTab === 'unread'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
            }`}
          >
            <span>Unread</span>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full font-bold">
                {unreadCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('preferences')}
            className={`py-3 text-sm font-medium border-b-2 transition ${
              activeTab === 'preferences'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
            }`}
          >
            Notification Preferences
          </button>
        </nav>
      </div>

      {/* Content Area */}
      {activeTab === 'preferences' ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 max-w-2xl">
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Email Notification Preferences</h2>
          <p className="text-sm text-slate-500 mb-6">
            Configure which events trigger automated notifications and email alerts.
          </p>

          {prefSavedMessage && (
            <div className="mb-6 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-sm">
              {prefSavedMessage}
            </div>
          )}

          <form onSubmit={handleSavePreferences} className="space-y-4">
            <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-lg">
              <div>
                <label className="text-sm font-semibold text-slate-900 block">Master Email Notifications</label>
                <span className="text-xs text-slate-500">Enable or disable all outbound email communications</span>
              </div>
              <input
                type="checkbox"
                checked={preferences.emailEnabled}
                onChange={(e) => setPreferences({ ...preferences, emailEnabled: e.target.checked })}
                className="w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-lg">
              <div>
                <label className="text-sm font-semibold text-slate-900 block">Credential Expiration Alerts</label>
                <span className="text-xs text-slate-500">Alerts at 90, 60, 30, and 14 days prior to expiration</span>
              </div>
              <input
                type="checkbox"
                disabled={!preferences.emailEnabled}
                checked={preferences.expirationAlerts}
                onChange={(e) => setPreferences({ ...preferences, expirationAlerts: e.target.checked })}
                className="w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>

            <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-lg">
              <div>
                <label className="text-sm font-semibold text-slate-900 block">Payer Revalidation Alerts</label>
                <span className="text-xs text-slate-500">Alerts for enrollment revalidation cycles (90/60/30 days)</span>
              </div>
              <input
                type="checkbox"
                disabled={!preferences.emailEnabled}
                checked={preferences.revalidationAlerts}
                onChange={(e) => setPreferences({ ...preferences, revalidationAlerts: e.target.checked })}
                className="w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>

            <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-lg">
              <div>
                <label className="text-sm font-semibold text-slate-900 block">Task Due & Overdue Alerts</label>
                <span className="text-xs text-slate-500">Reminders for tasks assigned to you or nearing deadlines</span>
              </div>
              <input
                type="checkbox"
                disabled={!preferences.emailEnabled}
                checked={preferences.taskAlerts}
                onChange={(e) => setPreferences({ ...preferences, taskAlerts: e.target.checked })}
                className="w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>

            <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-lg">
              <div>
                <label className="text-sm font-semibold text-slate-900 block">Missing Document Notifications</label>
                <span className="text-xs text-slate-500">Alerts when required payer or credential documents are absent</span>
              </div>
              <input
                type="checkbox"
                disabled={!preferences.emailEnabled}
                checked={preferences.missingDocAlerts}
                onChange={(e) => setPreferences({ ...preferences, missingDocAlerts: e.target.checked })}
                className="w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>

            <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-lg">
              <div>
                <label className="text-sm font-semibold text-slate-900 block">Daily Morning Digest Email</label>
                <span className="text-xs text-slate-500">Consolidated morning summary of all pending items</span>
              </div>
              <input
                type="checkbox"
                disabled={!preferences.emailEnabled}
                checked={preferences.dailyDigest}
                onChange={(e) => setPreferences({ ...preferences, dailyDigest: e.target.checked })}
                className="w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>

            <div className="pt-4">
              <button
                type="submit"
                disabled={prefLoading}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-lg shadow-sm transition disabled:opacity-50"
              >
                {prefLoading ? 'Saving...' : 'Save Preferences'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="flex items-center space-x-2 pb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase">Filter:</span>
            {['all', 'credential_expiring', 'credential_expired', 'task_due', 'enrollment_status_change'].map(
              (f) => (
                <button
                  key={f}
                  onClick={() => setFilterType(f)}
                  className={`px-3 py-1 text-xs rounded-full font-medium transition ${
                    filterType === f
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {f === 'all'
                    ? 'All Types'
                    : f.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                </button>
              )
            )}
          </div>

          {loading ? (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center text-slate-500">
              <p>Loading notifications...</p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center text-slate-500">
              <span className="text-4xl block mb-2">🎉</span>
              <p className="font-semibold text-slate-800">No notifications to display</p>
              <p className="text-xs text-slate-400 mt-1">You are all caught up on alerts and reminders.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`p-4 flex items-start justify-between gap-4 transition hover:bg-slate-50 ${
                    !n.isRead ? 'bg-blue-50/30' : ''
                  }`}
                >
                  <div className="flex items-start space-x-3 min-w-0">
                    <div className="mt-0.5">{getBadge(n.type)}</div>
                    <div>
                      <h3 className={`text-sm font-semibold ${!n.isRead ? 'text-blue-900' : 'text-slate-900'}`}>
                        {n.title}
                      </h3>
                      <p className="text-xs text-slate-600 mt-1">{n.message}</p>
                      <span className="text-[11px] text-slate-400 mt-2 block">
                        {new Date(n.createdAt).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>

                  {!n.isRead && (
                    <button
                      onClick={() => handleMarkAsRead(n.id)}
                      className="px-3 py-1 bg-white hover:bg-slate-100 border border-slate-200 text-blue-600 text-xs font-medium rounded transition whitespace-nowrap"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
