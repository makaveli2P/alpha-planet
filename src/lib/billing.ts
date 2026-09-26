import { BASE_PLAYERS } from "../data/tables";
import type { ClosedSession, FrameSummary, HourRevenue, Metrics, OrderLine, PlayerBill, PlayerTotals, RevenueMix, Session, SessionTotals, TableConfig, TablePerformance, TableHistory, TableStatus, TenderTotals } from "../types";
import { formatHour } from "./format";

export function getActiveSession(sessions: Session[], tableId: string) {
  return sessions.find((session) => session.tableId === tableId && !session.settledAt);
}

// A loser-pays snooker bill: each frame's table time (and the cafe ordered
// during it) goes on its lowest scorer's tab, and each player settles their own
// tab. Pool, the counter, single-payer tables and saved sessions from the
// retired frames-played split never satisfy this and keep the whole-bill path.
export function isFrameBilled(session: Session): boolean {
  return session.splitMode === "frames";
}

// Paid player by player — loser-pays, or a saved bill from the retired
// frames-played split. Only labels a bill paid in mixed tenders as "Split".
export function paidPerPlayer(session: Session): boolean {
  return isFrameBilled(session) || session.splitMode === "per-player";
}

export function getTableStatus(session?: Session): TableStatus {
  if (!session) return "available";
  return session.endedAt ? "billing" : "running";
}

const HOUR_MS = 3600000;
// When a session ends, an open frame shorter than this (End frame, then End
// session a few seconds later) is dropped instead of billed — the same "full
// minutes only" courtesy the whole-table bill gives.
export const MIN_BILLED_FRAME_MS = 60000;

function joinedAtOf(session: Session, player: PlayerBill): number {
  return player.joinedAt ?? session.startedAt;
}

// Players at the table at `at`: joined at or before it and not yet left.
export function headcountAt(session: Session, at: number): number {
  return (session.players ?? []).filter(
    (player) => joinedAtOf(session, player) <= at && (player.leftAt == null || at < player.leftAt)
  ).length;
}

// The table's rate at a given headcount: the snapshotted base rate covers up to
// BASE_PLAYERS, and each player above that adds the snapshotted per-player rate.
export function ratePerHourFor(session: Session, headcount: number): number {
  const extra = Math.max(0, session.extraPlayerRatePerHour ?? 0);
  return session.ratePerHour + Math.max(0, headcount - BASE_PLAYERS) * extra;
}

// Table time for [from, to), priced by the headcount at every moment: the rate
// changes the instant a player joins or leaves, and only from then on. The
// rupee is floored ONCE per frame. Integer ms × integer ₹/hr keeps the sum
// exact, so float error can't knock a whole rupee off.
function tableChargeBetween(session: Session, from: number, to: number): number {
  if (!(to > from)) return 0;
  const cuts = new Set<number>([from, to]);
  for (const player of session.players ?? []) {
    const joined = joinedAtOf(session, player);
    if (joined > from && joined < to) cuts.add(joined);
    if (player.leftAt != null && player.leftAt > from && player.leftAt < to) cuts.add(player.leftAt);
  }
  const points = Array.from(cuts).sort((a, b) => a - b);
  let rupeeMs = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    rupeeMs += (points[i + 1] - points[i]) * ratePerHourFor(session, headcountAt(session, points[i]));
  }
  return Math.floor(rupeeMs / HOUR_MS);
}

// Players at the table at any point during [from, to).
function playersDuring(session: Session, from: number, to: number): number {
  const until = Math.max(to, from + 1);
  return (session.players ?? []).filter(
    (player) => joinedAtOf(session, player) < until && (player.leftAt == null || player.leftAt > from)
  ).length;
}

export type LinePayer = { kind: "player"; playerId: string } | { kind: "frame"; frameNo: number } | { kind: "open" };

