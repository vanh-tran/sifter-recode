/**
 * POST /api/booking/events
 * Body: { start, end, attendeeName, attendeeEmail, notes? }
 *
 * Creates a calendar event on the primary token's calendar.
 */

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  getAccessToken,
  getFreeBusy,
  createCalendarEvent,
} from "@/lib/booking/google-calendar";
import {
  checkRateLimit,
  getRateLimitKey,
} from "@/lib/booking/rate-limit";
import { getStartOfDayInTimezone } from "@/lib/booking/availability";

const VALID_TZ = new Set([
  "America/Los_Angeles",
  "America/Denver",
  "America/Phoenix",
  "America/Chicago",
  "America/New_York",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Puerto_Rico",
  "Pacific/Guam",
  "Pacific/Saipan",
  "Pacific/Pago_Pago",
  "UTC",
]);

const MAX_DAYS_AHEAD = 90;
const MAX_NAME_LENGTH = 200;
const MAX_NOTES_LENGTH = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const key = getRateLimitKey(request, "events");
  if (!checkRateLimit(key, 3, 60 * 1000)) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const b = body as Record<string, unknown>;
  const start = typeof b.start === "string" ? b.start : "";
  const end = typeof b.end === "string" ? b.end : "";
  const attendeeName = typeof b.attendeeName === "string" ? b.attendeeName.trim() : "";
  const attendeeEmail = typeof b.attendeeEmail === "string" ? b.attendeeEmail.trim() : "";
  const notes = typeof b.notes === "string" ? b.notes.trim().slice(0, MAX_NOTES_LENGTH) : undefined;
  const tzParam = typeof b.tz === "string" && VALID_TZ.has(b.tz) ? b.tz : "America/Los_Angeles";

  if (!start || !end || !attendeeName || !attendeeEmail) {
    return NextResponse.json(
      { error: "Missing required fields: start, end, attendeeName, attendeeEmail" },
      { status: 400 }
    );
  }

  if (attendeeName.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { error: "attendeeName too long" },
      { status: 400 }
    );
  }

  if (!EMAIL_RE.test(attendeeEmail)) {
    return NextResponse.json(
      { error: "Invalid email format" },
      { status: 400 }
    );
  }

  const startDate = new Date(start);
  const endDate = new Date(end);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return NextResponse.json(
      { error: "Invalid start or end date" },
      { status: 400 }
    );
  }

  if (endDate.getTime() <= startDate.getTime()) {
    return NextResponse.json(
      { error: "end must be after start" },
      { status: 400 }
    );
  }

  const now = new Date();
  const todayInTz = now.toLocaleDateString("en-CA", { timeZone: tzParam });
  const minStart = getStartOfDayInTimezone(todayInTz, tzParam);
  const minStartMs = minStart.getTime() - 60 * 60 * 1000; // 1h buffer for form filling
  const maxStart = now.getTime() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000;

  if (startDate.getTime() < minStartMs) {
    return NextResponse.json(
      { error: "Cannot book in the past" },
      { status: 400 }
    );
  }
  if (startDate.getTime() > maxStart) {
    return NextResponse.json(
      { error: `Cannot book more than ${MAX_DAYS_AHEAD} days ahead` },
      { status: 400 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: primaryRow, error: fetchError } = await supabase
    .from("booking_oauth_tokens")
    .select("refresh_token")
    .eq("is_primary", true)
    .limit(1)
    .single();

  if (fetchError || !primaryRow?.refresh_token) {
    return NextResponse.json(
      { error: "No primary calendar configured" },
      { status: 503 }
    );
  }

  try {
    const accessToken = await getAccessToken(primaryRow.refresh_token);

    // Re-validate slot is still free before creating to reduce double-booking risk
    const busy = await getFreeBusy(accessToken, startDate, endDate);
    if (busy.length > 0) {
      return NextResponse.json(
        { error: "Slot is no longer available" },
        { status: 409 }
      );
    }

    const result = await createCalendarEvent(accessToken, {
      start: startDate,
      end: endDate,
      attendeeEmail,
      attendeeName,
      summary: "Meeting with Sifter team",
      notes,
    });
    return NextResponse.json({
      success: true,
      eventId: result.eventId,
      meetLink: result.meetLink,
    });
  } catch (err) {
    console.error("[booking/events] Create failed");
    return NextResponse.json(
      { error: "Failed to create event" },
      { status: 500 }
    );
  }
}
