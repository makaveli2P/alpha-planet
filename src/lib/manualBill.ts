import { BASE_PLAYERS } from "../data/tables";
import type { AppState, Charge, ManualBillInput, OrderLine, Session, TableConfig } from "../types";
import { addCustomer, customerInputError, itemsTotal, putBillOnTab, tableNameOf, toItems, voidCharge, withSession, type MakeId } from "./appActions";
import { COUNTER_ID, calculateSessionTotals, frameEnd, isFrameBilled, isOpenCharge, ratePerHourFor, startOfDay } from "./billing";
import { atOnBusinessDay, recentBusinessDays } from "./format";
import {
  MAX_SEATED,
  MIN_FRAME_PLAYERS,
  createCounterOrder,
  createSitting,
  setSessionDiscount,
  settleEndedSession,
  startWholeTable
} from "./sessionActions";

// Manual bills: play that the floor did not record, entered afterwards from the
// manual bill dialog. One entry is one bill: a whole table or a counter order,
// paid now or put on a tab, or one loser-pays frame, which always goes on the
// loser's tab. Every record carries `manual: true`, is settled when it is made
// and counts on the business day it was entered (see calculateMetrics). Like
// appActions.ts, every function is pure and a reducer that does not apply
// returns the old state unchanged.

const HOUR_MS = 3600000;
const MINUTE_MS = 60000;

// Longer than this is a mistyped time, not a sitting.
export const MANUAL_MAX_MINUTES = 720;
// How far back an entry can go: today's business day and the 6 before it.
export const MANUAL_DAYS = 7;

// One loser-pays frame over [from, to) at a fixed headcount. The rupee is
// floored once per frame, as on the floor; with whole-minute times this equals
// floor(minutes × rate / 60).
export function manualFrameCharge(
  pricing: Pick<Session, "ratePerHour" | "extraPlayerRatePerHour">,
  players: number,
  from: number,
  to: number
): number {
  return to > from ? Math.floor(((to - from) * ratePerHourFor(pricing, players)) / HOUR_MS) : 0;
}

// When the entry was played: the chosen business day, counted back from the day
// `now` is in. It resolves again at every call, so a Today entry left open
// across 6 AM becomes a future time and is refused. The dialog keeps the date
// that staff picked and sends its index again at each call, so an older day
// does not move. `from`/`to` are NaN until the times are entered (and
// `dayStart` is NaN for a day outside the last week). An end at
// DAY_START_HOUR sharp after a later start is the close of the day (the next
// date), so a night that ran until the day turned can be entered; 06:00–06:00
// stays equal times.
export function manualSpan(input: ManualBillInput, now: number): { dayStart: number; from: number; to: number } {
  const inRange = Number.isInteger(input.dayOffset) && input.dayOffset >= 0 && input.dayOffset < MANUAL_DAYS;
  const dayStart = inRange ? recentBusinessDays(now, MANUAL_DAYS)[input.dayOffset] : NaN;
  const from = atOnBusinessDay(dayStart, input.start);
  const end = atOnBusinessDay(dayStart, input.end);
  let to = end;
  if (end === dayStart && from > dayStart) {
    const close = new Date(dayStart);
    close.setDate(close.getDate() + 1);
    to = close.getTime();
  }
  return { dayStart, from, to };
}

type ManualShape = {
  table?: TableConfig;  // undefined for the counter (or an unknown table id)
  counter: boolean;
  frames: boolean;      // loser pays (never at the counter)
  perPlayer: boolean;   // loser pays on a table with an extra-player rate (snooker)
  orders: OrderLine[];
};

function manualShape(state: AppState, input: ManualBillInput): ManualShape {
  const counter = input.tableId === COUNTER_ID;
  const table = counter ? undefined : state.tables.find((entry) => entry.id === input.tableId);
  const frames = !counter && input.mode === "frames";
  const perPlayer = frames && table != null && (createSitting(table, 0, input.id).extraPlayerRatePerHour ?? 0) > 0;
  return { table, counter, frames, perPlayer, orders: input.orders.filter((line) => line.quantity > 0) };
}

