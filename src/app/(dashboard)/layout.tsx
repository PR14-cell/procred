import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/server-auth';
import DashboardShell from './dashboard-shell';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieHeader = (await cookies())
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join('; ');
  let session;

  try {
    session = await requireAuth(
      new Request('http://localhost/api/v1/auth/me', {
        headers: { cookie: cookieHeader },
      })
    );
  } catch {
    redirect('/login?expired=true');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
    },
  });

  if (!user) redirect('/login?expired=true');

  return <DashboardShell user={user}>{children}</DashboardShell>;
}