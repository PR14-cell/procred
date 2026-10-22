import { NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { NoteService } from '@/lib/notes/note-service';
import { updateNoteSchema } from '@/lib/validation/note';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// GET /api/v1/notes/[id] - Get single note
export const GET = withErrorHandler(async (req: Request, context?: RouteContext) => {
  await requireAuth(req, 'notes:read');
  const noteId = context!.params.id;

  const note = await NoteService.getNoteById(noteId);

  return NextResponse.json({ note });
});

// PUT /api/v1/notes/[id] - Update note content or toggle pin
export const PUT = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'notes:write');
  const noteId = context!.params.id;
  const body = await req.json();

  const validated = updateNoteSchema.parse(body);

  const updatedNote = await NoteService.updateNote(noteId, validated, {
    id: session.userId,
    email: session.email,
  });

  return NextResponse.json({
    message: 'Note updated successfully',
    note: updatedNote,
  });
});

// DELETE /api/v1/notes/[id] - Delete a note
export const DELETE = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'notes:write');
  const noteId = context!.params.id;

  await NoteService.deleteNote(noteId, {
    id: session.userId,
    email: session.email,
  });

  return NextResponse.json({
    message: 'Note deleted successfully',
  });
});
