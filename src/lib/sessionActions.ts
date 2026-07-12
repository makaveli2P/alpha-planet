import type { MenuItem, PaymentMode, Session, TableConfig } from "../types";

type PriceOption = MenuItem["prices"][number];

export function createSession(table: TableConfig, now: number, id: string): Session {
  return {
    id,
    tableId: table.id,
    startedAt: now,
    ratePerHour: table.ratePerHour,
    orders: [],
    discount: 0
  };
}

// A counter/takeaway order: kitchen items only, no table and no running clock.
// It opens already "ended" so there is no timer, no table charge, and it can be
// settled straight away.
export function createCounterOrder(tableId: string, now: number, id: string): Session {
  return {
    id,
    tableId,
    startedAt: now,
    endedAt: now,
    ratePerHour: 0,
    orders: [],
    discount: 0
  };
}

export function addOrderToSession(
  session: Session,
  menuItem: MenuItem,
  price: PriceOption,
  createLineId: () => string
): Session {
  const existing = session.orders.find((line) => line.itemId === menuItem.id && line.variant === price.label);
  const orders = existing
    ? session.orders.map((line) =>
        line.lineId === existing.lineId ? { ...line, quantity: line.quantity + 1 } : line
      )
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
  return {
    ...session,
    orders: session.orders
      .map((line) => (line.lineId === lineId ? { ...line, quantity: line.quantity + delta } : line))
      .filter((line) => line.quantity > 0)
  };
}

export function markSessionEnded(session: Session, now: number): Session {
  if (session.endedAt) return session;
  return { ...session, endedAt: now };
}

export function reopenEndedSession(session: Session, now: number): Session {
  if (!session.endedAt) return session;
  const pausedMs = now - session.endedAt;
  // Back to Running: clear any discount/round-off set while ended so it can't
  // silently ride a live bill (adjustments only apply after End).
  return {
    ...session,
    startedAt: session.startedAt + pausedMs,
    endedAt: undefined,
    discount: 0,
    roundOffEnabled: false
  };
}

export function settleEndedSession(session: Session, paymentMode: PaymentMode, now: number): Session {
  if (!session.endedAt) return session;
  return {
    ...session,
    paymentMode,
    settledAt: now
  };
}

export function voidCurrentSession(session: Session, now: number): Session {
  return {
    ...session,
    endedAt: session.endedAt ?? now,
    voidedAt: now,
    settledAt: now
  };
}

export function setSessionDiscount(session: Session, value: number): Session {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  return { ...session, discount: safe };
}

export function setSessionName(session: Session, name: string): Session {
  return { ...session, customerName: name.trim() ? name : undefined };
}

// Correct the recorded start time at billing (e.g. no one was at the counter to
// start it on time). Kept at or before the end so duration can't go negative.
export function setSessionStart(session: Session, startedAt: number, now: number): Session {
  if (!Number.isFinite(startedAt)) return session;
  const end = session.endedAt ?? now;
  return { ...session, startedAt: Math.min(startedAt, end) };
}

// Correct the end time (e.g. they stopped playing but stayed for food). Clamped
// between the start and now — you can't end in the future.
export function setSessionEnd(session: Session, endedAt: number, now: number): Session {
  if (!session.endedAt || !Number.isFinite(endedAt)) return session;
  return { ...session, endedAt: Math.max(session.startedAt, Math.min(endedAt, now)) };
}

export function toggleSessionRoundOff(session: Session): Session {
  return { ...session, roundOffEnabled: !session.roundOffEnabled };
}
