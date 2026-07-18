import type { ClosedSession, HourRevenue, Metrics, PlayerTotals, RevenueMix, Session, SessionTotals, TableConfig, TablePerformance, TableHistory, TableStatus, TenderTotals } from "../types";
import { formatHour } from "./format";

export function getActiveSession(sessions: Session[], tableId: string) {
  return sessions.find((session) => session.tableId === tableId && !session.settledAt);
}

// A per-player snooker bill: the table charge is split by frames played and each
// player is settled individually. Single-payer tables, pool, and the counter
// never satisfy this and keep the original whole-bill path untouched.
export function isPerPlayer(session: Session): boolean {
  return session.splitMode === "per-player" && Array.isArray(session.players) && session.players.length > 0;
}

export function getTableStatus(session?: Session): TableStatus {
  if (!session) return "available";
  return session.endedAt ? "billing" : "running";
}

export function calculateSessionTotals(session: Session, now: number): SessionTotals {
  const end = session.endedAt ?? now;
  // Round DOWN throughout — the house never charges a customer for more time or
  // money than they used. Full completed minutes (minimum 1), the rupee floored,
  // and round-off floored to the nearest ₹5 in the customer's favour.
  const minutes = Math.max(1, Math.floor((end - session.startedAt) / 60000));
  // Integer-first so floating-point error can't knock a whole-rupee charge down.
  const tableCharge = Math.floor((minutes * session.ratePerHour) / 60);
  const kitchenTotal = session.orders.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
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

// Split an integer rupee `amount` across `weights`, summing EXACTLY to `amount`
// (largest-remainder method). Floor each share, then hand the leftover rupees to
// the largest fractional remainders — deterministic, ties broken by index. Zero
// or negative total weight (e.g. no frames yet, or everyone sat out) falls back
// to an equal split so nobody is billed a NaN.
function splitInteger(amount: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const safe = amount > 0 ? Math.floor(amount) : 0;
  let effective = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  let totalWeight = effective.reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) {
    effective = weights.map(() => 1);
    totalWeight = n;
  }
  const raw = effective.map((w) => (safe * w) / totalWeight);
  const shares = raw.map((value) => Math.floor(value));
  let leftover = safe - shares.reduce((sum, value) => sum + value, 0);
  const byRemainder = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (let k = 0; k < leftover; k += 1) {
    shares[byRemainder[k % n].index] += 1;
  }
  return shares;
}

// Per-player breakdown of a snooker bill. Table time is split by frames played
// (total frames − frames sat out); unassigned ("shared") cafe lines are split
// equally; assigned lines land on their player. Every share is a whole rupee and
// the shares reconcile exactly to the session's tableCharge and kitchenTotal.
// Discount / round-off are not applied in per-player mode (they stay a
// single-payer feature), so each player's total is their exact slice.
export function calculatePlayerBills(session: Session, now: number): PlayerTotals[] {
  const players = session.players ?? [];
  if (players.length === 0) return [];
  const totals = calculateSessionTotals(session, now);
  const frameCount = Math.max(0, Math.floor(session.frameCount ?? 0));

  // Players who checked out early keep the table-time share frozen at their leave.
  // Active players split whatever table charge is left after those frozen shares.
  const frozenTableTotal = players.reduce(
    (sum, player) => sum + (player.leftAt ? Math.max(0, Math.floor(player.frozenTableShare ?? 0)) : 0),
    0
  );
  const activeIndexes = players.map((player, index) => (player.leftAt ? -1 : index)).filter((index) => index >= 0);
  const activeFrames = activeIndexes.map((index) => {
    const player = players[index];
    return frameCount > 0 ? Math.max(0, frameCount - Math.max(0, Math.floor(player.satOutFrames))) : 0;
  });
  const remainingTable = Math.max(0, totals.tableCharge - frozenTableTotal);
  const activeTableShares = splitInteger(remainingTable, activeFrames);
  const tableShareByIndex = new Map<number, number>();
  activeIndexes.forEach((index, k) => tableShareByIndex.set(index, activeTableShares[k] ?? 0));

  // Own cafe lines stay with whoever ordered them (departed or active), computed
  // live from the orders so a leaver's items can still be assigned to them.
  // Shared (unassigned) lines are carried by the players still at the table.
  const playerIndexById = new Map(players.map((player, index) => [player.id, index]));
  const ownCafe = players.map(() => 0);
  let sharedCafe = 0;
  for (const line of session.orders) {
    const lineTotal = line.unitPrice * line.quantity;
    const owner = line.playerId != null ? playerIndexById.get(line.playerId) : undefined;
    if (owner != null) {
      ownCafe[owner] += lineTotal;
    } else {
      // Unassigned, or assigned to a player who was since removed → shared.
      sharedCafe += lineTotal;
    }
  }
  // Players who left keep the shared-cafe slice they were charged at their leave;
  // active players split whatever shared cafe is left after those frozen slices.
  const frozenSharedTotal = players.reduce(
    (sum, player) => sum + (player.leftAt ? Math.max(0, Math.floor(player.frozenSharedCafe ?? 0)) : 0),
    0
  );
  const remainingShared = Math.max(0, sharedCafe - frozenSharedTotal);
  const sharedSharesActive = splitInteger(remainingShared, activeIndexes.map(() => 1));
  const sharedShareByIndex = new Map<number, number>();
  activeIndexes.forEach((index, k) => sharedShareByIndex.set(index, sharedSharesActive[k] ?? 0));

  return players.map((player, index) => {
    const own = ownCafe[index] ?? 0;
    if (player.leftAt) {
      const tableShare = Math.max(0, Math.floor(player.frozenTableShare ?? 0));
      const sharedCafeShare = Math.max(0, Math.floor(player.frozenSharedCafe ?? 0));
      return {
        player,
        index,
        framesPlayed: Math.max(0, Math.floor(player.frozenFrames ?? 0)),
        tableShare,
        ownCafe: own,
        sharedCafeShare,
        total: tableShare + own + sharedCafeShare,
        settled: Boolean(player.settledAt),
        left: true
      };
    }
    const tableShare = tableShareByIndex.get(index) ?? 0;
    const sharedCafeShare = sharedShareByIndex.get(index) ?? 0;
    return {
      player,
      index,
      framesPlayed: frameCount > 0 ? Math.max(0, frameCount - Math.max(0, Math.floor(player.satOutFrames))) : 0,
      tableShare,
      ownCafe: own,
      sharedCafeShare,
      total: tableShare + own + sharedCafeShare,
      settled: Boolean(player.settledAt),
      left: false
    };
  });
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
      if (isPerPlayer(session)) {
        acc.frames += Math.max(0, Math.floor(session.frameCount ?? 0));
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

    if (isPerPlayer(session)) {
      // Per-player bills settle individually — credit each player's slice to the
      // mode they actually paid with, so a split table isn't lumped under one.
      perPlayerSessions += 1;
      totalFrames += Math.max(0, Math.floor(session.frameCount ?? 0));
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
