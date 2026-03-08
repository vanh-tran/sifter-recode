/**
 * GET /api/booking/availability
 * ?date=YYYY-MM-DD&tz=America/Los_Angeles&duration=30
 *
 * Fetches busy blocks from all connected calendars, merges them, returns free slots.
 * In development, writes raw calendar data to /temp for verification.
 */

import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  getAccessToken,
  getFreeBusy,
} from "@/lib/booking/google-calendar";
import {
  getAvailabilityQueryWindow,
  computeAvailabilitySlots,
  mergeIntervals,
  type Interval,
} from "@/lib/booking/availability";
import { checkRateLimit, getClientIp } from "@/lib/booking/rate-limit";

const MAX_DAYS_AHEAD = 90;
const DEFAULT_START_HOUR = parseInt(process.env.BOOKING_START_HOUR ?? "9", 10);
const DEFAULT_END_HOUR = parseInt(process.env.BOOKING_END_HOUR ?? "17", 10);
const DEFAULT_HOST_TZ = process.env.BOOKING_TIMEZONE ?? "America/Los_Angeles";
const BUFFER_MINUTES = 30;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_TZ = new Set([
  "America/Los_Angeles",
  "America/Denver",
  "America/Phoenix",
  "America/Chicago",
  "America/New_York",
  "America/Anchorage",
  "America/Puerto_Rico",
  "Pacific/Honolulu",
  "Pacific/Guam",
  "Pacific/Saipan",
  "Pacific/Pago_Pago",
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Australia/Sydney",
]);

async function writeTempDump(
  dateStr: string,
  data: {
    mergedBusy: Interval[];
    slots: { start: string; end: string }[];
    queryWindow: { timeMin: string; timeMax: string };
  }
): Promise<void> {
  try {
    const tempDir = join(process.cwd(), "temp");
    await mkdir(tempDir, { recursive: true });
    const filename = `booking-calendar-${dateStr}.json`;
    const filepath = join(tempDir, filename);
    await writeFile(filepath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("[booking/availability] Failed to write temp dump:", err);
  }
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const { allowed } = checkRateLimit(`availability:${ip}`, 20, 60 * 1000);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  const dateParam = request.nextUrl.searchParams.get("date");
  const tzParam = request.nextUrl.searchParams.get("tz");
  const durationParam = request.nextUrl.searchParams.get("duration");

  if (!dateParam || !DATE_RE.test(dateParam)) {
    return NextResponse.json(
      { error: "Invalid or missing date. Use YYYY-MM-DD." },
      { status: 400 }
    );
  }

  const tz = tzParam && VALID_TZ.has(tzParam) ? tzParam : "America/Los_Angeles";
  const duration = Math.min(
    60,
    Math.max(15, parseInt(durationParam ?? "30", 10) || 30)
  );

  const date = new Date(`${dateParam}T12:00:00.000Z`);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const maxDate = new Date(todayStart);
  maxDate.setDate(maxDate.getDate() + MAX_DAYS_AHEAD);

  if (date.getTime() < todayStart.getTime()) {
    return NextResponse.json(
      { error: "Date must be today or in the future." },
      { status: 400 }
    );
  }
  if (date.getTime() > maxDate.getTime()) {
    return NextResponse.json(
      { error: `Date must be within the next ${MAX_DAYS_AHEAD} days.` },
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
  const { data: tokens, error: tokensError } = await supabase
    .from("booking_oauth_tokens")
    .select("id, refresh_token, email");

  if (tokensError || !tokens?.length) {
    return NextResponse.json(
      { error: "No calendar tokens configured" },
      { status: 503 }
    );
  }

  const { timeMin, timeMax, workWindows } = getAvailabilityQueryWindow({
    dateStr: dateParam,
    userTz: tz,
    hostTz: DEFAULT_HOST_TZ,
    startHour: DEFAULT_START_HOUR,
    endHour: DEFAULT_END_HOUR,
    slotDurationMinutes: duration,
    bufferMinutes: BUFFER_MINUTES,
  });

  if (workWindows.length === 0) {
    return NextResponse.json({ slots: [] });
  }

  const allBusy: Interval[] = [];

  const results = await Promise.allSettled(
    tokens.map(async (row) => {
      const accessToken = await getAccessToken(row.refresh_token);
      const busy = await getFreeBusy(accessToken, timeMin, timeMax);
      return busy;
    })
  );

  for (const r of results) {
    if (r.status === "fulfilled") {
      for (const b of r.value) allBusy.push(b);
    } else {
      console.error("[booking/availability] Token fetch failed");
    }
  }

  const slots = computeAvailabilitySlots(allBusy, {
    dateStr: dateParam,
    userTz: tz,
    hostTz: DEFAULT_HOST_TZ,
    startHour: DEFAULT_START_HOUR,
    endHour: DEFAULT_END_HOUR,
    slotDurationMinutes: duration,
    bufferMinutes: BUFFER_MINUTES,
  });

  if (process.env.NODE_ENV === "development") {
    await writeTempDump(dateParam, {
      mergedBusy: mergeIntervals(allBusy),
      slots: slots.map((s) => ({ start: s.start, end: s.end })),
      queryWindow: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
      },
    });
  }

  return NextResponse.json({ slots });
}
