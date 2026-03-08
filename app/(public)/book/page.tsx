"use client";

/**
 * Cal.com-like booking page.
 * Fetches real availability from connected Google Calendars.
 */

import Link from "next/link";
import { useState, useEffect, useCallback, type CSSProperties, type FormEvent } from "react";
import LandingHeader from "@/app/components/landing-page/LandingHeader";
import {
  ChevronLeft,
  ChevronRight,
  Video,
  Clock,
  Globe,
  Check,
  UserPlus,
  Loader2,
} from "lucide-react";

const HOST_NAME = "Jesse";
const MEETING_TITLE = "Meeting with Sifter team";

const DURATIONS = [30] as const;

const TIMEZONES = [
  { value: "America/Los_Angeles", label: "Pacific Time (Los Angeles)" },
  { value: "America/Denver", label: "Mountain Time (Denver)" },
  { value: "America/Phoenix", label: "Mountain Time - Arizona (Phoenix)" },
  { value: "America/Chicago", label: "Central Time (Chicago)" },
  { value: "America/New_York", label: "Eastern Time (New York)" },
  { value: "America/Anchorage", label: "Alaska Time (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (Honolulu)" },
  { value: "America/Puerto_Rico", label: "Atlantic Time (Puerto Rico)" },
  { value: "Pacific/Guam", label: "Chamorro Time (Guam)" },
  { value: "Pacific/Saipan", label: "Chamorro Time (Saipan)" },
  { value: "Pacific/Pago_Pago", label: "Samoa Time (American Samoa)" },
  { value: "UTC", label: "UTC" },
]

interface Slot {
  start: string;
  end: string;
}

function formatSlotTime(isoStart: string, tz: string, use24h: boolean): string {
  return new Date(isoStart).toLocaleTimeString(use24h ? "en-GB" : "en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: !use24h,
  });
}

function getDaysInMonth(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const days: Date[] = [];
  const start = new Date(first);
  start.setDate(start.getDate() - first.getDay());
  const end = new Date(last);
  end.setDate(end.getDate() + (6 - last.getDay()));
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }
  return days;
}

function formatMonthYear(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatSelectedDate(date: Date, tz: string): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: tz,
  });
}

function getTimezoneLabel(tz: string): string {
  return TIMEZONES.find((t) => t.value === tz)?.label ?? tz;
}

