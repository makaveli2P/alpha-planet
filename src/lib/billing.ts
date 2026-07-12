import type { ClosedSession, Metrics, Session, SessionTotals, TableConfig, TableHistory, TableStatus } from "../types";
import { formatHour, formatMoney } from "./format";

export function getActiveSession(sessions: Session[], tableId: string) {
  return sessions.find((session) => session.tableId === tableId && !session.settledAt);
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

export function calculateMetrics(sessions: Session[], now: number, tables: TableConfig[]): Metrics {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const todaySessions = sessions.filter((session) => session.settledAt && !session.voidedAt && session.settledAt >= startOfDay.getTime());

  let totalRevenue = 0;
  let tableRevenue = 0;
  let kitchenRevenue = 0;
  let discounts = 0;
  let totalMinutes = 0;
  let tableSessionCount = 0;
  let takeawayRevenue = 0;
  let takeawayOrders = 0;
  const tableUsage = new Map<string, number>();
  const itemUsage = new Map<string, number>();
  const hourUsage = new Map<string, number>();
  const paymentModes = new Map<string, number>();

  for (const session of todaySessions) {
    const totals = calculateSessionTotals(session, now);
    totalRevenue += totals.total;
    tableRevenue += totals.tableCharge;
    kitchenRevenue += totals.kitchenTotal;
    // Count the discount that was actually applied, not a value that exceeds the bill.
    discounts += Math.min(session.discount, totals.subtotal);
    // Table time and the "most sought tables" ranking only apply to real tables;
    // kitchen/takeaway orders are tracked as their own revenue channel instead.
    const table = tables.find((entry) => entry.id === session.tableId);
    if (table) {
      totalMinutes += totals.minutes;
      tableSessionCount += 1;
      tableUsage.set(table.name, (tableUsage.get(table.name) ?? 0) + totals.minutes);
    } else {
      takeawayRevenue += totals.total;
      takeawayOrders += 1;
    }
    paymentModes.set(session.paymentMode ?? "Unknown", (paymentModes.get(session.paymentMode ?? "Unknown") ?? 0) + totals.total);

    const startHour = new Date(session.startedAt).getHours();
    hourUsage.set(`${formatHour(startHour)}`, (hourUsage.get(`${formatHour(startHour)}`) ?? 0) + 1);

    for (const line of session.orders) {
      itemUsage.set(line.name, (itemUsage.get(line.name) ?? 0) + line.quantity);
    }
  }

  return {
    totalRevenue,
    tableRevenue,
    kitchenRevenue,
    discounts,
    takeawayRevenue,
    takeawayOrders,
    settledSessions: todaySessions.length,
    averageMinutes: tableSessionCount ? Math.round(totalMinutes / tableSessionCount) : 0,
    tableRankings: ranked(tableUsage, 5),
    itemRankings: ranked(itemUsage, 5),
    peakHours: ranked(hourUsage, 5),
    paymentModes: ranked(paymentModes, 5).map((entry) => ({ ...entry, value: formatMoney(Number(entry.value)) }))
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
