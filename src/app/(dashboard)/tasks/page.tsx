'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  taskType: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
  dueDate: string | null;
  completedAt: string | null;
  completionNotes: string | null;
  assignedToId: string | null;
  providerId: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  assignedTo: { id: string; firstName: string; lastName: string; email: string } | null;
  createdBy: { id: string; firstName: string; lastName: string; email: string } | null;
  completedBy: { id: string; firstName: string; lastName: string; email: string } | null;
  provider: { id: string; firstName: string; lastName: string; npiNumber: string | null } | null;
}

interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

interface ProviderOption {
  id: string;
  firstName: string;
  lastName: string;
  npiNumber: string | null;
}

export default function TasksWorkQueuePage() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // KPIs
  const [kpis, setKpis] = useState({
    total: 0,
    pending: 0,
    in_progress: 0,
    blocked: 0,
    completed: 0,
    cancelled: 0,
    overdue: 0,
    urgent: 0,
  });

  // Filters & Pagination
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [taskTypeFilter, setTaskTypeFilter] = useState('all');
  const [dueWindowFilter, setDueWindowFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Auxiliary data
  const [users, setUsers] = useState<UserOption[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null);

  // Form states
  const [createForm, setCreateForm] = useState({
    title: '',
    description: '',
    taskType: 'general',
    priority: 'medium',
    dueDate: '',
    assignedToId: '',
    providerId: '',
  });
  const [completionNotes, setCompletionNotes] = useState('');
  const [selectedAssigneeId, setSelectedAssigneeId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Fetch Users & Providers for selectors
  useEffect(() => {
    async function fetchAuxiliaryData() {
      try {
        const [usersRes, providersRes] = await Promise.all([
          fetch('/api/v1/users'),
          fetch('/api/v1/providers?pageSize=100'),
        ]);

        if (usersRes.ok) {
          const data = await usersRes.json();
          setUsers(data.users || []);
        }

        if (providersRes.ok) {
          const data = await providersRes.json();
          setProviders(data.providers || []);
        }
      } catch (e) {
        console.error('Failed to load auxiliary selector data:', e);
      }
    }
    fetchAuxiliaryData();
  }, []);

  // Fetch Tasks
  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('pageSize', '15');

      if (search.trim()) params.set('search', search.trim());
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (priorityFilter !== 'all') params.set('priority', priorityFilter);
      if (taskTypeFilter !== 'all') params.set('taskType', taskTypeFilter);
      if (dueWindowFilter !== 'all') params.set('dueWindow', dueWindowFilter);

      const res = await fetch(`/api/v1/tasks?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to load tasks (${res.status})`);
      }
      const data = await res.json();
      setTasks(data.tasks || []);
      setTotalPages(data.pagination?.totalPages || 1);
      setTotalCount(data.pagination?.total || 0);
      if (data.kpis) {
        setKpis(data.kpis);
      }
    } catch (err: any) {
      setError(err.message || 'Error fetching tasks');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, priorityFilter, taskTypeFilter, dueWindowFilter]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Handle Quick Status Change
  const handleStatusChange = async (taskId: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Status update failed');
      setActionSuccess('Task status updated');
      setTimeout(() => setActionSuccess(null), 3000);
      fetchTasks();
    } catch (err: any) {
      alert(err.message || 'Failed to update status');
    }
  };

  // Handle Complete Task
  const handleCompleteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/tasks/${selectedTask.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completionNotes: completionNotes.trim() || undefined }),
      });
      if (!res.ok) throw new Error('Failed to complete task');
      setShowCompleteModal(false);
      setSelectedTask(null);
      setCompletionNotes('');
      setActionSuccess('Task marked as completed');
      setTimeout(() => setActionSuccess(null), 3000);
      fetchTasks();
    } catch (err: any) {
      alert(err.message || 'Error completing task');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Assign Task
  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask || !selectedAssigneeId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/tasks/${selectedTask.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedToId: selectedAssigneeId }),
      });
      if (!res.ok) throw new Error('Failed to assign task');
      setShowAssignModal(false);
      setSelectedTask(null);
      setSelectedAssigneeId('');
      setActionSuccess('Task reassigned successfully');
      setTimeout(() => setActionSuccess(null), 3000);
      fetchTasks();
    } catch (err: any) {
      alert(err.message || 'Error assigning task');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Create Task
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload: any = {
        title: createForm.title.trim(),
        description: createForm.description.trim() || undefined,
        taskType: createForm.taskType,
        priority: createForm.priority,
        dueDate: createForm.dueDate || undefined,
        assignedToId: createForm.assignedToId || undefined,
        providerId: createForm.providerId || undefined,
      };

      const res = await fetch('/api/v1/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to create task');
      }

      setShowCreateModal(false);
      setCreateForm({
        title: '',
        description: '',
        taskType: 'general',
        priority: 'medium',
        dueDate: '',
        assignedToId: '',
        providerId: '',
      });
      setActionSuccess('Task created successfully');
      setTimeout(() => setActionSuccess(null), 3000);
      fetchTasks();
    } catch (err: any) {
      alert(err.message || 'Error creating task');
    } finally {
      setSubmitting(false);
    }
  };

  // Helpers
  const isOverdue = (dueDate: string | null, status: string) => {
    if (!dueDate || status === 'completed' || status === 'cancelled') return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(dueDate) < today;
  };

  const isDueToday = (dueDate: string | null, status: string) => {
    if (!dueDate || status === 'completed' || status === 'cancelled') return false;
    const today = new Date().toISOString().slice(0, 10);
    return dueDate.slice(0, 10) === today;
  };

  const getPriorityBadge = (p: string) => {
    switch (p) {
      case 'urgent':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">🔥 Urgent</span>;
      case 'high':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">High</span>;
      case 'medium':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">Medium</span>;
      default:
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">Low</span>;
    }
  };

  const getStatusBadge = (s: string) => {
    switch (s) {
      case 'completed':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">Completed</span>;
      case 'in_progress':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-sky-100 text-sky-800">In Progress</span>;
      case 'blocked':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">Blocked</span>;
      case 'cancelled':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-200 text-slate-700">Cancelled</span>;
      default:
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">Pending</span>;
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Top Banner & Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <span>✅</span> Operational Task Work Queue
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Track, assign, prioritize, and complete operational credentialing and enrollment workflows.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchTasks()}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm"
          >
            🔄 Refresh
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm flex items-center gap-1.5"
          >
            <span>+</span> New Task
          </button>
        </div>
      </div>

      {actionSuccess && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-sm">
          ✅ {actionSuccess}
        </div>
      )}

      {/* Real-Time Operational KPI Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <div
          onClick={() => { setStatusFilter('all'); setDueWindowFilter('all'); setPriorityFilter('all'); setPage(1); }}
          className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm cursor-pointer hover:border-blue-400 transition"
        >
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Tasks</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{kpis.total}</div>
        </div>

        <div
          onClick={() => { setDueWindowFilter('overdue'); setStatusFilter('all'); setPage(1); }}
          className={`p-4 rounded-xl border shadow-sm cursor-pointer transition ${
            kpis.overdue > 0
              ? 'bg-rose-50 border-rose-200 hover:border-rose-400'
              : 'bg-white border-slate-200 hover:border-rose-300'
          }`}
        >
          <div className="text-xs font-medium text-rose-700 uppercase tracking-wider">Overdue</div>
          <div className="text-2xl font-bold text-rose-800 mt-1">{kpis.overdue}</div>
        </div>

        <div
          onClick={() => { setPriorityFilter('urgent'); setStatusFilter('all'); setPage(1); }}
          className={`p-4 rounded-xl border shadow-sm cursor-pointer transition ${
            kpis.urgent > 0
              ? 'bg-amber-50 border-amber-200 hover:border-amber-400'
              : 'bg-white border-slate-200 hover:border-amber-300'
          }`}
        >
          <div className="text-xs font-medium text-amber-700 uppercase tracking-wider">Urgent Priority</div>
          <div className="text-2xl font-bold text-amber-800 mt-1">{kpis.urgent}</div>
        </div>

        <div
          onClick={() => { setStatusFilter('in_progress'); setDueWindowFilter('all'); setPage(1); }}
          className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm cursor-pointer hover:border-sky-400 transition"
        >
          <div className="text-xs font-medium text-sky-600 uppercase tracking-wider">In Progress</div>
          <div className="text-2xl font-bold text-sky-800 mt-1">{kpis.in_progress}</div>
        </div>

        <div
          onClick={() => { setStatusFilter('blocked'); setDueWindowFilter('all'); setPage(1); }}
          className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm cursor-pointer hover:border-purple-400 transition"
        >
          <div className="text-xs font-medium text-purple-600 uppercase tracking-wider">Blocked</div>
          <div className="text-2xl font-bold text-purple-800 mt-1">{kpis.blocked}</div>
        </div>

        <div
          onClick={() => { setStatusFilter('completed'); setDueWindowFilter('all'); setPage(1); }}
          className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm cursor-pointer hover:border-emerald-400 transition"
        >
          <div className="text-xs font-medium text-emerald-600 uppercase tracking-wider">Completed</div>
          <div className="text-2xl font-bold text-emerald-800 mt-1">{kpis.completed}</div>
        </div>
      </div>

      {/* Filters & Search Controls */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {/* Search */}
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Search Tasks</label>
            <input
              type="text"
              placeholder="Search by title, description, provider..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="blocked">Blocked</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {/* Priority Filter */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Priority</label>
            <select
              value={priorityFilter}
              onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          {/* Due Window Filter */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Due Window</label>
            <select
              value={dueWindowFilter}
              onChange={(e) => { setDueWindowFilter(e.target.value); setPage(1); }}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Dates</option>
              <option value="overdue">Overdue Only</option>
              <option value="due_today">Due Today</option>
              <option value="due_this_week">Due Next 7 Days</option>
              <option value="upcoming">Upcoming</option>
            </select>
          </div>
        </div>

        {/* Second Row: Task Type and Reset */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500">Task Type:</span>
            <select
              value={taskTypeFilter}
              onChange={(e) => { setTaskTypeFilter(e.target.value); setPage(1); }}
              className="px-2.5 py-1 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Types</option>
              <option value="credential_renewal">Credential Renewal</option>
              <option value="document_review">Document Review</option>
              <option value="enrollment_follow_up">Enrollment Follow-up</option>
              <option value="revalidation">Revalidation</option>
              <option value="verification">Verification</option>
              <option value="general">General</option>
            </select>
          </div>

          {(search || statusFilter !== 'all' || priorityFilter !== 'all' || taskTypeFilter !== 'all' || dueWindowFilter !== 'all') && (
            <button
              onClick={() => {
                setSearch('');
                setStatusFilter('all');
                setPriorityFilter('all');
                setTaskTypeFilter('all');
                setDueWindowFilter('all');
                setPage(1);
              }}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              Clear All Filters
            </button>
          )}
        </div>
      </div>

      {/* Task Queue Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-2"></div>
            <div>Loading task work queue...</div>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-rose-600">
            <div>⚠️ {error}</div>
            <button
              onClick={() => fetchTasks()}
              className="mt-3 px-3 py-1.5 bg-rose-50 text-rose-700 border border-rose-200 rounded text-sm hover:bg-rose-100"
            >
              Retry
            </button>
          </div>
        ) : tasks.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <div className="text-4xl mb-2">📋</div>
            <div className="text-base font-medium text-slate-700">No tasks found</div>
            <p className="text-sm text-slate-400 mt-1">Try adjusting your filters or search terms.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Task Details</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Priority</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Due Date</th>
                  <th className="py-3 px-4">Assigned To</th>
                  <th className="py-3 px-4">Provider</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tasks.map((task) => {
                  const overdue = isOverdue(task.dueDate, task.status);
                  const dueToday = isDueToday(task.dueDate, task.status);

                  return (
                    <tr
                      key={task.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        overdue ? 'bg-rose-50/30' : ''
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{task.title}</div>
                        {task.description && (
                          <div className="text-xs text-slate-500 line-clamp-1 mt-0.5 max-w-sm">
                            {task.description}
                          </div>
                        )}
                        {task.completionNotes && task.status === 'completed' && (
                          <div className="text-xs text-emerald-700 mt-1 bg-emerald-50 p-1 rounded border border-emerald-100">
                            📝 {task.completionNotes}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">
                          {task.taskType.replace(/_/g, ' ')}
                        </span>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        {getPriorityBadge(task.priority)}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        <select
                          value={task.status}
                          onChange={(e) => handleStatusChange(task.id, e.target.value)}
                          className="text-xs font-medium bg-transparent border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="pending">Pending</option>
                          <option value="in_progress">In Progress</option>
                          <option value="blocked">Blocked</option>
                          <option value="completed">Completed</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        {task.dueDate ? (
                          <div
                            className={`text-xs font-medium ${
                              overdue
                                ? 'text-rose-700 font-bold flex items-center gap-1'
                                : dueToday
                                ? 'text-amber-700 font-bold'
                                : 'text-slate-700'
                            }`}
                          >
                            {overdue && <span>⚠️</span>}
                            {new Date(task.dueDate).toISOString().slice(0, 10)}
                            {overdue && <span className="text-[10px] bg-rose-100 text-rose-800 px-1 rounded ml-1">Overdue</span>}
                            {dueToday && <span className="text-[10px] bg-amber-100 text-amber-800 px-1 rounded ml-1">Today</span>}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 italic">No due date</span>
                        )}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        {task.assignedTo ? (
                          <div className="text-xs">
                            <span className="font-medium text-slate-800">
                              {task.assignedTo.firstName} {task.assignedTo.lastName}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                            Unassigned
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        {task.provider ? (
                          <Link
                            href={`/providers/${task.provider.id}`}
                            className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            {task.provider.firstName} {task.provider.lastName}
                            <span className="text-slate-400 block text-[10px] font-mono">
                              NPI: {task.provider.npiNumber || 'N/A'}
                            </span>
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap text-right space-x-1">
                        {task.status !== 'completed' && (
                          <button
                            onClick={() => {
                              setSelectedTask(task);
                              setShowCompleteModal(true);
                            }}
                            title="Mark as Complete"
                            className="px-2 py-1 text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded border border-emerald-200 transition"
                          >
                            ✓ Done
                          </button>
                        )}

                        <button
                          onClick={() => {
                            setSelectedTask(task);
                            setSelectedAssigneeId(task.assignedToId || '');
                            setShowAssignModal(true);
                          }}
                          title="Assign or Reassign Task"
                          className="px-2 py-1 text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 rounded border border-slate-200 transition"
                        >
                          👤 Assign
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <div>
            Showing <span className="font-medium">{tasks.length}</span> of{' '}
            <span className="font-medium">{totalCount}</span> tasks
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-2.5 py-1.5 border border-slate-300 rounded bg-white text-slate-700 font-medium disabled:opacity-50 hover:bg-slate-50"
            >
              Previous
            </button>
            <span className="px-2">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-2.5 py-1.5 border border-slate-300 rounded bg-white text-slate-700 font-medium disabled:opacity-50 hover:bg-slate-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Complete Task Modal */}
      {showCompleteModal && selectedTask && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-start">
              <h3 className="text-lg font-bold text-slate-900">Complete Task</h3>
              <button
                onClick={() => { setShowCompleteModal(false); setSelectedTask(null); }}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
            <p className="text-sm text-slate-600">
              Marking <strong className="text-slate-900">&ldquo;{selectedTask.title}&rdquo;</strong> as completed.
            </p>
            <form onSubmit={handleCompleteSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Completion Notes (Optional)
                </label>
                <textarea
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  placeholder="Detail any actions taken or verification outcomes..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 h-24"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowCompleteModal(false); setSelectedTask(null); }}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {submitting ? 'Completing...' : 'Mark Complete'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign Task Modal */}
      {showAssignModal && selectedTask && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-start">
              <h3 className="text-lg font-bold text-slate-900">Assign Task</h3>
              <button
                onClick={() => { setShowAssignModal(false); setSelectedTask(null); }}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
            <p className="text-sm text-slate-600">
              Select staff member to assign <strong className="text-slate-900">&ldquo;{selectedTask.title}&rdquo;</strong>:
            </p>
            <form onSubmit={handleAssignSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Assignee
                </label>
                <select
                  value={selectedAssigneeId}
                  onChange={(e) => setSelectedAssigneeId(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select a user...</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.firstName} {u.lastName} ({u.role})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowAssignModal(false); setSelectedTask(null); }}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !selectedAssigneeId}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {submitting ? 'Assigning...' : 'Save Assignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Task Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex justify-between items-start">
              <h3 className="text-lg font-bold text-slate-900">Create New Task</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Title <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={createForm.title}
                  onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
                  placeholder="e.g. Verify Texas State License PSV"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Description
                </label>
                <textarea
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  placeholder="Additional instructions or notes..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 h-20"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Task Type
                  </label>
                  <select
                    value={createForm.taskType}
                    onChange={(e) => setCreateForm({ ...createForm, taskType: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="general">General</option>
                    <option value="credential_renewal">Credential Renewal</option>
                    <option value="document_review">Document Review</option>
                    <option value="enrollment_follow_up">Enrollment Follow-up</option>
                    <option value="revalidation">Revalidation</option>
                    <option value="verification">Verification</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Priority
                  </label>
                  <select
                    value={createForm.priority}
                    onChange={(e) => setCreateForm({ ...createForm, priority: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="urgent">Urgent</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={createForm.dueDate}
                    onChange={(e) => setCreateForm({ ...createForm, dueDate: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Assign To
                  </label>
                  <select
                    value={createForm.assignedToId}
                    onChange={(e) => setCreateForm({ ...createForm, assignedToId: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Unassigned</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.firstName} {u.lastName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Associated Provider (Optional)
                </label>
                <select
                  value={createForm.providerId}
                  onChange={(e) => setCreateForm({ ...createForm, providerId: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">None (Organization level)</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.firstName} {p.lastName} (NPI: {p.npiNumber || 'N/A'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {submitting ? 'Creating...' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