// Who pays a cafe line on a loser-pays table: the player it is assigned to;
// else the lowest scorer of the frame it was folded into; else it rides the
// open frame. A reference to a player or frame that no longer exists falls
// through, so no line is ever lost.
export function linePayer(session: Session, line: OrderLine): LinePayer {
  if (line.playerId && (session.players ?? []).some((player) => player.id === line.playerId)) {
    return { kind: "player", playerId: line.playerId };
  }
  const frameCount = session.frames?.length ?? 0;
  if (line.frameNo != null && line.frameNo >= 1 && line.frameNo <= frameCount) {
    return { kind: "frame", frameNo: line.frameNo };
  }
  return { kind: "open" };
}

// The player a cafe line is billed to, once that is decided.
export function linePayerId(session: Session, line: OrderLine): string | undefined {
  const payer = linePayer(session, line);
  if (payer.kind === "player") return payer.playerId;
  if (payer.kind === "frame") return session.frames?.[payer.frameNo - 1]?.loserId;
  return undefined;
}

// Every frame of a loser-pays table: the committed ones, then the open one.
// While the table runs the open frame always exists (it is the frame being
// played). Once the session ends it exists only while it still needs a lowest
// scorer — billable time, or cafe ordered during it or after the last frame.
export function getFrames(session: Session, now: number): FrameSummary[] {
  if (!isFrameBilled(session)) return [];
  const frames = session.frames ?? [];
  const end = session.endedAt ?? now;
  const cafeByFrame = new Map<number, number>();
  let openCafe = 0;
  for (const line of session.orders) {
    const payer = linePayer(session, line);
    const lineTotal = line.unitPrice * line.quantity;
    if (payer.kind === "frame") cafeByFrame.set(payer.frameNo, (cafeByFrame.get(payer.frameNo) ?? 0) + lineTotal);
    else if (payer.kind === "open") openCafe += lineTotal;
  }

  const summaries: FrameSummary[] = [];
  let start = session.startedAt;
  frames.forEach((frame, index) => {
    const frameEnd = Math.max(start, frame.endedAt ?? end);
    // A last frame that ends with the session gets the same courtesy as the
    // open frame: under a minute (say, after a corrected end time), no table
    // time is charged.
    const sliver = frame.endedAt == null && Boolean(session.endedAt) && frameEnd - start < MIN_BILLED_FRAME_MS;
    const tableCharge = sliver ? 0 : tableChargeBetween(session, start, frameEnd);
    const cafeTotal = cafeByFrame.get(index + 1) ?? 0;
    summaries.push({
      no: index + 1,
      startedAt: start,
      endedAt: frameEnd,
      minutes: Math.floor((frameEnd - start) / 60000),
      players: playersDuring(session, start, frameEnd),
      tableCharge,
      cafeTotal,
      total: tableCharge + cafeTotal,
      loserId: frame.loserId,
      open: false,
      awaiting: !frame.loserId
    });
    start = frameEnd;
  });

  const openEnd = Math.max(start, end);
  const openCharge = tableChargeBetween(session, start, openEnd);
  const billableTime = !session.endedAt || (openEnd - start >= MIN_BILLED_FRAME_MS && openCharge > 0);
  if (!session.endedAt || billableTime || openCafe > 0) {
    const tableCharge = billableTime ? openCharge : 0;
    summaries.push({
      no: frames.length + 1,
      startedAt: start,
      endedAt: openEnd,
      minutes: Math.floor((openEnd - start) / 60000),
      players: playersDuring(session, start, openEnd),
      tableCharge,
      cafeTotal: openCafe,
      total: tableCharge + openCafe,
      open: true,
      cafeOnly: !billableTime
    });
  }
  return summaries;
}

export function getOpenFrame(session: Session, now: number) {
  return getFrames(session, now).find((frame) => frame.open);
}

// The frame whose End frame was tapped but whose lowest scorer isn't picked.
export function getAwaitingFrame(session: Session, now: number) {
  return getFrames(session, now).find((frame) => frame.awaiting);
}

// Players who can be billed a frame that ended at `frameEnd`: not paid, and
// still at the table when it ended. When they joined is deliberately NOT
// checked — staff often type a name late, and the person still played.
export function frameCandidates(session: Session, frameEnd: number): PlayerBill[] {
  return (session.players ?? []).filter(
    (player) => !player.settledAt && (player.leftAt == null || player.leftAt >= frameEnd)
  );
}

