/**
 * In-memory sliding-window rate limiter.
 *
 * Note: Each serverless instance has its own memory, so this is per-instance.
 * It provides meaningful protection against bursts from a single IP hitting the
 * same instance, and is safe to use without external infrastructure.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: maxRequests - entry.count };
}

export function getClientIp(request: Request): string {
  const forwarded = (request.headers as Headers).get("x-forwarded-for");
  return (
    forwarded?.split(",")[0]?.trim() ??
    (request.headers as Headers).get("x-real-ip") ??
    "unknown"
  );
}
