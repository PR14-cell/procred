import { ApiError } from '@/lib/errors/api-error';
import { redis } from '@/lib/queue/redis';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const localRateLimitMap = new Map<string, RateLimitRecord>();

// Clean up expired records every 5 minutes
setInterval(() => {
  const now = Date.now();
  localRateLimitMap.forEach((record, key) => {
    if (record.resetAt <= now) {
      localRateLimitMap.delete(key);
    }
  });
}, 5 * 60 * 1000).unref();

export interface RateLimitOptions {
  keyPrefix: string;
  identifier: string;
  maxAttempts: number;
  windowSeconds: number;
  errorMessage?: string;
}

/**
 * Extracts client IP from request.
 * Takes client IP from x-forwarded-for ONLY when TRUST_PROXY === 'true'.
 * Defaults to 127.0.0.1 otherwise.
 */
export function getClientIp(req: Request): string {
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = req.headers.get('x-forwarded-for');
    if (forwarded) {
      const firstIp = forwarded.split(',')[0]?.trim();
      if (firstIp) return firstIp;
    }
    const realIp = req.headers.get('x-real-ip');
    if (realIp) return realIp.trim();
  }
  return '127.0.0.1';
}

/**
 * Enforces rate limiting on sensitive authentication and security endpoints.
 * Backed by Redis (INCR + EXPIRE) with local in-memory fallback.
 * Throws ApiError.tooManyRequests (HTTP 429) if threshold is exceeded.
 */
export async function assertRateLimit(options: RateLimitOptions): Promise<void> {
  const { keyPrefix, identifier, maxAttempts, windowSeconds, errorMessage } = options;
  const redisKey = `ratelimit:${keyPrefix}:${identifier}`;

  try {
    const currentCount = await redis.incr(redisKey);
    if (currentCount === 1) {
      await redis.expire(redisKey, windowSeconds);
    }

    if (currentCount > maxAttempts) {
      const ttl = await redis.ttl(redisKey);
      const retryAfter = ttl > 0 ? ttl : windowSeconds;
      throw ApiError.tooManyRequests(
        errorMessage ||
          `Too many failed attempts. Please wait ${retryAfter} seconds before trying again.`
      );
    }
    return;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Fall back to in-memory rate limiting if Redis is unavailable
  }

  const now = Date.now();
  let record = localRateLimitMap.get(redisKey);

  if (!record || record.resetAt <= now) {
    record = {
      count: 1,
      resetAt: now + windowSeconds * 1000,
    };
    localRateLimitMap.set(redisKey, record);
    return;
  }

  record.count += 1;

  if (record.count > maxAttempts) {
    const retryAfter = Math.ceil((record.resetAt - now) / 1000);
    throw ApiError.tooManyRequests(
      errorMessage ||
        `Too many failed attempts. Please wait ${retryAfter} seconds before trying again.`
    );
  }
}

/**
 * Resets the rate limit counter upon successful verification.
 */
export async function resetRateLimit(keyPrefix: string, identifier: string): Promise<void> {
  const redisKey = `ratelimit:${keyPrefix}:${identifier}`;
  try {
    await redis.del(redisKey);
  } catch {
    // Ignore Redis errors on reset
  }
  localRateLimitMap.delete(redisKey);
}
