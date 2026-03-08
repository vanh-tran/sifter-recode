/**
 * Availability computation: merge busy intervals, compute free slots.
 * Handles timezone intersection between user's selected date and host's business hours.
 */

export interface Interval {
  start: string;
  end: string;
}

export interface Slot {
  start: string;
  end: string;
}

/** Get UTC offset in hours for a timezone at a given date (noon UTC). Falls back to UTC if timezone is invalid. */
function getTimezoneOffsetHours(dateStr: string, tz: string): number {
  try {
    const d = new Date(`${dateStr}T12:00:00.000Z`);
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(d);
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    const localMinutesFromNoon = hour * 60 + minute - 12 * 60;
    return localMinutesFromNoon / 60;
  } catch {
    return 0; // Fall back to UTC for invalid timezone
  }
}

/** Start of dateStr (YYYY-MM-DD) in timezone tz, as UTC Date. */
export function getStartOfDayInTimezone(dateStr: string, tz: string): Date {
  const midnightUtc = new Date(`${dateStr}T00:00:00.000Z`).getTime();
  const offsetHours = getTimezoneOffsetHours(dateStr, tz);
  return new Date(midnightUtc - offsetHours * 60 * 60 * 1000);
}

/** End of dateStr (YYYY-MM-DD) in timezone tz, as UTC Date (exclusive: start of next day). */
export function getEndOfDayInTimezone(dateStr: string, tz: string): Date {
  const start = getStartOfDayInTimezone(dateStr, tz);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

/** Get host's work window (start, end) in UTC for a given date in host timezone. */
function getHostWorkWindowUtc(
  dateStr: string,
  hostTz: string,
  startHour: number,
  endHour: number
): { start: Date; end: Date } {
  const dayStart = getStartOfDayInTimezone(dateStr, hostTz);
  const start = new Date(dayStart.getTime() + startHour * 60 * 60 * 1000);
  const end = new Date(dayStart.getTime() + endHour * 60 * 60 * 1000);
  return { start, end };
}

/** Merge overlapping intervals (union). O(n log n). */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];

  const sorted = [...intervals].sort((a, b) => a.start.localeCompare(b.start));
  const merged: Interval[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i];
    const last = merged[merged.length - 1];
    if (curr.start <= last.end) {
      last.end = curr.end > last.end ? curr.end : last.end;
    } else {
      merged.push({ ...curr });
    }
  }
  return merged;
}

/** Compute free slots within work window, excluding busy intervals. */
export function computeFreeSlots(
  busyIntervals: Interval[],
  workStart: Date,
  workEnd: Date,
  slotDurationMinutes: number,
  bufferMinutes: number
): Slot[] {
  const merged = mergeIntervals(busyIntervals);
  const slotMs = slotDurationMinutes * 60 * 1000;
  const bufferMs = bufferMinutes * 60 * 1000;
  const now = Date.now();

  const slots: Slot[] = [];
  let cursor = workStart.getTime();

  while (cursor + slotMs <= workEnd.getTime()) {
    const slotStart = new Date(cursor);
    const slotEnd = new Date(cursor + slotMs);

    const isBlocked = merged.some((b) => {
      const bStart = new Date(b.start).getTime();
      const bEnd = new Date(b.end).getTime();
      return slotStart.getTime() < bEnd && slotEnd.getTime() > bStart;
    });

    if (!isBlocked && slotStart.getTime() >= now + bufferMs) {
      slots.push({
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
      });
    }

    cursor += slotMs;
  }

  return slots;
}

export interface AvailabilityParams {
  dateStr: string;
  userTz: string;
  hostTz: string;
  startHour: number;
  endHour: number;
  slotDurationMinutes: number;
  bufferMinutes: number;
}

/**
 * Compute the UTC query window: intersection of user's selected day (in user TZ)
 * with host's business hours (in host TZ). Returns { timeMin, timeMax } for freebusy.
 */
export function getAvailabilityQueryWindow(params: AvailabilityParams): {
  timeMin: Date;
  timeMax: Date;
  workWindows: { start: Date; end: Date }[];
} {
  const { dateStr, userTz, hostTz, startHour, endHour } = params;

  const userDayStart = getStartOfDayInTimezone(dateStr, userTz);
  const userDayEnd = getEndOfDayInTimezone(dateStr, userTz);

  const workWindows: { start: Date; end: Date }[] = [];
  const oneDay = 24 * 60 * 60 * 1000;

  for (let offset = -1; offset <= 1; offset++) {
    const d = new Date(userDayStart.getTime() + offset * oneDay);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const hostDateStr = `${y}-${m}-${day}`;
    const { start, end } = getHostWorkWindowUtc(hostDateStr, hostTz, startHour, endHour);

    if (end.getTime() > userDayStart.getTime() && start.getTime() < userDayEnd.getTime()) {
      workWindows.push({
        start: new Date(Math.max(start.getTime(), userDayStart.getTime())),
        end: new Date(Math.min(end.getTime(), userDayEnd.getTime())),
      });
    }
  }

  if (workWindows.length === 0) {
    return {
      timeMin: userDayStart,
      timeMax: userDayStart,
      workWindows: [],
    };
  }

  const timeMin = new Date(Math.min(...workWindows.map((w) => w.start.getTime())));
  const timeMax = new Date(Math.max(...workWindows.map((w) => w.end.getTime())));

  return { timeMin, timeMax, workWindows };
}

/**
 * Compute free slots for the given params, using merged busy intervals.
 * Work windows are the intersection of user's day and host's business hours.
 */
export function computeAvailabilitySlots(
  busyIntervals: Interval[],
  params: AvailabilityParams
): Slot[] {
  const { workWindows } = getAvailabilityQueryWindow(params);
  const allSlots: Slot[] = [];

  for (const win of workWindows) {
    const slots = computeFreeSlots(
      busyIntervals,
      win.start,
      win.end,
      params.slotDurationMinutes,
      params.bufferMinutes
    );
    allSlots.push(...slots);
  }

  return allSlots.sort((a, b) => a.start.localeCompare(b.start));
}
