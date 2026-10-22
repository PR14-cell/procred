import { z } from 'zod';

export const createNoteSchema = z.object({
  entityType: z.string().min(1, 'Entity type is required').max(50),
  entityId: z.string().uuid('Invalid entity ID'),
  providerId: z.string().uuid('Invalid provider ID').optional().nullable(),
  content: z.string().min(1, 'Note content cannot be empty').max(10000, 'Note content exceeds maximum length'),
  isPinned: z.boolean().optional().default(false),
});

export type CreateNoteInput = z.input<typeof createNoteSchema>;

export const updateNoteSchema = z.object({
  content: z.string().min(1, 'Note content cannot be empty').max(10000).optional(),
  isPinned: z.boolean().optional(),
});

export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
