'use client';

import { useState, useEffect, useCallback } from 'react';

interface UserItem {
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

export default function UsersAdminPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);

  // Forms
  const [createForm, setCreateForm] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    role: 'viewer',
  });

  const [editForm, setEditForm] = useState({
    firstName: '',
    lastName: '',
    role: 'viewer',
    isActive: true,
  });

  // Reset Password State
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetTargetUser, setResetTargetUser] = useState<UserItem | null>(null);
  const [temporaryPasswordResult, setTemporaryPasswordResult] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (roleFilter) params.set('role', roleFilter);
      if (statusFilter) params.set('status', statusFilter);
      params.set('page', page.toString());
      params.set('limit', '10');

      const res = await fetch(`/api/v1/admin/users?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
      } else if (res.status === 403) {
        setNotice({
          type: 'error',
          text: 'Access Denied: Administrator privileges (admin or super_admin) are required to access User Management.',
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter, page]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    try {
      const res = await fetch('/api/v1/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to create user');
      }
      setNotice({ type: 'success', text: `User ${createForm.email} created successfully.` });
      setShowCreateModal(false);
      setCreateForm({ email: '', password: '', firstName: '', lastName: '', role: 'viewer' });
      fetchUsers();
    } catch (err: unknown) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Error creating user' });
    }
  };

  const openEditModal = (u: UserItem) => {
    setSelectedUser(u);
    setEditForm({
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      isActive: u.isActive,
    });
    setShowEditModal(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setNotice(null);
    try {
      const res = await fetch(`/api/v1/admin/users/${selectedUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to update user');
      }
      setNotice({ type: 'success', text: `User ${selectedUser.email} updated successfully.` });
      setShowEditModal(false);
      fetchUsers();
    } catch (err: unknown) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Error updating user' });
    }
  };

  const handleToggleActive = async (u: UserItem) => {
    const actionName = u.isActive ? 'deactivate' : 'reactivate';
    if (!confirm(`Are you sure you want to ${actionName} ${u.email}?`)) return;

    setNotice(null);
    try {
      const res = await fetch(`/api/v1/admin/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !u.isActive }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || `Failed to ${actionName} user`);
      }
      setNotice({ type: 'success', text: `User ${u.email} has been ${actionName}d.` });
      fetchUsers();
    } catch (err: unknown) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : `Error during ${actionName}` });
    }
  };

  const openResetPasswordModal = (u: UserItem) => {
    setResetTargetUser(u);
    setTemporaryPasswordResult(null);
    setResetModalOpen(true);
  };

  const handleExecuteResetPassword = async () => {
    if (!resetTargetUser) return;
    try {
      setResetting(true);
      const res = await fetch(`/api/v1/admin/users/${resetTargetUser.id}/reset-password`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Password reset failed');
      }
      setTemporaryPasswordResult(data.temporaryPassword);
    } catch (err: unknown) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Password reset failed' });
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Administer staff credentials, role-based access control (RBAC), and account lifecycles
          </p>
        </div>
        <button
          onClick={() => {
            setNotice(null);
            setShowCreateModal(true);
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition"
        >
          + Add Staff User
        </button>
      </div>

      {/* Notifications */}
      {notice && (
        <div
          className={`p-4 rounded-xl text-sm border ${
            notice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap gap-3 items-center justify-between">
        <div className="flex-1 min-w-[240px]">
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </div>
        <div className="flex items-center space-x-2">
          <select
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-700"
          >
            <option value="">All Roles</option>
            <option value="super_admin">Super Admin</option>
            <option value="admin">Admin</option>
            <option value="credentialing_specialist">Credentialing Specialist</option>
            <option value="enrollment_specialist">Enrollment Specialist</option>
            <option value="viewer">Viewer</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-700"
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider font-semibold">
            <tr>
              <th className="py-3 px-4 text-left">Staff Member</th>
              <th className="py-3 px-4 text-left">Email Address</th>
              <th className="py-3 px-4 text-left">Assigned Role</th>
              <th className="py-3 px-4 text-left">Status</th>
              <th className="py-3 px-4 text-left">MFA</th>
              <th className="py-3 px-4 text-left">Last Login</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {loading ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  Loading users...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  No users match the search criteria.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-medium text-slate-900">
                    {u.firstName} {u.lastName}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-600">{u.email}</td>
                  <td className="py-3 px-4">
                    <span className="inline-block px-2 py-0.5 text-xs font-semibold rounded bg-blue-50 text-blue-700 border border-blue-200">
                      {u.role.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {u.isActive ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
                        Deactivated
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {u.mfaEnabled ? (
                      <span className="text-emerald-600 font-medium text-xs">✓ Active</span>
                    ) : (
                      <span className="text-slate-400 text-xs">Disabled</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-500">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}
                  </td>
                  <td className="py-3 px-4 text-right space-x-1.5">
                    <button
                      onClick={() => openEditModal(u)}
                      className="px-2 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleToggleActive(u)}
                      className={`px-2 py-1 text-xs font-medium rounded border ${
                        u.isActive
                          ? 'text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-300'
                          : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-300'
                      }`}
                    >
                      {u.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                    <button
                      onClick={() => openResetPasswordModal(u)}
                      className="px-2 py-1 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded border border-purple-300"
                    >
                      Reset Pwd
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination Footer */}
        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <div>
            Showing {users.length} of {total} staff users
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-2.5 py-1 rounded border border-slate-300 bg-white disabled:opacity-50 hover:bg-slate-50"
            >
              Previous
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-2.5 py-1 rounded border border-slate-300 bg-white disabled:opacity-50 hover:bg-slate-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Add User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Add New Staff Member</h2>
            <form onSubmit={handleCreateSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">First Name</label>
                  <input
                    type="text"
                    required
                    value={createForm.firstName}
                    onChange={(e) => setCreateForm({ ...createForm, firstName: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Last Name</label>
                  <input
                    type="text"
                    required
                    value={createForm.lastName}
                    onChange={(e) => setCreateForm({ ...createForm, lastName: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Initial Password (min 8 chars, 1 uppercase, 1 lowercase, 1 number)
                </label>
                <input
                  type="password"
                  required
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Role</label>
                <select
                  value={createForm.role}
                  onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="super_admin">Super Admin</option>
                  <option value="admin">Admin</option>
                  <option value="credentialing_specialist">Credentialing Specialist</option>
                  <option value="enrollment_specialist">Enrollment Specialist</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <div className="flex justify-end space-x-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 text-xs rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg"
                >
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditModal && selectedUser && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Edit Staff User</h2>
            <div className="mb-3 text-xs text-slate-500 font-mono">
              Account: {selectedUser.email}
            </div>
            <form onSubmit={handleEditSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">First Name</label>
                  <input
                    type="text"
                    required
                    value={editForm.firstName}
                    onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Last Name</label>
                  <input
                    type="text"
                    required
                    value={editForm.lastName}
                    onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Assigned Role</label>
                <select
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="super_admin">Super Admin</option>
                  <option value="admin">Admin</option>
                  <option value="credentialing_specialist">Credentialing Specialist</option>
                  <option value="enrollment_specialist">Enrollment Specialist</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="activeCheckbox"
                  checked={editForm.isActive}
                  onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="activeCheckbox" className="text-xs font-medium text-slate-700">
                  Account Active (Unchecking revokes all active sessions)
                </label>
              </div>
              <div className="flex justify-end space-x-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 text-xs rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Reset Password Modal */}
      {resetModalOpen && resetTargetUser && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200 space-y-4">
            <h2 className="text-lg font-bold text-slate-900">Admin Password Reset</h2>
            <p className="text-xs text-slate-600">
              Reset password for <strong>{resetTargetUser.email}</strong>. This will revoke all currently
              active sessions for this user.
            </p>

            {temporaryPasswordResult ? (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg space-y-2">
                <div className="text-xs font-semibold text-emerald-800">
                  Password reset successfully! Secure temporary password:
                </div>
                <div className="p-2.5 bg-white border border-emerald-300 rounded font-mono text-sm text-slate-900 font-bold select-all text-center">
                  {temporaryPasswordResult}
                </div>
                <div className="text-[11px] text-emerald-700">
                  Deliver this temporary password to the user securely. It will not be shown again.
                </div>
              </div>
            ) : (
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResetModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 text-xs rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExecuteResetPassword}
                  disabled={resetting}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium rounded-lg"
                >
                  {resetting ? 'Generating...' : 'Generate New Password'}
                </button>
              </div>
            )}

            {temporaryPasswordResult && (
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setResetModalOpen(false)}
                  className="px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg"
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