// An ended loser-pays table with a frame (or trailing cafe) that still has no
// lowest scorer. Nobody still at the table can settle until it is billed.
export function hasPendingFrame(session: Session, now: number): boolean {
  if (!isFrameBilled(session)) return false;
  const frames = getFrames(session, now);
  return frames.some((frame) => frame.awaiting) || (Boolean(session.endedAt) && frames.some((frame) => frame.open));
}

// A player's tab stops moving on its own once they have left the table, or once
// the session has ended with every frame billed — and never while a frame they
// could still be billed is awaiting its lowest scorer. Only then can they settle.
export function isTabFinal(session: Session, player: PlayerBill, now: number): boolean {
  const awaiting = getAwaitingFrame(session, now);
  if (awaiting && frameCandidates(session, awaiting.endedAt).some((entry) => entry.id === player.id)) return false;
  if (player.leftAt) return true;
  return Boolean(session.endedAt) && !hasPendingFrame(session, now);
}

export function calculateSessionTotals(session: Session, now: number): SessionTotals {
  const end = session.endedAt ?? now;
  // Round DOWN throughout — the house never charges a customer for more time or
  // money than they used. Full completed minutes (minimum 1), the rupee floored,
  // and round-off floored to the nearest ₹5 in the customer's favour.
  const minutes = Math.max(1, Math.floor((end - session.startedAt) / 60000));
  const kitchenTotal = session.orders.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  if (isFrameBilled(session)) {
    // Loser-pays: the table charge is the sum of the frames (the open one
    // included while it counts), and there is no discount or round-off, so the
    // players' tabs reconcile exactly to the total.
    const tableCharge = getFrames(session, now).reduce((sum, frame) => sum + frame.tableCharge, 0);
    const subtotal = tableCharge + kitchenTotal;
    return { minutes, tableCharge, kitchenTotal, subtotal, afterDiscount: subtotal, roundOff: 0, total: subtotal };
  }
  // Integer-first so floating-point error can't knock a whole-rupee charge down.
  const tableCharge = Math.floor((minutes * session.ratePerHour) / 60);
  const subtotal = tableCharge + kitchenTotal;
  const afterDiscount = Math.max(0, subtotal - session.discount);
  let roundOff = 0;
  let total = afterDiscount;
  // Round down to the nearest ₹5, but never waive a whole sub-₹5 bill.
  if (session.roundOffEnabled && afterDiscount >= 5) {
    const target = Math.floor(afterDiscount / 5) * 5;
    roundOff = target - afterDiscount;
    total = target;
  }
  return { minutes, tableCharge, kitchenTotal, subtotal, afterDiscount, roundOff, total };
}

// Every player's tab on a loser-pays table: the table time and folded-in cafe
// of each frame they lost, plus the cafe lines assigned to them. The open frame
// and a frame awaiting its lowest scorer are on nobody's tab yet, so Σ tabs +
// those = session subtotal.
export function calculatePlayerBills(session: Session, now: number): PlayerTotals[] {
  if (!isFrameBilled(session)) return [];
  const players = session.players ?? [];
  const acc = players.map(() => ({ framesLost: 0, tableShare: 0, frameCafe: 0, ownCafe: 0 }));
  const indexById = new Map(players.map((player, index) => [player.id, index]));
  for (const frame of getFrames(session, now)) {
    if (frame.open || !frame.loserId) continue;
    const index = indexById.get(frame.loserId);
    if (index == null) continue;
    acc[index].framesLost += 1;
    acc[index].tableShare += frame.tableCharge;
    acc[index].frameCafe += frame.cafeTotal;
  }
  for (const line of session.orders) {
    const payer = linePayer(session, line);
    if (payer.kind !== "player") continue;
    const index = indexById.get(payer.playerId);
    if (index != null) acc[index].ownCafe += line.unitPrice * line.quantity;
  }
  return players.map((player, index) => ({
    player,
    index,
    ...acc[index],
    total: acc[index].tableShare + acc[index].frameCafe + acc[index].ownCafe,
    settled: Boolean(player.settledAt),
    left: Boolean(player.leftAt)
  }));
}

