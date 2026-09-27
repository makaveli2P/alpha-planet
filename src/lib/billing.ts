import { BASE_PLAYERS } from "../data/tables";
import type {
  AppState,
  Charge,
  Frame,
  FrameView,
  HourRevenue,
  Metrics,
  RevenueMix,
  Seat,
  Session,
  SessionTotals,
  TableHistory,
  TablePerformance,
  TableStatus,
  TenderTotals
} from "../types";
import { businessDayStart, formatHour } from "./format";

export const COUNTER_ID = "counter";
const HOUR_MS = 3600000;

export function getActiveSession(sessions: Session[], tableId: string) {
  return sessions.find((session) => session.tableId === tableId && !session.settledAt);
}

// Loser pays: frames bill their lowest scorer's tab, and the sitting itself
// bills nothing. Everything else (pool, the counter, a snooker party paying as
// one, saved "per-player" sessions) is one whole bill.
export function isFrameBilled(session: Session): boolean {
  return session.splitMode === "frames";
}

// ====== Seats and headcount pricing ======

export function presentSeats(session: Session, at: number): Seat[] {
  return (session.seats ?? []).filter((seat) => seat.joinedAt <= at && (seat.leftAt == null || at < seat.leftAt));
}

// Seats still at the table (not left).
export function seatedNow(session: Session): Seat[] {
  return (session.seats ?? []).filter((seat) => seat.leftAt == null);
}

// One seat per customer who left and is not seated now (their latest leave),
// latest leave first. A player who left and came back has two seats.
export function leftSeats(session: Session): Seat[] {
  const seatedIds = new Set(seatedNow(session).map((seat) => seat.customerId));
  const byCustomer = new Map<string, Seat>();
  for (const seat of session.seats ?? []) {
    if (seat.leftAt == null || seatedIds.has(seat.customerId)) continue;
    const previous = byCustomer.get(seat.customerId);
    if (!previous || (previous.leftAt ?? 0) < seat.leftAt) byCustomer.set(seat.customerId, seat);
  }
  return Array.from(byCustomer.values()).sort((a, b) => (b.leftAt ?? 0) - (a.leftAt ?? 0));
}

// Who can take a table-order charge on a loser-pays sitting: the players at
// the table, then each player who left (once, even after a return).
export function tabChargeTargets(session: Session): { seated: Seat[]; left: Seat[] } {
  if (!isFrameBilled(session)) return { seated: [], left: [] };
  return { seated: seatedNow(session), left: leftSeats(session) };
}

export function headcountAt(session: Session, at: number): number {
  return presentSeats(session, at).length;
}

// The table's rate at a given headcount: the snapshotted base rate covers up to
// BASE_PLAYERS, and each player above that adds the snapshotted per-player rate.
export function ratePerHourFor(session: Pick<Session, "ratePerHour" | "extraPlayerRatePerHour">, headcount: number): number {
  const extra = Math.max(0, session.extraPlayerRatePerHour ?? 0);
  return session.ratePerHour + Math.max(0, headcount - BASE_PLAYERS) * extra;
}

// A frame's headcount at `at`: every customer at the table at any moment from
// the frame's start `from` until `at`. A player who joins raises it; a player
// who leaves keeps it until the frame ends; a player who leaves and rejoins
// counts once. At the frame's end it equals playersDuring (the charge's players).
export function frameHeadcountAt(session: Session, from: number, at: number): number {
  const ids = new Set(
    (session.seats ?? [])
      .filter((seat) => seat.joinedAt <= at && (seat.leftAt == null || seat.leftAt > from))
      .map((seat) => seat.customerId)
  );
  return ids.size;
}

// Table time for [from, to) — one frame — priced by the frame's headcount at
// every moment: the rate rises the instant a new player joins and never drops
// before the frame ends. The rupee is floored ONCE. Integer ms × integer ₹/hr
// keeps the sum exact.
export function tableChargeBetween(session: Session, from: number, to: number): number {
  if (!(to > from)) return 0;
  const cuts = new Set<number>([from, to]);
  for (const seat of session.seats ?? []) {
    if (seat.joinedAt > from && seat.joinedAt < to) cuts.add(seat.joinedAt);
  }
  const points = Array.from(cuts).sort((a, b) => a - b);
  let rupeeMs = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    rupeeMs += (points[i + 1] - points[i]) * ratePerHourFor(session, frameHeadcountAt(session, from, points[i]));
  }
  return Math.floor(rupeeMs / HOUR_MS);
}

