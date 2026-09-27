import { EXTRA_PLAYER_RATE_PER_HOUR } from "../data/tables";
import type { MenuItem, OrderLine, PaymentMode, Session, TableConfig } from "../types";
import { awaitingFrame, isFrameBilled, runningFrame, seatedNow } from "./billing";

// Pure helpers for ONE sitting (session). Anything that also touches the
// customer registry or the tabs lives in appActions.ts.

type PriceOption = MenuItem["prices"][number];

export const MAX_SEATED = 8;
export const MIN_FRAME_PLAYERS = 2;
// A frame can be cancelled (nothing billed) only this soon after it started;
// after that it must be ended and billed, so no table time vanishes unseen.
export const CANCEL_FRAME_WINDOW_MS = 120000;
// A player removed this soon after being seated, before any frame could bill
// them, is a mis-entry: the seat is deleted instead of marked as left.
export const MISTAKE_WINDOW_MS = 60000;

// A new sitting. It starts in loser-pays mode and bills nothing by itself:
// staff add players and start frames, or switch to the whole-table clock.
export function createSitting(table: TableConfig, now: number, id: string): Session {
  return {
    id,
    tableId: table.id,
    startedAt: now,
    ratePerHour: table.ratePerHour,
    orders: [],
    discount: 0,
    splitMode: "frames",
    seats: [],
    frames: [],
    // The extra-player charge is a snooker rule; pool keeps its flat rate.
    extraPlayerRatePerHour: table.game === "snooker" ? EXTRA_PLAYER_RATE_PER_HOUR : 0
  };
}

// A counter/takeaway order: kitchen items only, no table and no running clock.
// It opens already "ended" so there is no timer and it can be settled at once.
export function createCounterOrder(tableId: string, now: number, id: string): Session {
  return { id, tableId, startedAt: now, endedAt: now, ratePerHour: 0, orders: [], discount: 0, splitMode: "table" };
}

// The line this menu price adds to: same item, variant and price. After a
// price change a new line opens at the new price; the old line keeps its own.
export function findOrderLine(session: Session | undefined, menuItem: MenuItem, price: PriceOption): OrderLine | undefined {
  return session?.orders.find((line) => line.itemId === menuItem.id && line.variant === price.label && line.unitPrice === price.price);
}

export function addOrderToSession(session: Session, menuItem: MenuItem, price: PriceOption, createLineId: () => string): Session {
  const existing = findOrderLine(session, menuItem, price);
  const orders = existing
    ? session.orders.map((line) => (line.lineId === existing.lineId ? { ...line, quantity: line.quantity + 1 } : line))
    : [
        ...session.orders,
        {
          lineId: createLineId(),
          itemId: menuItem.id,
          name: menuItem.name,
          category: menuItem.category,
          variant: price.label,
          unitPrice: price.price,
          quantity: 1
        }
      ];
  return { ...session, orders };
}

export function changeOrderQuantity(session: Session, lineId: string, delta: number): Session {
  if (!session.orders.some((line) => line.lineId === lineId)) return session;
  return {
    ...session,
    orders: session.orders
      .map((line) => (line.lineId === lineId ? { ...line, quantity: line.quantity + delta } : line))
      .filter((line) => line.quantity > 0)
  };
}

// ====== Seats ======

export function isMistakenSeat(session: Session, seatId: string, now: number): boolean {
  const seat = (session.seats ?? []).find((entry) => entry.id === seatId);
  if (!seat || seat.leftAt != null) return false;
  // A billed frame that ran while they were seated was priced with them, so the
  // seat must stay on record. A running or waiting frame is priced live: deleting
  // the seat re-prices it, so a mis-entry never keeps the frame at a higher rate
  // (the rate never drops when a player leaves — billing.frameHeadcountAt).
  const touched = (session.frames ?? []).some(
    (frame) => frame.chargeId && frame.startedAt <= now && (frame.endedAt ?? Infinity) >= seat.joinedAt
  );
  return !touched && now - seat.joinedAt < MISTAKE_WINDOW_MS;
}

// ====== Loser-pays frames ======

// Start frame N. Never automatic: needs at least two players at the table and
// no frame running or waiting for its lowest scorer.
export function startFrame(session: Session, now: number, id: string): Session {
  if (!isFrameBilled(session) || session.settledAt) return session;
  if (runningFrame(session) || awaitingFrame(session)) return session;
  if (seatedNow(session).length < MIN_FRAME_PLAYERS) return session;
  return { ...session, frames: [...(session.frames ?? []), { id, startedAt: now }] };
}

// End the running frame at the tap: its price stops now, and it waits for its
// lowest scorer. The next frame does not start.
export function endFrame(session: Session, now: number): Session {
  const frame = runningFrame(session);
  if (!frame || awaitingFrame(session)) return session;
  const endedAt = Math.max(frame.startedAt, now);
  return { ...session, frames: (session.frames ?? []).map((entry) => (entry.id === frame.id ? { ...entry, endedAt } : entry)) };
}

// Undo an End frame tapped by mistake: the frame runs on.
export function keepPlaying(session: Session): Session {
  const frame = awaitingFrame(session);
  // Nobody left at the table: the frame can only be billed, not played on.
  if (!frame || runningFrame(session) || seatedNow(session).length === 0) return session;
  return {
    ...session,
    frames: (session.frames ?? []).map((entry) => (entry.id === frame.id ? { ...entry, endedAt: undefined } : entry))
  };
}

