import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { checkRedisHealth } from '@/lib/queue/redis';
import { s3Client } from '@/lib/storage/s3';
import { ListBucketsCommand } from '@aws-sdk/client-s3';

export const dynamic = 'force-dynamic';

export async function GET() {
  const statusDetails: Record<string, 'ok' | 'error'> = {
    postgres: 'error',
    redis: 'error',
    minio: 'error',
  };

  // 1. Check PostgreSQL
  try {
    await prisma.$queryRaw`SELECT 1`;
    statusDetails.postgres = 'ok';
  } catch (err) {
    console.error('[HealthCheck] PostgreSQL check failed:', err);
  }

  // 2. Check Redis (with requirepass auth, C2)
  try {
    const isRedisOk = await checkRedisHealth();
    if (isRedisOk) {
      statusDetails.redis = 'ok';
    }
  } catch (err) {
    console.error('[HealthCheck] Redis check failed:', err);
  }

  // 3. Check MinIO / S3
  try {
    await s3Client.send(new ListBucketsCommand({}));
    statusDetails.minio = 'ok';
  } catch (err) {
    console.error('[HealthCheck] MinIO check failed:', err);
  }

  const isHealthy = Object.values(statusDetails).every((val) => val === 'ok');

  return NextResponse.json(
    {
      status: isHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: statusDetails,
    },
    { status: isHealthy ? 200 : 503 }
  );
}