// The headcount the rate uses now: the running frame's headcount while a frame
// runs, else the players at the table.
export function liveHeadcount(session: Session, now: number): number {
  const frame = runningFrame(session);
  return frame ? frameHeadcountAt(session, frame.startedAt, now) : headcountAt(session, now);
}

// Distinct customers at the table at any point during [from, to).
export function playersDuring(session: Session, from: number, to: number): number {
  const until = Math.max(to, from + 1);
  const ids = new Set(
    (session.seats ?? [])
      .filter((seat) => seat.joinedAt < until && (seat.leftAt == null || seat.leftAt > from))
      .map((seat) => seat.customerId)
  );
  return ids.size;
}

// ====== Frames ======

export function frameEnd(frame: Frame, now: number): number {
  return Math.max(frame.startedAt, frame.endedAt ?? now);
}

export function runningFrame(session: Session): Frame | undefined {
  return (session.frames ?? []).find((frame) => frame.endedAt == null);
}

export function awaitingFrame(session: Session): Frame | undefined {
  return (session.frames ?? []).find((frame) => frame.endedAt != null && !frame.chargeId);
}

export function frameTableCharge(session: Session, frame: Frame, now: number): number {
  return tableChargeBetween(session, frame.startedAt, frameEnd(frame, now));
}

// Seats that can be billed a frame: at the table when it ended (joined at or
// before its end, not gone before it).
export function frameCandidates(session: Session, frame: Frame, now: number): Seat[] {
  const end = frameEnd(frame, now);
  return (session.seats ?? []).filter((seat) => seat.joinedAt <= end && (seat.leftAt == null || seat.leftAt >= end));
}

export function frameViews(session: Session, charges: Charge[], now: number): FrameView[] {
  const byId = new Map(charges.map((charge) => [charge.id, charge]));
  return (session.frames ?? []).map((frame, index) => {
    const end = frameEnd(frame, now);
    const charge = frame.chargeId ? byId.get(frame.chargeId) : undefined;
    return {
      frame,
      no: index + 1,
      minutes: Math.floor((end - frame.startedAt) / 60000),
      // A billed frame shows the players saved on its charge (what it was priced for).
      players: charge?.players ?? playersDuring(session, frame.startedAt, end),
      tableCharge: charge ? charge.tableCharge : frameTableCharge(session, frame, now),
      state: frame.chargeId ? "billed" : frame.endedAt != null ? "awaiting" : "running",
      charge
    };
  });
}

export function tableTabTotal(session: Session): number {
  return session.orders.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
}

export function getTableStatus(session?: Session): TableStatus {
  if (!session) return "available";
  if (isFrameBilled(session)) {
    if (awaitingFrame(session)) return "awaiting";
    if (runningFrame(session)) return "running";
    return "seated";
  }
  return session.endedAt ? "billing" : "running";
}

// Between frames a loser-pays table idles from the later of the last frame's
// end and the sitting's start.
export function idleSince(session: Session): number {
  return (session.frames ?? []).reduce((latest, frame) => Math.max(latest, frame.endedAt ?? 0), session.startedAt);
}

// Players who can start a frame and do not, for this long, turn the table yellow.
export const IDLE_ALERT_MS = 10 * 60000;

export type SittingAlert = "order" | "idle";

// Why a loser-pays table between frames needs staff (the needs-action colour):
// "order" when nobody is seated and the table order is not charged yet, "idle"
// when 2 or more players (enough for a frame) sit with no frame for
// IDLE_ALERT_MS. Never while a frame runs or waits for its loser, and never on
// a whole bill (that has its own "Take payment").
export function sittingAlert(session: Session, now: number): SittingAlert | undefined {
  if (!isFrameBilled(session) || session.settledAt || runningFrame(session) || awaitingFrame(session)) return undefined;
  const seated = seatedNow(session).length;
  if (seated === 0) return session.orders.length > 0 ? "order" : undefined;
  if (seated >= 2 && now - idleSince(session) >= IDLE_ALERT_MS) return "idle";
  return undefined;
}

// ====== Totals ======