// The whole bill (a table on the clock, or a counter order) that the entry
// records, before it is paid or put on a tab. Round-off stays off. Without a
// table it has the counter's shape: no table time, only the cafe.
function manualWholeSession(input: ManualBillInput, table: TableConfig | undefined, from: number, to: number, now: number, orders: OrderLine[]): Session {
  const base = table ? { ...startWholeTable(createSitting(table, from, input.id), from), endedAt: to } : createCounterOrder(COUNTER_ID, now, input.id);
  return setSessionDiscount({ ...base, orders, manual: true }, input.discount);
}

export type ManualBillTotals = {
  minutes: number;     // play length (0 at the counter or before the times are valid)
  tableCharge: number;
  cafe: number;
  discount: number;    // the discount applied (never more than the bill)
  total: number;
};

// The price of a manual bill, for the dialog's live total and for the reducer.
// Whole table: the floor's whole-bill math on the built bill. Counter: the items
// less the discount. Loser pays: the frame's table time plus the items (no
// discount; a tab gets its discount when it is paid). Until the times are
// valid, the table part is ₹0.
export function manualBillTotals(state: AppState, input: ManualBillInput, now: number): ManualBillTotals {
  const { table, frames, perPlayer, orders } = manualShape(state, input);
  const { from, to } = manualSpan(input, now);
  const timed = table != null && to > from;
  if (frames) {
    const cafe = itemsTotal(toItems(orders));
    const tableCharge = timed ? manualFrameCharge(createSitting(table, from, input.id), perPlayer ? input.players : BASE_PLAYERS, from, to) : 0;
    return { minutes: timed ? Math.floor((to - from) / MINUTE_MS) : 0, tableCharge, cafe, discount: 0, total: tableCharge + cafe };
  }
  const bill = manualWholeSession(input, timed ? table : undefined, from, to, now, orders);
  const totals = calculateSessionTotals(bill, now);
  return {
    minutes: timed ? totals.minutes : 0,
    tableCharge: totals.tableCharge,
    cafe: totals.kitchenTotal,
    discount: totals.subtotal - totals.afterDiscount,
    total: totals.total
  };
}

function isTender(tender: ManualBillInput["tender"]): boolean {
  return tender === "Cash" || tender === "UPI" || tender === "Card" || tender === "Tab";
}

// Why a manual bill can't be recorded, or undefined when it can. The first
// reason only, in the order the dialog shows its fields.
export function manualBillError(state: AppState, input: ManualBillInput, now: number): string | undefined {
  const { table, counter, frames, perPlayer, orders } = manualShape(state, input);
  if (!counter && !table) return "Pick a table.";
  if (counter && orders.length === 0) return "Add at least one item.";
  if (!counter) {
    const { dayStart, from, to } = manualSpan(input, now);
    if (Number.isNaN(dayStart)) return "Pick a day in the last week.";
    if (!input.start.trim()) return "Enter when they started.";
    if (Number.isNaN(from) || Number.isNaN(to)) return "Enter the times as HH:MM.";
    if (to <= from) return "End must be after start.";
    if (to > now) return "The end time is in the future.";
    if (to - from > MANUAL_MAX_MINUTES * MINUTE_MS) return `Check the times. A bill can't be longer than ${MANUAL_MAX_MINUTES / 60} hours.`;
    const players = input.players;
    if (perPlayer && !(Number.isInteger(players) && players >= MIN_FRAME_PLAYERS && players <= MAX_SEATED)) {
      return `Pick ${MIN_FRAME_PLAYERS} to ${MAX_SEATED} players.`;
    }
  }
  if (!frames && !isTender(input.tender)) return "Pick Cash, UPI, Card or Put on tab.";
  if (frames || input.tender === "Tab") {
    const payer = input.payer;
    if (!payer || ("customerId" in payer && !state.customers.some((customer) => customer.id === payer.customerId))) {
      return frames ? "Pick the loser." : "Pick whose tab.";
    }
    if (!("customerId" in payer)) {
      const error = customerInputError(state, payer);
      if (error) return error;
    }
    if (manualBillTotals(state, input, now).total <= 0) return "Nothing to put on a tab.";
  }
  return undefined;
}