// Discard the running frame (started by mistake) in its first two minutes.
// Nothing is billed.
export function cancelFrame(session: Session, now: number): Session {
  const frame = runningFrame(session);
  if (!frame || now - frame.startedAt > CANCEL_FRAME_WINDOW_MS) return session;
  return { ...session, frames: (session.frames ?? []).filter((entry) => entry.id !== frame.id) };
}

// Correct when the frame in play started (staff pressed Start late). Kept after
// the previous frame's end and not in the future. Only before it is billed.
export function setFrameStart(session: Session, frameId: string, at: number, now: number): Session {
  const frames = session.frames ?? [];
  const index = frames.findIndex((frame) => frame.id === frameId);
  const frame = frames[index];
  if (!frame || frame.chargeId || !Number.isFinite(at)) return session;
  const previousEnd = index > 0 ? frames[index - 1].endedAt ?? session.startedAt : session.startedAt;
  const startedAt = Math.max(previousEnd, Math.min(at, frame.endedAt ?? now, now));
  return { ...session, frames: frames.map((entry) => (entry.id === frameId ? { ...entry, startedAt } : entry)) };
}

// Correct when a frame ended (End frame tapped late), before it is billed.
export function setFrameEnd(session: Session, frameId: string, at: number, now: number): Session {
  const frames = session.frames ?? [];
  const index = frames.findIndex((entry) => entry.id === frameId);
  const frame = frames[index];
  if (!frame || frame.chargeId || frame.endedAt == null || !Number.isFinite(at)) return session;
  // Never past the next frame's start, so no minute is billed twice.
  const nextStart = frames[index + 1]?.startedAt ?? now;
  const endedAt = Math.max(frame.startedAt, Math.min(at, now, nextStart));
  return { ...session, frames: (session.frames ?? []).map((entry) => (entry.id === frameId ? { ...entry, endedAt } : entry)) };
}

// ====== Whole-table bill ======

// Switch a sitting to one bill on a clock that starts now. Only before any
// frame was played; players stay seated (for the record and for Put on tab).
export function startWholeTable(session: Session, now: number): Session {
  if (!isFrameBilled(session) || session.settledAt || (session.frames ?? []).length > 0) return session;
  return { ...session, splitMode: "table", startedAt: now, endedAt: undefined, discount: 0, roundOffEnabled: false };
}

export function markSessionEnded(session: Session, now: number): Session {
  if (isFrameBilled(session) || session.endedAt) return session;
  return { ...session, endedAt: now };
}

export function reopenEndedSession(session: Session, now: number): Session {
  if (isFrameBilled(session) || !session.endedAt || session.settledAt || session.tableId === "counter") return session;
  const pausedMs = now - session.endedAt;
  // Back to running with the paused stretch left out; clear any discount or
  // round-off set while ended so it can't silently ride a live bill.
  return { ...session, startedAt: session.startedAt + pausedMs, endedAt: undefined, discount: 0, roundOffEnabled: false };
}

// Everyone still seated leaves when a bill closes, so they can sit elsewhere.
function releaseSeats(session: Session, now: number): Session["seats"] {
  return session.seats?.map((seat) => (seat.leftAt == null ? { ...seat, leftAt: now } : seat));
}

export function settleEndedSession(session: Session, paymentMode: PaymentMode, now: number): Session {
  if (isFrameBilled(session) || !session.endedAt || session.settledAt) return session;
  return { ...session, paymentMode, settledAt: now, seats: releaseSeats(session, now) };
}

// Void a whole bill or a counter order. A loser-pays sitting is never voided:
// its money is on tabs (void a charge there instead).
export function voidCurrentSession(session: Session, now: number): Session {
  if (session.settledAt || isFrameBilled(session)) return session;
  return { ...session, endedAt: session.endedAt ?? now, voidedAt: now, settledAt: now, seats: releaseSeats(session, now) };
}

export function setSessionDiscount(session: Session, value: number): Session {
  if (isFrameBilled(session)) return session;
  // Whole rupees only, so every total stays a whole rupee.
  const safe = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return { ...session, discount: safe };
}

export function toggleSessionRoundOff(session: Session): Session {
  if (isFrameBilled(session)) return session;
  return { ...session, roundOffEnabled: !session.roundOffEnabled };
}

export function setSessionName(session: Session, name: string): Session {
  return { ...session, customerName: name.trim() ? name : undefined };
}

// Correct the recorded start (e.g. nobody was at the counter to start it on
// time). Kept at or before the end so the duration can't go negative.
export function setSessionStart(session: Session, startedAt: number, now: number): Session {
  if (isFrameBilled(session) || !Number.isFinite(startedAt)) return session;
  return { ...session, startedAt: Math.min(startedAt, session.endedAt ?? now) };
}

// Correct the end (e.g. they stopped playing but stayed for food), between the
// start and now.
export function setSessionEnd(session: Session, endedAt: number, now: number): Session {
  if (isFrameBilled(session) || !session.endedAt || !Number.isFinite(endedAt)) return session;
  return { ...session, endedAt: Math.max(session.startedAt, Math.min(endedAt, now)) };
}
