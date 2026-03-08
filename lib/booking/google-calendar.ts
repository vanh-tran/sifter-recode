/**
 * Google Calendar API helpers — server-side only.
 * Uses raw fetch (consistent with OAuth callback). Never expose tokens to client.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy";
const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/** Exchange refresh token for access token. */
export async function getAccessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials not configured");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    console.error("[booking/google-calendar] Token refresh failed");
    throw new Error("Token refresh failed");
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("No access token in response");
  }
  return data.access_token;
}

export interface BusyInterval {
  start: string;
  end: string;
}

/** Fetch busy blocks from primary calendar. Returns UTC ISO strings. */
export async function getFreeBusy(
  accessToken: string,
  timeMin: Date,
  timeMax: Date
): Promise<BusyInterval[]> {
  const res = await fetch(FREEBUSY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: "primary" }],
    }),
  });

  if (!res.ok) {
    console.error("[booking/google-calendar] Freebusy failed");
    throw new Error("Freebusy request failed");
  }

  const data = (await res.json()) as {
    calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
  };

  const busy: BusyInterval[] = [];
  for (const cal of Object.values(data.calendars ?? {})) {
    for (const b of cal.busy ?? []) {
      busy.push({ start: b.start, end: b.end });
    }
  }
  return busy;
}

export interface CreateEventOptions {
  start: Date;
  end: Date;
  attendeeEmail: string;
  attendeeName: string;
  summary: string;
  notes?: string;
}

export interface CreateEventResult {
  eventId: string;
  meetLink?: string;
}

/** Strip control chars and limit length for calendar fields. */
function sanitizeForCalendar(str: string, maxLen = 200): string {
  return str
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .slice(0, maxLen)
    .trim();
}

/** Create event on primary calendar with optional Google Meet. */
export async function createCalendarEvent(
  accessToken: string,
  opts: CreateEventOptions
): Promise<CreateEventResult> {
  const body: Record<string, unknown> = {
    summary: sanitizeForCalendar(opts.summary, 200),
    description: opts.notes ? sanitizeForCalendar(opts.notes, 2000) : undefined,
    start: { dateTime: opts.start.toISOString(), timeZone: "UTC" },
    end: { dateTime: opts.end.toISOString(), timeZone: "UTC" },
    attendees: [
      {
        email: opts.attendeeEmail,
        displayName: sanitizeForCalendar(opts.attendeeName, 200),
      },
    ],
    conferenceData: {
      createRequest: {
        requestId: `sifter-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };

  const res = await fetch(`${EVENTS_URL}?conferenceDataVersion=1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error("[booking/google-calendar] Create event failed");
    throw new Error("Create event failed");
  }

  const event = (await res.json()) as {
    id?: string;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: { uri?: string }[] };
  };

  const meetLink =
    event.hangoutLink ??
    event.conferenceData?.entryPoints?.[0]?.uri;

  return {
    eventId: event.id ?? "",
    meetLink,
  };
}
