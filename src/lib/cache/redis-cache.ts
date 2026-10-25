import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://:redis_secure_pass_123@localhost:6379';

let redisClient: Redis | null = null;
let isConnected = false;

function getRedisClient(): Redis | null {
  if (process.env.NODE_ENV === 'test') {
    // In test environment, provide in-memory map or connect gracefully
  }

  if (redisClient) {
    return redisClient;
  }

  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 100, 2000)),
      lazyConnect: true,
    });

    redisClient.on('connect', () => {
      isConnected = true;
    });

    redisClient.on('error', (err) => {
      isConnected = false;
    });

    // Initiate connection without blocking
    redisClient.connect().catch(() => {
      isConnected = false;
    });

    return redisClient;
  } catch (err) {
    redisClient = null;
    return null;
  }
}

// In-memory fallback cache for test environments or Redis outage
const memoryFallback = new Map<string, { value: string; expiresAt: number }>();

export class CacheService {
  /**
   * Retrieves item from cache.
   */
  static async get<T>(key: string): Promise<T | null> {
    try {
      const client = getRedisClient();
      if (client && isConnected) {
        const raw = await client.get(key);
        if (raw) {
          return JSON.parse(raw) as T;
        }
      }
    } catch {
      // Fallback
    }

    const fallback = memoryFallback.get(key);
    if (fallback) {
      if (Date.now() > fallback.expiresAt) {
        memoryFallback.delete(key);
        return null;
      }
      return JSON.parse(fallback.value) as T;
    }

    return null;
  }

  /**
   * Sets item in cache with TTL in seconds.
   */
  static async set(key: string, value: any, ttlSeconds = 300): Promise<void> {
    const serialized = JSON.stringify(value);

    try {
      const client = getRedisClient();
      if (client && isConnected) {
        await client.set(key, serialized, 'EX', ttlSeconds);
        return;
      }
    } catch {
      // Fallback
    }

    memoryFallback.set(key, {
      value: serialized,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  /**
   * Deletes a key from cache.
   */
  static async del(key: string): Promise<void> {
    try {
      const client = getRedisClient();
      if (client && isConnected) {
        await client.del(key);
      }
    } catch {
      // Fallback
    }
    memoryFallback.delete(key);
  }

  /**
   * Retrieves cached value or executes fetcher and caches the result.
   */
  static async getOrSet<T>(key: string, fetcher: () => Promise<T>, ttlSeconds = 300): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }

    const fresh = await fetcher();
    await this.set(key, fresh, ttlSeconds).catch(() => {});
    return fresh;
  }

  /**
   * Clears the in-memory cache (primarily for tests).
   */
  static clearMemoryCache(): void {
    memoryFallback.clear();
  }
}