// Clamp any stored/absent payment mode down to the four tender buckets.
function tenderKey(mode: Session["paymentMode"]): keyof TenderTotals {
  return mode === "Cash" || mode === "UPI" || mode === "Card" ? mode : "Unknown";
}

export function calculateMetrics(sessions: Session[], now: number, tables: TableConfig[]): Metrics {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const dayStartMs = startOfDay.getTime();
  const todaySessions = sessions.filter((session) => session.settledAt && !session.voidedAt && session.settledAt >= dayStartMs);

  let totalRevenue = 0;
  let tableRevenue = 0;
  let kitchenRevenue = 0;
  let discounts = 0;
  let totalMinutes = 0;
  let tableSessionCount = 0;
  let takeawayRevenue = 0;
  let takeawayOrders = 0;
  let earliestStart = Infinity;
  let splitBillCount = 0;
  let totalFrames = 0;
  let playersServed = 0;
  let perPlayerSessions = 0;

  const itemUsage = new Map<string, number>();
  const hourTotals = new Array(24).fill(0) as number[];
  const tenderTotals: TenderTotals = { Cash: 0, UPI: 0, Card: 0, Unknown: 0 };
  const mix: RevenueMix = { tableTime: 0, dineInCafe: 0, takeaway: 0, gross: 0 };
  type TableAcc = { minutes: number; revenue: number; sessions: number; frames: number; players: number };
  const perTable = new Map<string, TableAcc>();

  for (const session of todaySessions) {
    const totals = calculateSessionTotals(session, now);
    totalRevenue += totals.total;
    tableRevenue += totals.tableCharge;
    kitchenRevenue += totals.kitchenTotal;
    // Count the discount that was actually applied, not a value that exceeds the bill.
    discounts += Math.min(session.discount, totals.subtotal);
    earliestStart = Math.min(earliestStart, session.startedAt);

    // Revenue is attributed to the hour the session STARTED (when the table was
    // occupied / the guest arrived), so the curve reads as the day's rhythm. An
    // overnight session that began before midnight is clamped to hour 0 so a
    // prior-day evening can't spike today's late-night bucket.
    const startHour = new Date(Math.max(session.startedAt, dayStartMs)).getHours();
    hourTotals[startHour] += totals.total;

    // Real tables vs the counter drive mutually-exclusive channels (the counter
    // never adds table time; its whole bill is takeaway) so the mix reconciles.
    const table = tables.find((entry) => entry.id === session.tableId);
    if (table) {
      totalMinutes += totals.minutes;
      tableSessionCount += 1;
      mix.tableTime += totals.tableCharge;
      mix.dineInCafe += totals.kitchenTotal;
      const acc = perTable.get(table.id) ?? { minutes: 0, revenue: 0, sessions: 0, frames: 0, players: 0 };
      acc.minutes += totals.minutes;
      acc.revenue += totals.total;
      acc.sessions += 1;
      if (isFrameBilled(session)) {
        acc.frames += session.frames?.length ?? 0;
        acc.players += session.players?.length ?? 0;
      }
      perTable.set(table.id, acc);
    } else {
      takeawayRevenue += totals.total;
      takeawayOrders += 1;
      // Gross (pre-discount) so all three channels share one basis and the mix
      // reconciles to a true gross; the counter has no table time, so its gross
      // is its kitchen subtotal.
      mix.takeaway += totals.kitchenTotal;
    }

    if (isFrameBilled(session)) {
      // Loser-pays bills settle per player — credit each player's tab to the
      // mode they actually paid with, so a split table isn't lumped under one.
      perPlayerSessions += 1;
      totalFrames += session.frames?.length ?? 0;
      playersServed += session.players?.length ?? 0;
      const modesUsed = new Set<string>();
      for (const bill of calculatePlayerBills(session, now)) {
        tenderTotals[tenderKey(bill.player.paymentMode ?? session.paymentMode)] += bill.total;
        if (bill.player.paymentMode) modesUsed.add(bill.player.paymentMode);
      }
      if (modesUsed.size > 1) splitBillCount += 1;
    } else {
      tenderTotals[tenderKey(session.paymentMode)] += totals.total;
    }

    for (const line of session.orders) {
      itemUsage.set(line.name, (itemUsage.get(line.name) ?? 0) + line.quantity);
    }
  }

  mix.gross = mix.tableTime + mix.dineInCafe + mix.takeaway;

  // "Open so far" = time since the day's first session began; the shared
  // denominator makes per-table utilization comparable across tables. Clamp to
  // midnight so an overnight session that STARTED yesterday (but settled today)
  // can't stretch the denominator across a prior day and crush every bar.
  const openMinutes = earliestStart === Infinity ? 0 : Math.max(1, Math.floor((now - Math.max(earliestStart, dayStartMs)) / 60000));

  // Money curve across only the hours that saw business, gaps filled with zero
  // so the area has a continuous baseline; the peak hour is direct-labeled.
  const activeHours = hourTotals.map((total, hour) => ({ total, hour })).filter((entry) => entry.total > 0);
  let revenueByHour: HourRevenue[] = [];
  let peakHour: number | undefined;
  if (activeHours.length > 0) {
    const lo = Math.min(...activeHours.map((entry) => entry.hour));
    const hi = Math.max(...activeHours.map((entry) => entry.hour));
    for (let hour = lo; hour <= hi; hour += 1) {
      revenueByHour.push({ hour, label: formatHour(hour), total: hourTotals[hour] });
    }
    peakHour = revenueByHour.reduce((best, cur) => (cur.total > best.total ? cur : best)).hour;
  }

  // Every real table, busiest first, so an idle high-tier table is visibly empty
  // at the bottom rather than silently omitted.
  const tablePerformance: TablePerformance[] = tables
    .map((table) => {
      const acc = perTable.get(table.id);
      return {
        id: table.id,
        name: table.name,
        game: table.game,
        type: table.type,
        minutes: acc?.minutes ?? 0,
        revenue: acc?.revenue ?? 0,
        sessions: acc?.sessions ?? 0,
        frames: acc?.frames ?? 0,
        players: acc?.players ?? 0,
        utilization: openMinutes > 0 ? Math.min(1, (acc?.minutes ?? 0) / openMinutes) : 0
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.minutes - a.minutes);

  return {
    totalRevenue,
    tableRevenue,
    kitchenRevenue,
    discounts,
    takeawayRevenue,
    takeawayOrders,
    settledSessions: todaySessions.length,
    averageMinutes: tableSessionCount ? Math.round(totalMinutes / tableSessionCount) : 0,
    itemRankings: ranked(itemUsage, 5),
    revenueByHour,
    peakHour,
    revenueMix: mix,
    tenderTotals,
    splitBillCount,
    tablePerformance,
    openMinutes,
    totalFrames,
    avgFrames: perPlayerSessions ? Math.round(totalFrames / perPlayerSessions) : 0,
    playersServed
  };
}

export function getTableHistory(sessions: Session[], tableId: string, now: number): TableHistory {
  const closed = sessions.filter(
    (session): session is ClosedSession =>
      session.tableId === tableId && Boolean(session.settledAt) && !session.voidedAt
  );
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const todayClosed = closed.filter((session) => session.settledAt >= startOfDay.getTime());
  const last = closed.slice().sort((a, b) => b.settledAt - a.settledAt)[0];
  const lastTotals = last ? calculateSessionTotals(last, now) : undefined;
  const todayTotals = todayClosed.reduce(
    (acc, session) => {
      const totals = calculateSessionTotals(session, now);
      return {
        count: acc.count + 1,
        minutes: acc.minutes + totals.minutes,
        revenue: acc.revenue + totals.total
      };
    },
    { count: 0, minutes: 0, revenue: 0 }
  );
  return { last, lastTotals, today: todayTotals };
}

function ranked(map: Map<string, number>, limit: number) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, value]) => ({ name, value }));
}