/** Get today's date (YYYY-MM-DD) in the given timezone. */
function getTodayInTimezone(tz: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

export default function BookPage() {
  const [viewDate, setViewDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState<Date | null>(() => {
    const todayStr = getTodayInTimezone("America/Los_Angeles");
    const [y, m, d] = todayStr.split("-").map(Number);
    return new Date(y, m - 1, d);
  });
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [duration, setDuration] = useState(30);
  const [timezone, setTimezone] = useState("America/Los_Angeles");
  const [use24h, setUse24h] = useState(false);
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  // Staggered loading states for entrance animations (use inline styles for reliability)
  const [leftPanelVisible, setLeftPanelVisible] = useState(false);
  const [calendarReady, setCalendarReady] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setLeftPanelVisible(true), 80);
    const t2 = setTimeout(() => setCalendarReady(true), 400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  // Sync selectedDate to "today" in the selected timezone (so black highlight uses tz, not local)
  useEffect(() => {
    const todayStr = getTodayInTimezone(timezone);
    const [y, m, d] = todayStr.split("-").map(Number);
    setSelectedDate(new Date(y, m - 1, d));
  }, [timezone]);

  const showSlots = calendarReady && !!selectedDate && !selectedSlot;

  const days = getDaysInMonth(viewDate.getFullYear(), viewDate.getMonth());

  const toDateStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const fetchSlots = useCallback(async () => {
    if (!selectedDate) return;
    const dateStr = toDateStr(selectedDate);
    setSlotsLoading(true);
    setSlotsError(null);
    try {
      const res = await fetch(
        `/api/booking/availability?date=${encodeURIComponent(dateStr)}&tz=${encodeURIComponent(timezone)}&duration=${duration}`
      );
      const data = (await res.json()) as { slots?: Slot[]; error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to fetch availability");
      }
      setSlots(data.slots ?? []);
    } catch (err) {
      setSlotsError(err instanceof Error ? err.message : "Failed to fetch availability");
      setSlots([]);
    } finally {
      setSlotsLoading(false);
    }
  }, [selectedDate, timezone, duration]);

  useEffect(() => {
    if (selectedDate && !selectedSlot) {
      fetchSlots();
    } else {
      setSlots([]);
      setSlotsError(null);
    }
  }, [selectedDate, selectedSlot, fetchSlots]);

  const prevMonth = () => {
    setViewDate((d) => new Date(d.getFullYear(), d.getMonth() - 1));
  };

  const nextMonth = () => {
    setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + 1));
  };

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const todayInTz = getTodayInTimezone(timezone);
  const isToday = (d: Date) => toDateStr(d) === todayInTz;
  const isPastDate = (d: Date) => toDateStr(d) < todayInTz;
  const isSelected = (d: Date) => selectedDate && isSameDay(d, selectedDate);
  const isCurrentMonth = (d: Date) =>
    d.getMonth() === viewDate.getMonth();

  const handleSlotClick = (slot: Slot) => {
    setSelectedSlot(slot);
  };

  const handleBack = () => {
    setSelectedSlot(null);
    setFormName("");
    setFormEmail("");
    setFormNotes("");
    setStatus("idle");
    setSlotsError(null);
  };

  const handleFormSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedSlot) return;
    setStatus("loading");
    try {
      const res = await fetch("/api/booking/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: selectedSlot.start,
          end: selectedSlot.end,
          attendeeName: formName,
          attendeeEmail: formEmail,
          notes: formNotes || undefined,
          tz: timezone,
        }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to book");
      }
      setStatus("success");
      setFormName("");
      setFormEmail("");
      setFormNotes("");
      setSelectedSlot(null);
    } catch (err) {
      setStatus("error");
      setSlotsError(err instanceof Error ? err.message : "Booking failed");
    }
  };

  const isConfirmationView = !!selectedSlot;

  // Inline style objects for entrance animations
  const leftPanelStyle: CSSProperties = {
    opacity: leftPanelVisible ? 1 : 0,
    transform: leftPanelVisible ? "translateY(0)" : "translateY(24px)",
    transition: "opacity 0.5s ease-out, transform 0.5s ease-out",
  };

  const calendarStyle: CSSProperties = {
    opacity: calendarReady ? 1 : 0,
    transition: "opacity 0.4s ease-out",
  };

  const stageHeightClass = "lg:min-h-[520px]";

  const LEFT_W = 280;
  const CAL_W = 460;
  const SLOTS_W = 280;
  const ease = "cubic-bezier(0.25, 0.46, 0.45, 0.94)";

  const cardStyle: CSSProperties = {
    maxWidth: (isConfirmationView || !showSlots) ? LEFT_W + CAL_W : LEFT_W + CAL_W + SLOTS_W,
    transition: `max-width 0.5s ${ease}`,
  };

  const slotsWrapperStyle: CSSProperties = {
    width: showSlots ? SLOTS_W : 0,
    opacity: showSlots ? 1 : 0,
    transition: `width 0.5s ${ease}, opacity 0.35s ease-out`,
  };

  const slotsPanelStyle: CSSProperties = {
    transform: showSlots ? "translateX(0)" : "translateX(32px)",
    opacity: showSlots ? 1 : 0,
    transition: `transform 0.5s ${ease}, opacity 0.35s ease-out`,
  };

  if (status === "success") {
    return (
      <div className="landing-page min-h-screen flex flex-col">
        <LandingHeader />
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="max-w-md w-full text-center space-y-6">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-100 text-green-600">
              <Check className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-semibold text-[#171717]">Meeting scheduled!</h1>
            <p className="text-slate-600">
              Check your email for the calendar invite.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                type="button"
                onClick={() => setStatus("idle")}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 border border-slate-300 rounded-md hover:bg-slate-50"
              >
                Book another
              </button>
              <Link
                href="/"
                className="px-4 py-2 text-sm font-medium text-white bg-[#171717] hover:bg-slate-800 rounded-md"
              >
                Back to home
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="landing-page min-h-screen flex flex-col">
      <LandingHeader />
      {/* Centered card — keeps a stable shell height across all 3 stages */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6 py-16 overflow-y-auto min-h-0">
        <div
          className="w-full bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden"
          style={cardStyle}
        >
          {isConfirmationView ? (
            <div className={`flex flex-col lg:flex-row items-stretch ${stageHeightClass}`}>
              <div
                className="p-6 lg:py-8 lg:pl-6 lg:pr-6 border-b border-slate-200 lg:border-b-0 lg:border-r lg:border-r-slate-200 lg:w-[280px] shrink-0"
                style={leftPanelStyle}
              >
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-slate-200 flex items-center justify-center text-xl font-semibold text-slate-600">
                      {HOST_NAME[0]}
                    </div>
                    <div>
                      <h2 className="font-semibold text-[#171717]">{HOST_NAME}</h2>
                      <p className="text-sm text-slate-600">{MEETING_TITLE}</p>
                    </div>
                  </div>
                  {selectedDate && selectedSlot && (
                    <>
                      <div className="flex items-center gap-2 text-slate-600">
                        <Clock className="w-4 h-4 shrink-0" />
                        <span className="text-sm">
                          {formatSelectedDate(selectedDate, timezone)} at{" "}
                          {formatSlotTime(selectedSlot.start, timezone, use24h)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-600">
                        <Clock className="w-4 h-4 shrink-0" />
                        <span className="text-sm">{duration} min</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-600">
                        <Video className="w-4 h-4 shrink-0" />
                        <span className="text-sm">Google Meet video call</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-600">
                        <Globe className="w-4 h-4 shrink-0" />
                        <span className="text-sm">{getTimezoneLabel(timezone)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="p-6 lg:p-8 flex flex-col lg:w-[460px] shrink-0 overflow-y-auto">
                <form onSubmit={handleFormSubmit} className="flex flex-col flex-1 space-y-4">
                  {status === "error" && slotsError && (
                    <div className="rounded-md p-3 text-sm bg-red-50 text-red-700">
                      {slotsError}
                    </div>
                  )}
                  <div>
                    <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1">
                      Your name <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="name"
                      type="text"
                      required
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                      placeholder="Your name"
                    />
                  </div>
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
                      Email address <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="email"
                      type="email"
                      required
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                      placeholder="you@example.com"
                    />
                  </div>
                  <div>
                    <label htmlFor="notes" className="block text-sm font-medium text-slate-700 mb-1">
                      Additional notes
                    </label>
                    <textarea
                      id="notes"
                      rows={3}
                      value={formNotes}
                      onChange={(e) => setFormNotes(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500 resize-none"
                      placeholder="Share anything that will help prepare for our meeting."
                    />
                  </div>
                  <button
                    type="button"
                    className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
                  >
                    <UserPlus className="w-4 h-4" />
                    Add guests
                  </button>
                  <p className="text-xs text-slate-500">
                    By continuing, you agree to our terms of service and privacy policy.
                  </p>
                  <div className="flex gap-3 pt-2 mt-auto">
                    <button
                      type="button"
                      onClick={handleBack}
                      className="flex-1 px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={status === "loading"}
                      className="flex-1 px-4 py-2 text-sm font-medium text-white bg-[#171717] hover:bg-slate-800 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {status === "loading" ? "Scheduling..." : "Confirm"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : (
            <div className={`flex flex-col lg:flex-row items-stretch ${stageHeightClass}`}>
                <div
                  className="p-6 lg:py-8 lg:pl-6 lg:pr-6 border-b border-slate-200 lg:border-b-0 lg:border-r lg:border-r-slate-200 lg:w-[280px] shrink-0"
                  style={leftPanelStyle}
                >
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-full bg-slate-200 flex items-center justify-center text-xl font-semibold text-slate-600">
                        {HOST_NAME[0]}
                      </div>
                      <div>
                        <h2 className="font-semibold text-[#171717]">{HOST_NAME}</h2>
                        <p className="text-sm text-slate-600">{MEETING_TITLE}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-slate-600">
                      <Clock className="w-4 h-4 shrink-0" />
                      <span className="text-sm">{duration} min</span>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Duration</label>
                      <div className="flex flex-wrap gap-2">
                        {DURATIONS.map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setDuration(d)}
                            className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                              duration === d
                                ? "border-[#171717] bg-[#171717] text-white"
                                : "border-slate-300 text-slate-700 hover:bg-slate-50"
                            }`}
                          >
                            {d} min
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Timezone</label>
                      <div className="relative">
                        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <select
                          value={timezone}
                          onChange={(e) => setTimezone(e.target.value)}
                          className="w-full pl-10 pr-4 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-slate-500"
                        >
                          {TIMEZONES.map((tz) => (
                            <option key={tz.value} value={tz.value}>
                              {tz.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-slate-600">
                      <Video className="w-4 h-4 shrink-0" />
                      <span className="text-sm">Google Meet video call</span>
                    </div>
                  </div>
                </div>

                <div
                  className="p-6 lg:p-8 lg:w-[460px] shrink-0"
                  style={calendarStyle}
                >
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-[#171717]">
                      {formatMonthYear(viewDate)}
                    </h3>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={prevMonth}
                        className="p-2 rounded-md hover:bg-slate-100 text-slate-600"
                        aria-label="Previous month"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <button
                        type="button"
                        onClick={nextMonth}
                        className="p-2 rounded-md hover:bg-slate-100 text-slate-600"
                        aria-label="Next month"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-7 gap-1">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                      <div key={d} className="text-center text-xs font-semibold text-slate-700 py-1">
                        {d}
                      </div>
                    ))}
                    {days.map((d) => {
                      const past = isPastDate(d);
                      return (
                        <button
                          key={d.toISOString()}
                          type="button"
                          onClick={() => !past && setSelectedDate(new Date(d))}
                          disabled={past}
                          className={`aspect-square flex items-center justify-center text-sm rounded-md transition-colors ${
                            past
                              ? "text-slate-300 cursor-not-allowed"
                              : !isCurrentMonth(d)
                                ? "text-slate-300"
                                : isSelected(d)
                                  ? "bg-[#171717] text-white"
                                  : isToday(d)
                                    ? "border border-[#171717] text-[#171717] hover:bg-slate-50"
                                    : "text-slate-700 hover:bg-slate-100"
                          }`}
                        >
                          {d.getDate()}
                        </button>
                      );
                    })}
                  </div>
                </div>

              <div
                className={`overflow-visible lg:overflow-hidden shrink-0 min-w-full lg:min-w-0 border-t border-slate-200 lg:border-t-0 ${showSlots ? "lg:border-l lg:border-l-slate-200" : ""}`}
                style={slotsWrapperStyle}
                aria-hidden={!showSlots}
              >
                <div className="p-6 lg:p-8 h-full flex flex-col lg:w-[280px] min-h-0" style={slotsPanelStyle}>
                  <div className="flex flex-col flex-1 min-h-0">
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-medium text-slate-700">Time format</span>
                      <div className="flex rounded-lg border border-slate-200 p-0.5">
                        <button
                          type="button"
                          onClick={() => setUse24h(false)}
                          className={`px-3 py-1.5 text-sm font-medium transition-colors rounded-md ${
                            !use24h
                              ? "bg-[#171717] text-white"
                              : "bg-transparent text-slate-900 hover:bg-slate-100"
                          }`}
                        >
                          12h
                        </button>
                        <button
                          type="button"
                          onClick={() => setUse24h(true)}
                          className={`px-3 py-1.5 text-sm font-medium transition-colors rounded-md ${
                            use24h
                              ? "bg-[#171717] text-white"
                              : "bg-transparent text-slate-900 hover:bg-slate-100"
                          }`}
                        >
                          24h
                        </button>
                      </div>
                    </div>

                    {selectedDate && (
                      <div key={selectedDate.toISOString()} className="flex flex-col flex-1 min-h-0 pt-4">
                        <p className="text-sm font-medium text-slate-700 shrink-0">
                          {formatSelectedDate(selectedDate, timezone)}
                        </p>
                        <div className="flex-1 min-h-0 overflow-visible lg:overflow-y-auto pt-3 pb-4 overscroll-contain">
                          {slotsLoading ? (
                            <div className="flex items-center gap-2 text-slate-500">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span className="text-sm">Loading availability…</span>
                            </div>
                          ) : slotsError ? (
                            <p className="text-sm text-red-600">{slotsError}</p>
                          ) : slots.length === 0 ? (
                            <p className="text-sm text-slate-500">
                              No slots available for this date.
                            </p>
                          ) : (
                            <div className="grid grid-cols-2 gap-2 pb-2">
                              {slots.map((slot) => (
                                <button
                                  key={slot.start}
                                  type="button"
                                  onClick={() => handleSlotClick(slot)}
                                  className="px-4 py-3 sm:py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md hover:border-[#171717] hover:bg-slate-50 transition-colors touch-manipulation"
                                >
                                  {formatSlotTime(slot.start, timezone, use24h)}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
