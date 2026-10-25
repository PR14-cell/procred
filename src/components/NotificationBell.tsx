'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export default function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [recentNotifications, setRecentNotifications] = useState<NotificationItem[]>([]);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = async () => {
    try {
      const res = await fetch('/api/v1/notifications?limit=5');
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.unreadCount || 0);
        setRecentNotifications(data.items || []);
      }
    } catch {
      // Ignore background fetch error
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000); // 30s poll
    return () => clearInterval(interval);
  }, []);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMarkAsRead = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/v1/notifications/${id}/read`, { method: 'PATCH' });
      setRecentNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // Ignore
    }
  };

  const handleMarkAllRead = async () => {
    setLoading(true);
    try {
      await fetch('/api/v1/notifications/mark-all-read', { method: 'POST' });
      setRecentNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  const getIcon = (type: string) => {
    if (type.includes('expired')) return '🚨';
    if (type.includes('expiring')) return '⚠️';
    if (type.includes('task')) return '✅';
    if (type.includes('enrollment') || type.includes('revalidation')) return '📝';
    if (type.includes('document')) return '📄';
    return '🔔';
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Notifications"
        className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full transition focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <span className="text-xl">🔔</span>
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-red-600 rounded-full border-2 border-white animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 md:w-96 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-sm text-slate-900">Notifications</span>
              {unreadCount > 0 && (
                <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full font-medium">
                  {unreadCount} unread
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                disabled={loading}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
            {recentNotifications.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">
                <span>All clear! No notifications.</span>
              </div>
            ) : (
              recentNotifications.map((n) => (
                <div
                  key={n.id}
                  className={`p-3.5 flex items-start space-x-3 transition hover:bg-slate-50 ${
                    !n.isRead ? 'bg-blue-50/40' : ''
                  }`}
                >
                  <span className="text-lg mt-0.5">{getIcon(n.type)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className={`text-xs font-semibold truncate ${!n.isRead ? 'text-blue-900' : 'text-slate-900'}`}>
                        {n.title}
                      </p>
                      {!n.isRead && (
                        <button
                          onClick={(e) => handleMarkAsRead(n.id, e)}
                          title="Mark as read"
                          className="text-[10px] text-blue-600 hover:text-blue-800 ml-2 whitespace-nowrap"
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{n.message}</p>
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-2.5 bg-slate-50 border-t border-slate-200 text-center">
            <Link
              href="/notifications"
              onClick={() => setIsOpen(false)}
              className="text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              View all notifications →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
