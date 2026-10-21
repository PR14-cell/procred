import type { Metadata } from 'next';
import './globals.css';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export const metadata: Metadata = {
  title: 'Provider Credentialing & Payer Enrollment',
  description: 'Enterprise healthcare provider credentialing and payer enrollment platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-slate-50">
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  );
}
