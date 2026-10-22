import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/db/prisma';
import { TaskService } from '../src/lib/tasks/task-service';
import { NoteService } from '../src/lib/notes/note-service';
import { scanDueTasksAndNotify } from '../workers/task.worker';
import { createTaskSchema, updateTaskSchema, assignTaskSchema } from '../src/lib/validation/task';
import { createNoteSchema, updateNoteSchema } from '../src/lib/validation/note';
import { hasPermission } from '../src/lib/auth/rbac';

describe('Phase 6: Tasks, Notes, Verification & Operational Workflow', () => {
  let specialistUser: any;
  let colleagueUser: any;
  let viewerUser: any;
  let testProvider: any;
  const createdTaskIds: string[] = [];
  const createdNoteIds: string[] = [];

  beforeAll(async () => {
    // 1. Create specialist user
    specialistUser = await prisma.user.upsert({
      where: { email: 'phase6_specialist@example.com' },
      update: {},
      create: {
        email: 'phase6_specialist@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Sarah',
        lastName: 'TaskCoordinator',
        role: 'credentialing_specialist',
      },
    });

    // 2. Create colleague user for assignment tests
    colleagueUser = await prisma.user.upsert({
      where: { email: 'phase6_colleague@example.com' },
      update: {},
      create: {
        email: 'phase6_colleague@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Alex',
        lastName: 'EnrollmentAgent',
        role: 'enrollment_specialist',
      },
    });

    // 3. Create viewer user
    viewerUser = await prisma.user.upsert({
      where: { email: 'phase6_viewer@example.com' },
      update: {},
      create: {
        email: 'phase6_viewer@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Victor',
        lastName: 'Viewer',
        role: 'viewer',
      },
    });

    // 4. Create synthetic provider
    testProvider = await prisma.provider.upsert({
      where: { npiNumber: '9999999996' },
      update: {},
      create: {
        firstName: 'Fictional',
        lastName: 'DoctorSix',
        npiNumber: '9999999996',
        npiType: 1,
        status: 'active',
        credentialingStatus: 'in_progress',
      },
    });
  });

  afterAll(async () => {
    // Clean up created tasks and notes
    if (createdTaskIds.length > 0) {
      await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
    }
    if (createdNoteIds.length > 0) {
      await prisma.note.deleteMany({ where: { id: { in: createdNoteIds } } });
    }
    // Clean up synthetic provider
    if (testProvider) {
      await prisma.provider.deleteMany({ where: { id: testProvider.id } });
    }
  });

  describe('1. Task Validation Schemas', () => {
    it('validates task creation input properly', () => {
      const valid = createTaskSchema.parse({
        title: 'Review CAQH Attestation',
        taskType: 'credential_renewal',
        priority: 'high',
        dueDate: '2026-11-15',
        assignedToId: specialistUser.id,
      });
      expect(valid.title).toBe('Review CAQH Attestation');
      expect(valid.taskType).toBe('credential_renewal');
      expect(valid.priority).toBe('high');
    });

    it('rejects task with too short title', () => {
      expect(() => {
        createTaskSchema.parse({ title: 'No' });
      }).toThrow();
    });

    it('rejects invalid due date format', () => {
      expect(() => {
        createTaskSchema.parse({
          title: 'Valid Task Title',
          dueDate: '11/15/2026',
        });
      }).toThrow();
    });

    it('validates assignment schema requires valid UUID', () => {
      expect(() => {
        assignTaskSchema.parse({ assignedToId: 'not-a-uuid' });
      }).toThrow();
    });
  });

  describe('2. Operational Task Lifecycle & Service Logic', () => {
    let taskId: string;

    it('creates a task with associated provider and logs audit event', async () => {
      const task = await TaskService.createTask(
        {
          title: 'Primary Source Verification for State License',
          description: 'Check official medical board portal for disciplinary actions.',
          taskType: 'verification',
          priority: 'urgent',
          dueDate: '2026-10-30',
          providerId: testProvider.id,
          assignedToId: specialistUser.id,
        },
        { id: specialistUser.id, email: specialistUser.email }
      );

      expect(task.id).toBeDefined();
      expect(task.status).toBe('pending');
      expect(task.priority).toBe('urgent');
      expect(task.providerId).toBe(testProvider.id);
      expect(task.assignedToId).toBe(specialistUser.id);
      createdTaskIds.push(task.id);
      taskId = task.id;

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: { entityId: task.id, action: 'TASK_CREATED' },
      });
      expect(audit).toBeDefined();
      expect(audit?.userId).toBe(specialistUser.id);
    });

    it('updates task status from pending to in_progress', async () => {
      const updated = await TaskService.updateTask(
        taskId,
        { status: 'in_progress' },
        { id: specialistUser.id, email: specialistUser.email }
      );

      expect(updated.status).toBe('in_progress');
      expect(updated.completedAt).toBeNull();
      expect(updated.completedById).toBeNull();
    });

    it('reassigns task to a colleague and dispatches notification', async () => {
      const reassigned = await TaskService.assignTask(
        taskId,
        colleagueUser.id,
        { id: specialistUser.id, email: specialistUser.email }
      );

      expect(reassigned.assignedToId).toBe(colleagueUser.id);

      // Verify in-app notification created for colleague
      const notif = await prisma.notification.findFirst({
        where: {
          userId: colleagueUser.id,
          type: 'task_assigned',
          entityId: taskId,
        },
      });
      expect(notif).toBeDefined();
      expect(notif?.title).toContain('Task');
    });

    it('marks task as completed with completion notes and records timestamp/user', async () => {
      const completed = await TaskService.completeTask(
        taskId,
        'PSV completed via online portal. License confirmed active with no sanctions.',
        { id: colleagueUser.id, email: colleagueUser.email }
      );

      expect(completed.status).toBe('completed');
      expect(completed.completedAt).toBeInstanceOf(Date);
      expect(completed.completedById).toBe(colleagueUser.id);
      expect(completed.completionNotes).toContain('License confirmed active');

      // Verify audit event
      const audit = await prisma.auditLog.findFirst({
        where: { entityId: taskId, action: 'TASK_COMPLETED' },
      });
      expect(audit).toBeDefined();
      expect(audit?.userId).toBe(colleagueUser.id);
    });

    it('cancelling a task updates status to cancelled with notes', async () => {
      const taskToCancel = await TaskService.createTask(
        {
          title: 'Obsolete Review Task',
          taskType: 'general',
          providerId: testProvider.id,
        },
        { id: specialistUser.id, email: specialistUser.email }
      );
      createdTaskIds.push(taskToCancel.id);

      const cancelled = await TaskService.cancelTask(
        taskToCancel.id,
        'Provider withdrew application',
        { id: specialistUser.id, email: specialistUser.email }
      );

      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.completionNotes).toContain('Provider withdrew');
    });

    it('rejects completing an already cancelled task (invalid transition)', async () => {
      const taskToCancel = await TaskService.createTask(
        {
          title: 'Cancelled Transition Test',
          taskType: 'general',
          providerId: testProvider.id,
        },
        { id: specialistUser.id, email: specialistUser.email }
      );
      createdTaskIds.push(taskToCancel.id);

      await TaskService.cancelTask(taskToCancel.id, 'No longer needed', {
        id: specialistUser.id,
        email: specialistUser.email,
      });

      await expect(
        TaskService.completeTask(taskToCancel.id, 'Trying to complete cancelled task', {
          id: specialistUser.id,
          email: specialistUser.email,
        })
      ).rejects.toThrow('Cannot complete a cancelled task');
    });

    it('rejects reassigning a completed task', async () => {
      await expect(
        TaskService.assignTask(taskId, specialistUser.id, {
          id: colleagueUser.id,
          email: colleagueUser.email,
        })
      ).rejects.toThrow('Cannot reassign a completed task');
    });

    it('verifies completing a task does NOT alter underlying credential or document status', async () => {
      // Create a test state license in pending_verification
      const license = await prisma.stateLicense.create({
        data: {
          providerId: testProvider.id,
          state: 'TX',
          licenseNumber: 'TX-TASK-TEST-99',
          status: 'pending_verification',
        },
      });

      // Create a task associated with this license
      const task = await TaskService.createTask(
        {
          title: 'Verify TX State License',
          taskType: 'verification',
          entityType: 'state_license',
          entityId: license.id,
          providerId: testProvider.id,
        },
        { id: specialistUser.id, email: specialistUser.email }
      );
      createdTaskIds.push(task.id);

      // Complete the task
      await TaskService.completeTask(task.id, 'Verified via primary source website', {
        id: specialistUser.id,
        email: specialistUser.email,
      });

      // Check license status in DB: MUST STILL BE pending_verification because formal PSV was not performed
      const checkLicense = await prisma.stateLicense.findUnique({ where: { id: license.id } });
      expect(checkLicense?.status).toBe('pending_verification');

      // Cleanup
      await prisma.stateLicense.delete({ where: { id: license.id } });
    });
  });

  describe('3. Task Work Queue Filtering & KPI Metrics', () => {
    let overdueTaskId: string;
    let urgentTaskId: string;

    beforeAll(async () => {
      // Create an overdue task (due 5 days ago)
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 5);
      const pastDateStr = pastDate.toISOString().slice(0, 10);

      const overdueTask = await TaskService.createTask(
        {
          title: 'Overdue Malpractice Certificate Request',
          taskType: 'document_review',
          priority: 'high',
          status: 'pending',
          dueDate: pastDateStr,
          providerId: testProvider.id,
          assignedToId: specialistUser.id,
        },
        { id: specialistUser.id, email: specialistUser.email }
      );
      overdueTaskId = overdueTask.id;
      createdTaskIds.push(overdueTaskId);

      // Create an urgent task
      const urgentTask = await TaskService.createTask(
        {
          title: 'Urgent Hospital Privilege Attestation',
          taskType: 'verification',
          priority: 'urgent',
          status: 'blocked',
          providerId: testProvider.id,
        },
        { id: specialistUser.id, email: specialistUser.email }
      );
      urgentTaskId = urgentTask.id;
      createdTaskIds.push(urgentTaskId);
    });

    it('computes live KPI metrics including overdue and urgent counts', async () => {
      const result = await TaskService.getTasks();

      expect(result.kpis.total).toBeGreaterThan(0);
      expect(result.kpis.overdue).toBeGreaterThanOrEqual(1);
      expect(result.kpis.urgent).toBeGreaterThanOrEqual(1);
      expect(result.pagination.total).toBeGreaterThan(0);
    });

    it('filters by dueWindow=overdue', async () => {
      const result = await TaskService.getTasks({ dueWindow: 'overdue' });
      const found = result.tasks.find((t) => t.id === overdueTaskId);
      expect(found).toBeDefined();
      // All returned tasks must have dueDate in the past and not completed
      for (const t of result.tasks) {
        expect(t.status).not.toBe('completed');
        expect(t.status).not.toBe('cancelled');
        expect(new Date(t.dueDate!).getTime()).toBeLessThan(Date.now());
      }
    });

    it('filters by priority=urgent', async () => {
      const result = await TaskService.getTasks({ priority: 'urgent' });
      const found = result.tasks.find((t) => t.id === urgentTaskId);
      expect(found).toBeDefined();
      for (const t of result.tasks) {
        expect(t.priority).toBe('urgent');
      }
    });

    it('filters by status=blocked', async () => {
      const result = await TaskService.getTasks({ status: 'blocked' });
      const found = result.tasks.find((t) => t.id === urgentTaskId);
      expect(found).toBeDefined();
      for (const t of result.tasks) {
        expect(t.status).toBe('blocked');
      }
    });

    it('searches by keyword matching title or description', async () => {
      const result = await TaskService.getTasks({ search: 'Hospital Privilege' });
      const found = result.tasks.find((t) => t.id === urgentTaskId);
      expect(found).toBeDefined();
    });

    it('supports pagination with custom page and pageSize', async () => {
      const result = await TaskService.getTasks({ page: 1, pageSize: 2 });
      expect(result.tasks.length).toBeLessThanOrEqual(2);
      expect(result.pagination.pageSize).toBe(2);
      expect(result.pagination.totalPages).toBeGreaterThanOrEqual(1);
    });
  });

  describe('4. Automated Tasks & Duplicate Prevention (Idempotency)', () => {
    it('creates an automated task idempotently without duplicates', async () => {
      const params = {
        title: 'Automated 30-Day DEA Registration Renewal Reminder',
        taskType: 'credential_renewal',
        priority: 'high',
        dueDate: '2026-11-20',
        entityType: 'dea_registration',
        entityId: 'a0000000-0000-0000-0000-000000000001',
        providerId: testProvider.id,
      };

      // 1st call: should create task
      const first = await TaskService.createAutomatedTask(params);
      expect(first.created).toBe(true);
      expect(first.task.id).toBeDefined();
      createdTaskIds.push(first.task.id);

      // 2nd call: should detect existing open task and return without duplicate
      const second = await TaskService.createAutomatedTask(params);
      expect(second.created).toBe(false);
      expect(second.task.id).toBe(first.task.id);

      // Count tasks for this entity - must be exactly 1
      const count = await prisma.task.count({
        where: {
          entityType: params.entityType,
          entityId: params.entityId,
          taskType: params.taskType,
        },
      });
      expect(count).toBe(1);
    });
  });

  describe('5. Due Tasks Background Worker', () => {
    it('scans overdue/due-today tasks and sends in-app notifications', async () => {
      const result = await scanDueTasksAndNotify();
      expect(result.scanned).toBeGreaterThanOrEqual(1);
      expect(result.notificationsSent).toBeGreaterThanOrEqual(1);

      // Verify a task_due notification exists in the database
      const notif = await prisma.notification.findFirst({
        where: {
          type: 'task_due',
          userId: specialistUser.id,
        },
      });
      expect(notif).toBeDefined();
      expect(notif?.title).toMatch(/Task Due|Overdue Task Alert/);
    });
  });

  describe('6. Reusable Notes System & Pinning', () => {
    let noteId: string;

    it('validates note input schemas', () => {
      expect(() => {
        createNoteSchema.parse({
          entityType: 'provider',
          entityId: 'invalid-id',
          content: 'Test content',
        });
      }).toThrow();

      expect(() => {
        createNoteSchema.parse({
          entityType: 'provider',
          entityId: testProvider.id,
          content: '', // empty
        });
      }).toThrow();
    });

    it('creates an operational note for a provider', async () => {
      const note = await NoteService.createNote(
        {
          entityType: 'provider',
          entityId: testProvider.id,
          providerId: testProvider.id,
          content: 'Provider confirmed updated clinic hours via phone on 2026-10-22.',
          isPinned: false,
        },
        { id: specialistUser.id, email: specialistUser.email }
      );

      expect(note.id).toBeDefined();
      expect(note.content).toContain('Provider confirmed');
      expect(note.isPinned).toBe(false);
      expect(note.createdById).toBe(specialistUser.id);
      createdNoteIds.push(note.id);
      noteId = note.id;

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: { entityId: note.id, action: 'NOTE_CREATED' },
      });
      expect(audit).toBeDefined();
      expect(audit?.userId).toBe(specialistUser.id);
    });

    it('pins a note to the top and logs NOTE_PINNED audit action', async () => {
      const updated = await NoteService.updateNote(
        noteId,
        { isPinned: true },
        { id: specialistUser.id, email: specialistUser.email }
      );

      expect(updated.isPinned).toBe(true);

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: noteId, action: 'NOTE_PINNED' },
      });
      expect(audit).toBeDefined();
    });

    it('sorts pinned notes first when fetching notes', async () => {
      // Create a second unpinned note
      const unpinned = await NoteService.createNote(
        {
          entityType: 'provider',
          entityId: testProvider.id,
          providerId: testProvider.id,
          content: 'Routine followup scheduled for next quarter.',
          isPinned: false,
        },
        { id: specialistUser.id, email: specialistUser.email }
      );
      createdNoteIds.push(unpinned.id);

      const notes = await NoteService.getNotes({ providerId: testProvider.id });
      expect(notes.length).toBeGreaterThanOrEqual(2);
      // The first note must be pinned
      expect(notes[0].isPinned).toBe(true);
      expect(notes[0].id).toBe(noteId);
    });

    it('updates note content and sets updatedById', async () => {
      const updated = await NoteService.updateNote(
        noteId,
        { content: 'Corrected: Provider clinic hours confirmed 8am - 5pm.' },
        { id: colleagueUser.id, email: colleagueUser.email }
      );

      expect(updated.content).toContain('Corrected');
      expect(updated.updatedById).toBe(colleagueUser.id);
    });

    it('deletes note with audit logging', async () => {
      const toDelete = await NoteService.createNote(
        {
          entityType: 'provider',
          entityId: testProvider.id,
          content: 'Temporary draft note to be deleted.',
        },
        { id: specialistUser.id, email: specialistUser.email }
      );

      const result = await NoteService.deleteNote(toDelete.id, {
        id: specialistUser.id,
        email: specialistUser.email,
      });
      expect(result.success).toBe(true);

      // Verify deletion from database
      const check = await prisma.note.findUnique({ where: { id: toDelete.id } });
      expect(check).toBeNull();

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: { entityId: toDelete.id, action: 'NOTE_DELETED' },
      });
      expect(audit).toBeDefined();
    });

    it('rejects note creation with non-existent provider ID (IDOR boundary)', async () => {
      await expect(
        NoteService.createNote(
          {
            entityType: 'provider',
            entityId: '00000000-0000-0000-0000-000000009999',
            providerId: '00000000-0000-0000-0000-000000009999',
            content: 'Attempting to inject note into non-existent provider',
          },
          { id: specialistUser.id, email: specialistUser.email }
        )
      ).rejects.toThrow('Provider not found');
    });

    it('rejects note retrieval with non-existent provider ID (IDOR boundary)', async () => {
      await expect(
        NoteService.getNotes({ providerId: '00000000-0000-0000-0000-000000009999' })
      ).rejects.toThrow('Provider not found');
    });
  });

  describe('7. Role-Based Access Control (RBAC)', () => {
    it('verifies super_admin has tasks:read, tasks:write, notes:read, notes:write', () => {
      expect(hasPermission('super_admin', 'tasks:read')).toBe(true);
      expect(hasPermission('super_admin', 'tasks:write')).toBe(true);
      expect(hasPermission('super_admin', 'notes:read')).toBe(true);
      expect(hasPermission('super_admin', 'notes:write')).toBe(true);
    });

    it('verifies credentialing_specialist and enrollment_specialist have tasks & notes access', () => {
      expect(hasPermission('credentialing_specialist', 'tasks:read')).toBe(true);
      expect(hasPermission('credentialing_specialist', 'tasks:write')).toBe(true);
      expect(hasPermission('credentialing_specialist', 'notes:read')).toBe(true);
      expect(hasPermission('credentialing_specialist', 'notes:write')).toBe(true);

      expect(hasPermission('enrollment_specialist', 'tasks:read')).toBe(true);
      expect(hasPermission('enrollment_specialist', 'tasks:write')).toBe(true);
      expect(hasPermission('enrollment_specialist', 'notes:read')).toBe(true);
      expect(hasPermission('enrollment_specialist', 'notes:write')).toBe(true);
    });

    it('verifies viewer has read-only access and cannot write tasks or notes', () => {
      expect(hasPermission('viewer', 'tasks:read')).toBe(true);
      expect(hasPermission('viewer', 'tasks:write')).toBe(false);
      expect(hasPermission('viewer', 'notes:read')).toBe(true);
      expect(hasPermission('viewer', 'notes:write')).toBe(false);
    });
  });

  describe('8. Immutable Audit Log Security (C1)', () => {
    it('verifies audit logs for tasks and notes are written to the append-only table', async () => {
      const taskAudit = await prisma.auditLog.findFirst({
        where: { entityType: 'task', action: 'TASK_CREATED' },
      });
      expect(taskAudit).toBeDefined();

      const noteAudit = await prisma.auditLog.findFirst({
        where: { entityType: 'note', action: 'NOTE_CREATED' },
      });
      expect(noteAudit).toBeDefined();
    });

    it('verifies audit logs cannot be modified via app database connection (C1)', async () => {
      const anyAudit = await prisma.auditLog.findFirst();
      expect(anyAudit).toBeDefined();

      if (anyAudit) {
        // Attempting to update or delete audit logs must fail or throw
        await expect(
          prisma.auditLog.update({
            where: { id: anyAudit.id },
            data: { action: 'TAMPERED_ACTION' },
          })
        ).rejects.toThrow();
      }
    });
  });
});
