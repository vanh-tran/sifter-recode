/**
 * POST /api/booking/events
 * Body: { start, end, attendeeName, attendeeEmail, notes? }
 *
 * Creates a calendar event on the primary token's calendar.
 *
 * TODO: Add rate limiting (e.g. 3 req/min per IP) to prevent spam.
 * TODO: Optionally re-validate slot is still free before creating to reduce double-booking.
 */

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  getAccessToken,
  createCalendarEvent,
} from "@/lib/booking/google-calendar";

const MAX_DAYS_AHEAD = 90;
const MAX_NAME_LENGTH = 200;
const MAX_NOTES_LENGTH = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
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

  const now = Date.now();
  const maxStart = now + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000;
  if (startDate.getTime() < now - 60 * 60 * 1000) {
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
    console.error("[booking/events] Create failed:", err);
    return NextResponse.json(
      { error: "Failed to create event" },
      { status: 500 }
    );
  }
}