// Record a manual bill in ONE state update. It does nothing when a record with
// this draft id exists (a double tap) or manualBillError has a reason. A new
// payer joins the registry in the same update. Loser pays: a settled sitting
// with one seat (the loser) and one billed frame, plus the frame charge on the
// loser's tab (table time + the items). Whole table or counter: the bill is
// settled by tender, or put on the payer's tab (that charge is manual too).
// If settling or putBillOnTab refuses, the original state comes back.
export function recordManualBill(state: AppState, input: ManualBillInput, now: number, makeId: MakeId): AppState {
  if (state.sessions.some((session) => session.id === input.id) || manualBillError(state, input, now)) return state;
  const { table, counter, frames, perPlayer, orders } = manualShape(state, input);
  const { from, to } = manualSpan(input, now);

  let next = state;
  let customerId: string | undefined;
  const payer = input.payer;
  if (payer && (frames || input.tender === "Tab")) {
    if ("customerId" in payer) {
      customerId = payer.customerId;
    } else {
      const added = addCustomer(state, payer, now, makeId);
      if (!added.customer) return state;
      next = added.state;
      customerId = added.customer.id;
    }
  }

  if (frames) {
    if (!table || !customerId) return state;
    const sitting = createSitting(table, from, input.id);
    const tableCharge = manualFrameCharge(sitting, perPlayer ? input.players : BASE_PLAYERS, from, to);
    const items = toItems(orders);
    const charge: Charge = {
      id: makeId(),
      customerId,
      createdAt: now,
      kind: "frame",
      sessionId: input.id,
      tableId: table.id,
      tableName: tableNameOf(state, table.id),
      frameNo: 1,
      minutes: Math.floor((to - from) / MINUTE_MS),
      players: perPlayer ? input.players : undefined,
      tableCharge,
      items,
      total: tableCharge + itemsTotal(items),
      manual: true
    };
    const session: Session = {
      ...sitting,
      endedAt: to,
      settledAt: now,
      seats: [{ id: makeId(), customerId, joinedAt: from, leftAt: to }],
      frames: [{ id: makeId(), startedAt: from, endedAt: to, chargeId: charge.id }],
      manual: true
    };
    return { ...next, sessions: [session, ...next.sessions], charges: [...next.charges, charge] };
  }

  const bill = manualWholeSession(input, counter ? undefined : table, from, to, now, orders);
  if (input.tender === "Tab") {
    if (!customerId) return state;
    const opened: AppState = { ...next, sessions: [bill, ...next.sessions] };
    const onTab = putBillOnTab(opened, bill.id, customerId, now, makeId);
    if (onTab === opened) return state;
    const chargeId = onTab.sessions.find((session) => session.id === bill.id)?.tabChargeId;
    return { ...onTab, charges: onTab.charges.map((charge) => (charge.id === chargeId ? { ...charge, manual: true } : charge)) };
  }
  if (!input.tender) return state;
  const paid = settleEndedSession(bill, input.tender, now);
  if (!paid.settledAt) return state;
  return { ...next, sessions: [paid, ...next.sessions] };
}

