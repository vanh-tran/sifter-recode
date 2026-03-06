const ALLOWED_BOOKING_HOSTS = [
  "calendly.com",
  "cal.com",
  "hubspot.com",
  "acuityscheduling.com",
  "sifterusa.com", // Allow your own domain for self-hosted booking
];

/**
 * Validates a booking URL for safe use in href attributes.
 * Blocks javascript:, data:, and other dangerous schemes.
 * Restricts to known scheduling domains.
 */
export function isValidBookingUrl(url: string | undefined): url is string {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  try {
    const parsed = new URL(trimmed);
    // Allowlist: only https (and http for localhost in dev)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    if (parsed.protocol === "http:" && parsed.hostname !== "localhost") return false;

    // Restrict to known hosts
    const hostLower = parsed.hostname.toLowerCase();
    const isAllowed = ALLOWED_BOOKING_HOSTS.some(
      (h) => hostLower === h || hostLower.endsWith(`.${h}`)
    );
    if (!isAllowed) return false;

    return true;
  } catch {
    return false;
  }
}
