import { NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { NoteService } from '@/lib/notes/note-service';
import { createNoteSchema } from '@/lib/validation/note';

export const dynamic = 'force-dynamic';

// GET /api/v1/notes - List notes by entityType & entityId or providerId
export const GET = withErrorHandler(async (req: Request) => {
  await requireAuth(req, 'notes:read');

  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get('entityType') || undefined;
  const entityId = searchParams.get('entityId') || undefined;
  const providerId = searchParams.get('providerId') || undefined;

  const notes = await NoteService.getNotes({
    entityType,
    entityId,
    providerId,
  });

  return NextResponse.json({ notes });
});

// POST /api/v1/notes - Create a new operational note
export const POST = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req, 'notes:write');
  const body = await req.json();

  const validated = createNoteSchema.parse(body);

  const note = await NoteService.createNote(validated, {
    id: session.userId,
    email: session.email,
  });

  return NextResponse.json(
    {
      message: 'Note created successfully',
      note,
    },
    { status: 201 }
  );
});
