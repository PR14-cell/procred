'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    router.push('/login');
  };

  interface NavItem {
    label: string;
    href: string;
    icon: string;
    badge?: string;
  }

  const navItems: NavItem[] = [
    { label: 'Dashboard', href: '/dashboard', icon: '📊' },
    { label: 'Providers', href: '/providers', icon: '👤' },
    { label: 'Credentials & Expirations', href: '/credentials', icon: '🛡️' },
    { label: 'Payer Enrollments', href: '/enrollments', icon: '📝' },
    { label: 'Payers Directory', href: '/admin/payers', icon: '🏛️' },
    { label: 'Documents', href: '/documents', icon: '📄' },
    { label: 'Tasks', href: '/tasks', icon: '✅' },
    { label: 'Users & Roles', href: '/admin/users', icon: '⚙️' },
  ];

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800">
        <div className="p-5 border-b border-slate-800 flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-sm">
            PC
          </div>
          <div>
            <div className="font-semibold text-white text-sm">Provider Cred</div>
            <div className="text-xs text-slate-400">Payer Enrollment</div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition font-medium ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-normal">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs">
              <div className="text-white font-medium">Logged in</div>
              <div className="text-slate-400">Admin Account</div>
            </div>
            <span className="inline-block px-2 py-0.5 text-[10px] font-semibold bg-emerald-900/50 text-emerald-400 border border-emerald-700/50 rounded">
              Phase 2 Active
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6">
          <div className="flex items-center space-x-2 text-sm text-slate-500">
            <span>Provider Credentialing</span>
            <span>/</span>
            <span className="text-slate-900 font-medium capitalize">
              {pathname.replace('/', '') || 'Dashboard'}
            </span>
          </div>

          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-xs text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Self-Hosted & Isolated</span>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
