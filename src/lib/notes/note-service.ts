import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/errors/api-error';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { CreateNoteInput, UpdateNoteInput } from '@/lib/validation/note';

export interface NoteActor {
  id: string;
  email: string;
}

export class NoteService {
  /**
   * Retrieves notes for a given entity or provider.
   */
  static async getNotes(params: {
    entityType?: string;
    entityId?: string;
    providerId?: string;
  }) {
    const where: any = {};

    if (params.entityType && params.entityId) {
      where.entityType = params.entityType;
      where.entityId = params.entityId;
    } else if (params.providerId) {
      where.OR = [
        { providerId: params.providerId },
        { entityType: 'provider', entityId: params.providerId },
      ];
    }

    const notes = await prisma.note.findMany({
      where,
      orderBy: [
        { isPinned: 'desc' },
        { createdAt: 'desc' },
      ],
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        updatedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    return notes;
  }

  /**
   * Get single note by ID.
   */
  static async getNoteById(id: string) {
    const note = await prisma.note.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        updatedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (!note) {
      throw ApiError.notFound('Note not found');
    }

    return note;
  }

  /**
   * Create a new note.
   */
  static async createNote(data: CreateNoteInput, actor: NoteActor) {
    let providerId = data.providerId || null;

    if (!providerId && data.entityType === 'provider') {
      providerId = data.entityId;
    }

    const note = await prisma.note.create({
      data: {
        entityType: data.entityType,
        entityId: data.entityId,
        providerId,
        content: data.content,
        isPinned: data.isPinned || false,
        createdById: actor.id,
      },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    await logAuditEvent({
      userId: actor.id,
      userEmail: actor.email,
      action: 'NOTE_CREATED',
      entityType: 'note',
      entityId: note.id,
      changes: {
        targetEntityType: note.entityType,
        targetEntityId: note.entityId,
        providerId: note.providerId,
        isPinned: note.isPinned,
      },
    });

    return note;
  }

  /**
   * Update an existing note.
   */
  static async updateNote(id: string, data: UpdateNoteInput, actor: NoteActor) {
    const existing = await this.getNoteById(id);

    const updated = await prisma.note.update({
      where: { id },
      data: {
        content: data.content !== undefined ? data.content : existing.content,
        isPinned: data.isPinned !== undefined ? data.isPinned : existing.isPinned,
        updatedById: actor.id,
      },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        updatedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    const isPinAction = data.isPinned !== undefined && data.isPinned !== existing.isPinned;
    const action = isPinAction
      ? data.isPinned
        ? 'NOTE_PINNED'
        : 'NOTE_UNPINNED'
      : 'NOTE_UPDATED';

    await logAuditEvent({
      userId: actor.id,
      userEmail: actor.email,
      action,
      entityType: 'note',
      entityId: id,
      changes: {
        contentUpdated: data.content !== undefined,
        isPinned: updated.isPinned,
      },
    });

    return updated;
  }

  /**
   * Delete a note.
   */
  static async deleteNote(id: string, actor: NoteActor) {
    const existing = await this.getNoteById(id);

    await prisma.note.delete({
      where: { id },
    });

    await logAuditEvent({
      userId: actor.id,
      userEmail: actor.email,
      action: 'NOTE_DELETED',
      entityType: 'note',
      entityId: id,
      changes: {
        entityType: existing.entityType,
        entityId: existing.entityId,
        providerId: existing.providerId,
      },
    });

    return { success: true };
  }
}
