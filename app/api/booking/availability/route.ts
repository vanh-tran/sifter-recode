/**
 * GET /api/booking/availability
 * ?date=YYYY-MM-DD&tz=America/Los_Angeles&duration=30
 *
 * Fetches busy blocks from all connected calendars, merges them, returns free slots.
 * In development, writes raw calendar data to /temp for verification.
 */

import { createClient } from "@supabase/supabase-js";
import {
  checkRateLimit,
  getRateLimitKey,
} from "@/lib/booking/rate-limit";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  getAccessToken,
  getFreeBusy,
  type BusyInterval,
} from "@/lib/booking/google-calendar";
import {
  getAvailabilityQueryWindow,
  computeAvailabilitySlots,
  mergeIntervals,
  type Interval,
} from "@/lib/booking/availability";

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
  "Pacific/Honolulu",
  "America/Puerto_Rico",
  "Pacific/Guam",
  "Pacific/Saipan",
  "Pacific/Pago_Pago",
  "UTC",
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
    console.error("[booking/availability] Failed to write temp dump");
  }
}

export async function GET(request: NextRequest) {
  const key = getRateLimitKey(request, "availability");
  if (!checkRateLimit(key, 20, 60 * 1000)) {
    return NextResponse.json(
      { error: "Too many requests" },
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

  const now = new Date();
  const todayInTz = now.toLocaleDateString("en-CA", { timeZone: tz });
  const [ty, tm, td] = todayInTz.split("-").map(Number);
  const maxDate = new Date(ty, tm - 1, td);
  maxDate.setDate(maxDate.getDate() + MAX_DAYS_AHEAD);
  const maxDateStr = `${maxDate.getFullYear()}-${String(maxDate.getMonth() + 1).padStart(2, "0")}-${String(maxDate.getDate()).padStart(2, "0")}`;

  if (dateParam < todayInTz) {
    return NextResponse.json(
      { error: "Date must be today or in the future." },
      { status: 400 }
    );
  }
  if (dateParam > maxDateStr) {
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

  const rawBusyByEmail: Record<string, BusyInterval[]> = {};
  const allBusy: Interval[] = [];

  const results = await Promise.allSettled(
    tokens.map(async (row) => {
      const accessToken = await getAccessToken(row.refresh_token);
      const busy = await getFreeBusy(accessToken, timeMin, timeMax);
      return { email: row.email ?? row.id, busy };
    })
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      rawBusyByEmail[r.value.email] = r.value.busy;
      for (const b of r.value.busy) allBusy.push(b);
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