// Whole bill: the original formula (round DOWN throughout — full completed
// minutes, minimum 1; the rupee floored; round-off floored to ₹5).
// Loser-pays sitting: the money not yet on anyone's tab — the running or
// waiting frame's table time plus the table tab. It is live, never settled.
export function calculateSessionTotals(session: Session, now: number): SessionTotals {
  const end = session.endedAt ?? now;
  const minutes = Math.max(1, Math.floor((end - session.startedAt) / 60000));
  const kitchenTotal = tableTabTotal(session);
  if (isFrameBilled(session)) {
    const unbilled = (session.frames ?? []).filter((frame) => !frame.chargeId);
    const tableCharge = unbilled.reduce((sum, frame) => sum + frameTableCharge(session, frame, now), 0);
    const subtotal = tableCharge + kitchenTotal;
    return { minutes, tableCharge, kitchenTotal, subtotal, afterDiscount: subtotal, roundOff: 0, total: subtotal };
  }
  const tableCharge = Math.floor((minutes * session.ratePerHour) / 60);
  const subtotal = tableCharge + kitchenTotal;
  const afterDiscount = Math.max(0, subtotal - session.discount);
  let roundOff = 0;
  let total = afterDiscount;
  if (session.roundOffEnabled && afterDiscount >= 5) {
    const target = Math.floor(afterDiscount / 5) * 5;
    roundOff = target - afterDiscount;
    total = target;
  }
  return { minutes, tableCharge, kitchenTotal, subtotal, afterDiscount, roundOff, total };
}

// ====== Tabs ======

export function isOpenCharge(charge: Charge): boolean {
  return !charge.paymentId && !charge.voidedAt;
}

