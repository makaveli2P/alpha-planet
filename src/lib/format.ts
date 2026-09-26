import type { Session } from "../types";

const formatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});

// Receipt bill number: date prefix + a per-day sequence, e.g. 20260712-001.
// The sequence is the bill's position among that day's settled (non-voided)
// bills; an unsettled bill (payment preview) gets the next number.
export function billNumber(session: Session, sessions: Session[], now: number): string {
  const ref = session.settledAt ?? now;
  const day = new Date(ref);
  const start = new Date(ref);
  start.setHours(0, 0, 0, 0);
  const startMs = start.getTime();
  const endMs = startMs + 86400000;
  const sameDay = sessions
    .filter((entry) => entry.settledAt && !entry.voidedAt && entry.settledAt >= startMs && entry.settledAt < endMs)
    .sort((a, b) => (a.settledAt ?? 0) - (b.settledAt ?? 0) || (a.id < b.id ? -1 : 1));
  let seq: number;
  if (session.settledAt) {
    const index = sameDay.findIndex((entry) => entry.id === session.id);
    seq = index >= 0 ? index + 1 : sameDay.length + 1;
  } else {
    seq = sameDay.length + 1;
  }
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