// Void a manual bill from the dialog that made it (a mistake seen at once).
// This is a deliberate exception to voidCurrentSession, which never voids a
// settled bill, and it is limited to manual bills. Loser pays: only while the
// frame charge is open; the charge is voided, and the entry too, so the frame
// leaves the frame counts. A whole bill on a tab: voidCharge voids the bill with
// its charge. A whole bill paid by tender: the bill is voided, so it leaves
// today's sales and cash.
export function voidManualBill(state: AppState, sessionId: string, now: number): AppState {
  const session = state.sessions.find((entry) => entry.id === sessionId);
  if (!session?.manual || !session.settledAt || session.voidedAt) return state;
  if (isFrameBilled(session)) {
    const ids = new Set((session.frames ?? []).map((frame) => frame.chargeId));
    const charges = state.charges.filter((charge) => ids.has(charge.id));
    if (charges.length === 0 || !charges.every(isOpenCharge)) return state;
    const next = charges.reduce((current, charge) => voidCharge(current, charge.id, now), state);
    return withSession(next, sessionId, (entry) => ({ ...entry, voidedAt: now }));
  }
  if (session.tabChargeId) return voidCharge(state, session.tabChargeId, now);
  return withSession(state, sessionId, (entry) => ({ ...entry, voidedAt: now }));
}

// The earliest recorded play on this table that overlaps [from, to), for the
// dialog's read-only warning (only staff know if it is the same play billed
// twice). Frames count by [start, end) unless their charge was voided; whole
// bills by [start, end), or up to now while the clock runs. Voided sittings
// and the counter (no table time) never count.
export function recordedOverlap(state: AppState, tableId: string, from: number, to: number, now: number): { from: number; to: number } | undefined {
  if (tableId === COUNTER_ID || !(to > from)) return undefined;
  const voided = new Set(state.charges.filter((charge) => charge.voidedAt).map((charge) => charge.id));
  const spans: { from: number; to: number }[] = [];
  for (const session of state.sessions) {
    if (session.tableId !== tableId || session.voidedAt) continue;
    if (isFrameBilled(session)) {
      for (const frame of session.frames ?? []) {
        if (frame.chargeId && voided.has(frame.chargeId)) continue;
        spans.push({ from: frame.startedAt, to: frameEnd(frame, now) });
      }
    } else {
      spans.push({ from: session.startedAt, to: session.endedAt ?? now });
    }
  }
  return spans.filter((span) => span.from < to && from < span.to).sort((a, b) => a.from - b.from)[0];
}

export type ExceptionsToday = { manualCount: number; manualTotal: number; voidCount: number; voidTotal: number };

// The Dashboard's audit line for today. Manual: manual entries made today and
// not voided (a loser-pays entry sums its charges that are not voided; a whole
// bill uses its total). Voids: whole bills voided today with money on them,
// plus frame and cafe charges voided today (a bill charge counts through its
// bill, so never twice).
export function exceptionsToday(state: AppState, now: number): ExceptionsToday {
  const dayStart = startOfDay(now);
  const byId = new Map(state.charges.map((charge) => [charge.id, charge]));
  const result: ExceptionsToday = { manualCount: 0, manualTotal: 0, voidCount: 0, voidTotal: 0 };
  for (const session of state.sessions) {
    if (session.manual && !session.voidedAt && session.settledAt != null && session.settledAt >= dayStart) {
      if (isFrameBilled(session)) {
        const live = (session.frames ?? [])
          .map((frame) => (frame.chargeId ? byId.get(frame.chargeId) : undefined))
          .filter((charge): charge is Charge => charge != null && !charge.voidedAt);
        if (live.length > 0) {
          result.manualCount += 1;
          result.manualTotal += live.reduce((sum, charge) => sum + charge.total, 0);
        }
      } else {
        result.manualCount += 1;
        result.manualTotal += calculateSessionTotals(session, now).total;
      }
    }
    if (session.voidedAt != null && session.voidedAt >= dayStart && !isFrameBilled(session)) {
      const total = calculateSessionTotals(session, now).total;
      if (total > 0) {
        result.voidCount += 1;
        result.voidTotal += total;
      }
    }
  }
  for (const charge of state.charges) {
    if (charge.voidedAt == null || charge.voidedAt < dayStart || (charge.kind !== "frame" && charge.kind !== "cafe")) continue;
    result.voidCount += 1;
    result.voidTotal += charge.total;
  }
  return result;
}