export function chargeCafeTotal(charge: Charge): number {
  return charge.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

export function openCharges(charges: Charge[], customerId: string): Charge[] {
  return charges.filter((charge) => charge.customerId === customerId && isOpenCharge(charge));
}

export function tabTotal(charges: Charge[], customerId: string): number {
  return openCharges(charges, customerId).reduce((sum, charge) => sum + charge.total, 0);
}

export function openTabsTotal(charges: Charge[]): number {
  return charges.filter(isOpenCharge).reduce((sum, charge) => sum + charge.total, 0);
}

// Where a customer is seated right now, if anywhere.
export function seatOf(sessions: Session[], customerId: string): { session: Session; seat: Seat } | undefined {
  for (const session of sessions) {
    if (session.settledAt) continue;
    const seat = (session.seats ?? []).find((entry) => entry.customerId === customerId && entry.leftAt == null);
    if (seat) return { session, seat };
  }
  return undefined;
}

// ====== Metrics ======

function tenderKey(mode: Session["paymentMode"]): keyof TenderTotals {
  return mode === "Cash" || mode === "UPI" || mode === "Card" ? mode : "Unknown";
}

// "Today" is the business day (it turns at 6 AM, not midnight).
export function startOfDay(now: number): number {
  return businessDayStart(now);
}

// Sales = what was earned today: whole bills settled today (paid at the counter
// or put on a tab) plus frame and cafe charges made today. A "bill" charge is
// the same money as its settled session, so it is never counted twice.
// Collected = money taken today: bills paid at the counter + tab payments.
export function calculateMetrics(state: AppState, now: number): Metrics {
  const { sessions, tables, charges, payments } = state;
  const dayStart = startOfDay(now);
  const isToday = (at?: number) => at != null && at >= dayStart;
  const tableById = new Map(tables.map((table) => [table.id, table]));

  let totalRevenue = 0;
  let collected = 0;
  let tableRevenue = 0;
  let kitchenRevenue = 0;
  let discounts = 0;
  let takeawayRevenue = 0;
  let takeawayOrders = 0;
  let billCount = 0;
  let wholeMinutes = 0;
  let wholeSittings = 0;
  let earliest = Infinity;
  const hourTotals = new Array(24).fill(0) as number[];
  const tender: TenderTotals = { Cash: 0, UPI: 0, Card: 0, Unknown: 0 };
  const mix: RevenueMix = { tableTime: 0, dineInCafe: 0, takeaway: 0, gross: 0 };
  const itemUsage = new Map<string, number>();
  type Acc = { minutes: number; revenue: number; sessions: number; frames: number; customers: Set<string> };
  const perTable = new Map<string, Acc>();
  const acc = (tableId: string): Acc => {
    let entry = perTable.get(tableId);
    if (!entry) {
      entry = { minutes: 0, revenue: 0, sessions: 0, frames: 0, customers: new Set() };
      perTable.set(tableId, entry);
    }
    return entry;
  };
  const hourOf = (at: number) => new Date(Math.max(at, dayStart)).getHours();

  // Whole bills settled today (not voided), including those put on a tab. A
  // manual bill for play on an earlier day adds its money today (the day it was
  // entered), but not its table time: it goes in the hour it was entered.
  for (const session of sessions) {
    if (!session.settledAt || session.voidedAt || isFrameBilled(session) || !isToday(session.settledAt)) continue;
    const totals = calculateSessionTotals(session, now);
    const pastPlay = Boolean(session.manual) && session.startedAt < dayStart;
    billCount += 1;
    totalRevenue += totals.total;
    tableRevenue += totals.tableCharge;
    kitchenRevenue += totals.kitchenTotal;
    discounts += Math.min(session.discount, totals.subtotal);
    if (!pastPlay) earliest = Math.min(earliest, session.startedAt);
    hourTotals[hourOf(pastPlay ? session.settledAt : session.startedAt)] += totals.total;
    if (!session.tabChargeId) {
      collected += totals.total;
      tender[tenderKey(session.paymentMode)] += totals.total;
    }
    for (const line of session.orders) itemUsage.set(line.name, (itemUsage.get(line.name) ?? 0) + line.quantity);
    const table = tableById.get(session.tableId);
    if (table) {
      mix.tableTime += totals.tableCharge;
      mix.dineInCafe += totals.kitchenTotal;
      const entry = acc(table.id);
      entry.revenue += totals.total;
      if (!pastPlay) {
        wholeMinutes += totals.minutes;
        wholeSittings += 1;
        entry.minutes += totals.minutes;
        entry.sessions += 1;
      }
    } else {
      takeawayRevenue += totals.total;
      takeawayOrders += 1;
      mix.takeaway += totals.kitchenTotal;
    }
  }

  // Frame and cafe charges made today. A carry charge is money already sold
  // (left over from a part payment), so it is neither sales nor new tab money.
  let toTabs = 0;
  for (const charge of charges) {
    if (charge.voidedAt || !isToday(charge.createdAt) || charge.kind === "carry") continue;
    toTabs += charge.total;
    if (charge.kind === "bill") continue;
    const cafe = chargeCafeTotal(charge);
    totalRevenue += charge.total;
    tableRevenue += charge.tableCharge;
    kitchenRevenue += cafe;
    // A manual frame charge is made when it is entered, not played: its frame
    // (frames loop below) sets the day's first activity when it was today.
    if (!charge.manual) earliest = Math.min(earliest, charge.createdAt);
    hourTotals[hourOf(charge.createdAt)] += charge.total;
    for (const item of charge.items) itemUsage.set(item.name, (itemUsage.get(item.name) ?? 0) + item.quantity);
    if (charge.tableId && tableById.has(charge.tableId)) {
      mix.tableTime += charge.tableCharge;
      mix.dineInCafe += cafe;
      acc(charge.tableId).revenue += charge.total;
    } else {
      mix.takeaway += cafe;
    }
    if (charge.kind === "frame") billCount += 1;
  }

  // Frames played today (by when they started) and who sat at each table.
  let totalFrames = 0;
  let frameSittings = 0;
  const playersToday = new Set<string>();
  for (const session of sessions) {
    if (session.voidedAt) continue;
    const table = tableById.get(session.tableId);
    for (const seat of session.seats ?? []) {
      const seatEnd = seat.leftAt ?? session.settledAt ?? now;
      if (seatEnd >= dayStart && seat.joinedAt <= now) {
        playersToday.add(seat.customerId);
        if (table) acc(table.id).customers.add(seat.customerId);
      }
    }
    if (!isFrameBilled(session) || !table) continue;
    let played = 0;
    for (const frame of session.frames ?? []) {
      if (!isToday(frame.startedAt)) continue;
      played += 1;
      earliest = Math.min(earliest, frame.startedAt);
      const entry = acc(table.id);
      entry.minutes += Math.floor((frameEnd(frame, now) - frame.startedAt) / 60000);
      entry.frames += 1;
    }
    if (played > 0) {
      totalFrames += played;
      frameSittings += 1;
      acc(table.id).sessions += 1;
    }
  }

  // Tab payments taken today. A discount given on a tab comes off today's sales.
  let tabPayments = 0;
  for (const payment of payments) {
    if (!isToday(payment.at)) continue;
    tabPayments += 1;
    collected += payment.amount;
    tender[tenderKey(payment.mode)] += payment.amount;
    const discount = payment.discount ?? 0;
    discounts += discount;
    totalRevenue -= discount;
  }

  mix.gross = mix.tableTime + mix.dineInCafe + mix.takeaway;
  const openMinutes = earliest === Infinity ? 0 : Math.max(1, Math.floor((now - Math.max(earliest, dayStart)) / 60000));

  const activeHours = hourTotals.map((total, hour) => ({ total, hour })).filter((entry) => entry.total > 0);
  const revenueByHour: HourRevenue[] = [];
  let peakHour: number | undefined;
  if (activeHours.length > 0) {
    const lo = Math.min(...activeHours.map((entry) => entry.hour));
    const hi = Math.max(...activeHours.map((entry) => entry.hour));
    for (let hour = lo; hour <= hi; hour += 1) revenueByHour.push({ hour, label: formatHour(hour), total: hourTotals[hour] });
    peakHour = revenueByHour.reduce((best, cur) => (cur.total > best.total ? cur : best)).hour;
  }

  const tablePerformance: TablePerformance[] = tables
    .map((table) => {
      const entry = perTable.get(table.id);
      return {
        id: table.id,
        name: table.name,
        game: table.game,
        type: table.type,
        minutes: entry?.minutes ?? 0,
        revenue: entry?.revenue ?? 0,
        sessions: entry?.sessions ?? 0,
        frames: entry?.frames ?? 0,
        players: entry?.customers.size ?? 0,
        utilization: openMinutes > 0 ? Math.min(1, (entry?.minutes ?? 0) / openMinutes) : 0
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.minutes - a.minutes);

  return {
    totalRevenue,
    collected,
    toTabs,
    openTabs: openTabsTotal(charges),
    tabPayments,
    tableRevenue,
    kitchenRevenue,
    discounts,
    takeawayRevenue,
    takeawayOrders,
    settledSessions: billCount,
    averageMinutes: wholeSittings ? Math.round(wholeMinutes / wholeSittings) : 0,
    itemRankings: ranked(itemUsage, 5),
    revenueByHour,
    peakHour,
    revenueMix: mix,
    tenderTotals: tender,
    tablePerformance,
    openMinutes,
    totalFrames,
    avgFrames: frameSittings ? Math.round(totalFrames / frameSittings) : 0,
    playersServed: playersToday.size
  };
}

// What a table did today, for its free-table panel.
export function getTableHistory(state: AppState, tableId: string, now: number): TableHistory {
  const dayStart = startOfDay(now);
  let sittings = 0;
  let frames = 0;
  let minutes = 0;
  let revenue = 0;
  let lastAt: number | undefined;
  for (const session of state.sessions) {
    if (session.tableId !== tableId || session.voidedAt || !session.settledAt) continue;
    // A manual bill was settled when it was entered; the table was last used when its play ended.
    lastAt = Math.max(lastAt ?? 0, session.manual ? session.endedAt ?? session.settledAt : session.settledAt);
    if (session.settledAt < dayStart) continue;
    // A manual bill for an earlier day: its money counts today, its table time does not.
    const pastPlay = Boolean(session.manual) && session.startedAt < dayStart;
    if (!pastPlay) sittings += 1;
    if (isFrameBilled(session)) {
      for (const frame of session.frames ?? []) {
        if (frame.startedAt < dayStart) continue;
        frames += 1;
        minutes += Math.floor((frameEnd(frame, now) - frame.startedAt) / 60000);
      }
    } else {
      const totals = calculateSessionTotals(session, now);
      if (!pastPlay) minutes += totals.minutes;
      revenue += totals.total;
    }
  }
  for (const charge of state.charges) {
    if (charge.tableId !== tableId || charge.voidedAt || charge.kind === "bill" || charge.createdAt < dayStart) continue;
    revenue += charge.total;
  }
  return { lastAt, today: { sittings, frames, minutes, revenue } };
}

function ranked(map: Map<string, number>, limit: number) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, value]) => ({ name, value }));
}
