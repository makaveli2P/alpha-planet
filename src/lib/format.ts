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
