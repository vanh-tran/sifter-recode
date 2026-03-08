/**
 * In-memory rate limiter for booking API routes.
 * For production on Vercel serverless, consider Upstash Redis for cross-instance limits.
 */

const store = new Map<string, { count: number; resetAt: number }>();

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  return forwarded?.split(",")[0]?.trim() ?? realIp ?? "unknown";
}

/**
 * Check if request is within rate limit. Returns true if allowed, false if exceeded.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= limit) {
    return false;
  }

  entry.count += 1;
  return true;
}

/**
 * Rate limit key for a request (IP-based).
 */
export function getRateLimitKey(request: Request, prefix: string): string {
  const ip = getClientIp(request);
  return `${prefix}:${ip}`;
}
