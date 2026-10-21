import { NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { scanUpcomingExpirationsAndCreateTasks } from '@/lib/credentials/credential-service';

export const dynamic = 'force-dynamic';

// POST /api/v1/credentials/scan-expirations - Trigger expiration check & task creation
export const POST = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req, 'credentials:write');

  const scanResult = await scanUpcomingExpirationsAndCreateTasks();

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'EXPIRATION_SCAN_EXECUTED',
    entityType: 'credential_expiration_rules',
    changes: scanResult,
  });

  return NextResponse.json({
    message: 'Expiration scan completed successfully',
    ...scanResult,
  });
});
