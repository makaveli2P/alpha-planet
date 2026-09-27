import { DAY_START_HOUR } from "../data/tables";
import type { Session } from "../types";

// Start of the business day that `ts` belongs to (the day turns at
// DAY_START_HOUR, not midnight).
export function businessDayStart(ts: number): number {
  const day = new Date(ts);
  if (day.getHours() < DAY_START_HOUR) day.setDate(day.getDate() - 1);
  day.setHours(DAY_START_HOUR, 0, 0, 0);
  return day.getTime();
}

// The moment a clock time "HH:MM" falls on the business day that starts at
// `dayStart`. An hour before DAY_START_HOUR is after midnight, on the next
// calendar date, so 23:30–00:45 stays in one business day. NaN when the text
// is not a time.
export function atOnBusinessDay(dayStart: number, hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match || !Number.isFinite(dayStart)) return NaN;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return NaN;
  const day = new Date(dayStart);
  if (hours < DAY_START_HOUR) day.setDate(day.getDate() + 1);
  day.setHours(hours, minutes, 0, 0);
  return day.getTime();
}

// The starts of the last `count` business days, today's first.
export function recentBusinessDays(now: number, count = 7): number[] {
  const day = new Date(businessDayStart(now));
  const days: number[] = [];
  for (let i = 0; i < count; i += 1) {
    days.push(day.getTime());
    day.setDate(day.getDate() - 1);
  }
  return days;
}

// A timestamp as a 24h "HH:MM" value for a time input.
export function timeValue(ms: number) {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// "Snooker 1" → "S1", "Pool 2" → "P2". A name without a trailing number
// keeps up to three initials ("Vip Room" → "VR").
export function shortTableName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const last = parts[parts.length - 1];
  if (parts.length > 1 && /^\d+$/.test(last)) return `${parts[0][0].toUpperCase()}${last}`;
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return parts
    .slice(0, 3)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Sat 20 Sep" for the business day of `ts` (a 1 AM time belongs to the day
// before). The year shows when it is not the year of `ref`.
export function businessDayName(ts: number, ref: number = ts): string {
  const day = new Date(businessDayStart(ts));
  const year = day.getFullYear() !== new Date(ref).getFullYear() ? ` ${day.getFullYear()}` : "";
  return `${WEEKDAYS[day.getDay()]} ${day.getDate()} ${MONTHS[day.getMonth()]}${year}`;
}

const formatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});

// Receipt bill number: business-date prefix + a per-day sequence, e.g.
// 20260712-001. The sequence is the bill's position among that day's settled,
// non-voided whole bills and counter orders (a loser-pays sitting is not a
// bill — its money is on tabs); an unsettled bill (payment preview) gets the next number.
export function billNumber(session: Session, sessions: Session[], now: number): string {
  const ref = session.settledAt ?? now;
  const startMs = businessDayStart(ref);
  const endMs = startMs + 86400000;
  const sameDay = sessions
    .filter((entry) => entry.settledAt && !entry.voidedAt && entry.splitMode !== "frames" && entry.settledAt >= startMs && entry.settledAt < endMs)
    .sort((a, b) => (a.settledAt ?? 0) - (b.settledAt ?? 0) || (a.id < b.id ? -1 : 1));
  let seq: number;
  if (session.settledAt) {
    const index = sameDay.findIndex((entry) => entry.id === session.id);
    seq = index >= 0 ? index + 1 : sameDay.length + 1;
  } else {
    seq = sameDay.length + 1;
  }
  const day = new Date(startMs);
  const yyyy = day.getFullYear();
  const mm = String(day.getMonth() + 1).padStart(2, "0");
  const dd = String(day.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${String(seq).padStart(3, "0")}`;
}

export function formatMoney(value: number) {
  return formatter.format(value);
}

// Per-minute rates can land on paise (₹4.5/min), so keep up to 2 decimals here.
const rateFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

export function formatRatePerMinute(ratePerHour: number) {
  return rateFormatter.format(ratePerHour / 60);
}

// A running clock: "12:04", or "1:02:09" past the hour.
export function formatClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function shortCategory(name: string) {
  return name.replace(/ (Planet|Mania)$/, "");
}

export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  return `${hours}h ${mins}m`;
}

export function formatHour(hour: number) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 || 12;
  return `${display} ${suffix}`;
}

export function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
