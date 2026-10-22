import { z } from 'zod';

export const TaskPriorityEnum = z.enum(['urgent', 'high', 'medium', 'low']);
export type TaskPriority = z.infer<typeof TaskPriorityEnum>;

export const TaskStatusEnum = z.enum([
  'pending',     // Open / To Do
  'in_progress', // Actively working
  'blocked',     // Waiting on info / external party
  'completed',   // Successfully done
  'cancelled',   // No longer needed
]);
export type TaskStatus = z.infer<typeof TaskStatusEnum>;

export const TaskTypeEnum = z.enum([
  'credential_renewal',
  'document_review',
  'enrollment_follow_up',
  'revalidation',
  'verification',
  'general',
]);
export type TaskType = z.infer<typeof TaskTypeEnum>;

// 1. Create Task Schema
export const createTaskSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(255),
  description: z.string().optional().nullable(),
  taskType: TaskTypeEnum.default('general'),
  priority: TaskPriorityEnum.default('medium'),
  status: TaskStatusEnum.default('pending'),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be YYYY-MM-DD')
    .optional()
    .nullable(),
  assignedToId: z.string().uuid('Invalid assigned user ID').optional().nullable(),
  providerId: z.string().uuid('Invalid provider ID').optional().nullable(),
  entityType: z.string().max(50).optional().nullable(),
  entityId: z.string().uuid('Invalid entity ID').optional().nullable(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

// 2. Update Task Details Schema
export const updateTaskSchema = z.object({
  title: z.string().min(3).max(255).optional(),
  description: z.string().optional().nullable(),
  taskType: TaskTypeEnum.optional(),
  priority: TaskPriorityEnum.optional(),
  status: TaskStatusEnum.optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  assignedToId: z.string().uuid().optional().nullable(),
  providerId: z.string().uuid().optional().nullable(),
  completionNotes: z.string().optional().nullable(),
});

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

// 3. Complete Task Schema
export const completeTaskSchema = z.object({
  completionNotes: z.string().optional().nullable(),
});

export type CompleteTaskInput = z.infer<typeof completeTaskSchema>;

// 4. Assign Task Schema
export const assignTaskSchema = z.object({
  assignedToId: z.string().uuid('A valid assigned user ID is required'),
});

export type AssignTaskInput = z.infer<typeof assignTaskSchema>;
