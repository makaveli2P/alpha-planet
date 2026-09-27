import type { AppState, Charge, ChargeItem, Customer, OrderLine, PaymentMode, Payment, Session, TableConfig } from "../types";
import {
  awaitingFrame,
  calculateSessionTotals,
  frameCandidates,
  frameTableCharge,
  getActiveSession,
  isFrameBilled,
  isOpenCharge,
  playersDuring,
  runningFrame,
  seatOf,
  seatedNow
} from "./billing";
import { findByPhone, isValidPhone, normalizePhone } from "./customers";
import { businessDayStart } from "./format";
import { MAX_SEATED, MISTAKE_WINDOW_MS, createCounterOrder, createSitting, isMistakenSeat, startWholeTable } from "./sessionActions";

// App-level actions: each one changes sittings, the registry and the tabs
// together in ONE state update, so no half-done money state is ever saved.
// Every action is a pure function that returns the old state unchanged when
// it does not apply (a double tap is harmless).

export type MakeId = () => string;

export function withSession(state: AppState, sessionId: string, fn: (session: Session) => Session): AppState {
  return { ...state, sessions: state.sessions.map((session) => (session.id === sessionId ? fn(session) : session)) };
}

export function tableNameOf(state: AppState, tableId: string): string {
  return state.tables.find((table) => table.id === tableId)?.name ?? (tableId === "counter" ? "Cafe" : tableId);
}

export function toItems(lines: OrderLine[]): ChargeItem[] {
  return lines.map((line) => ({ name: line.name, variant: line.variant, unitPrice: line.unitPrice, quantity: line.quantity }));
}

export function itemsTotal(items: ChargeItem[]): number {
  return items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

// ====== Registry ======

export type CustomerInput = { name: string; phone?: string };

// Why a name/phone can't be saved, or undefined when it can.
export function customerInputError(state: AppState, input: CustomerInput, exceptId?: string): string | undefined {
  if (!input.name.trim()) return "Enter a name.";
  if (input.phone && input.phone.trim()) {
    if (!isValidPhone(input.phone)) return "Enter a phone number with 7 to 15 digits.";
    const owner = findByPhone(state.customers, input.phone, exceptId);
    if (owner) return `This phone belongs to ${owner.name}.`;
  }
  return undefined;
}

export function addCustomer(state: AppState, input: CustomerInput, now: number, makeId: MakeId): { state: AppState; customer?: Customer } {
  if (customerInputError(state, input)) return { state };
  const phone = input.phone ? normalizePhone(input.phone) : "";
  const customer: Customer = { id: makeId(), name: input.name.trim(), phone: phone || undefined, createdAt: now };
  return { state: { ...state, customers: [...state.customers, customer] }, customer };
}

// Naming a guest (or giving them a phone) makes them a regular customer.
export function editCustomer(state: AppState, id: string, input: CustomerInput): AppState {
  if (customerInputError(state, input, id)) return state;
  const phone = input.phone ? normalizePhone(input.phone) : "";
  return {
    ...state,
    customers: state.customers.map((customer) => {
      if (customer.id !== id) return customer;
      const name = input.name.trim();
      const stillGuest = customer.guest && name === customer.name && !phone;
      return { ...customer, name, phone: phone || undefined, guest: stillGuest ? true : undefined };
    })
  };
}

// ====== Seating ======

// The table's sitting, opened (loser-pays, bills nothing yet) when there is none.
function ensureSitting(state: AppState, table: TableConfig, now: number, makeId: MakeId): { state: AppState; session: Session } {
  const active = getActiveSession(state.sessions, table.id);
  if (active) return { state, session: active };
  const session = createSitting(table, now, makeId());
  return { state: { ...state, sessions: [session, ...state.sessions] }, session };
}

// A customer seated at another table can move here unless they are in a frame
// there (running, or ended and waiting for its lowest scorer).
export function movableFrom(state: AppState, customerId: string): { session: Session; seatId: string } | undefined {
  const where = seatOf(state.sessions, customerId);
  if (!where) return undefined;
  const { session, seat } = where;
  if (isFrameBilled(session)) {
    const busy = [runningFrame(session), awaitingFrame(session)].some((frame) => frame && seat.joinedAt <= (frame.endedAt ?? Infinity));
    if (busy) return undefined;
  } else if (session.endedAt) {
    return undefined; // their whole bill is waiting for payment
  } else {
    return undefined; // on a running whole-table clock
  }
  return { session, seatId: seat.id };
}

// Why a customer can't be seated at this table, or undefined when they can.
// A customer who can move here from an idle table is allowed (see seatCustomer).
export function seatError(state: AppState, table: TableConfig, customerId: string): string | undefined {
  const where = seatOf(state.sessions, customerId);
  if (where) {
    if (where.session.tableId === table.id) return "Already at this table.";
    if (!movableFrom(state, customerId)) return `Playing at ${tableNameOf(state, where.session.tableId)}.`;
  }
  const active = getActiveSession(state.sessions, table.id);
  if (active && !isFrameBilled(active) && active.endedAt) return "This bill has ended.";
  if (active && seatedNow(active).length >= MAX_SEATED) return `The table is full (${MAX_SEATED}).`;
  return undefined;
}

export function seatCustomer(state: AppState, table: TableConfig, customerId: string, now: number, makeId: MakeId): AppState {
  if (table.id === "counter" || !state.customers.some((customer) => customer.id === customerId)) return state;
  if (seatError(state, table, customerId)) return state;
  // Seated at an idle table elsewhere: they leave it and sit here.
  const from = movableFrom(state, customerId);
  if (from) state = unseat(state, from.session.id, from.seatId, now, { keepCustomer: true });
  const opened = ensureSitting(state, table, now, makeId);
  return withSession(opened.state, opened.session.id, (session) => ({
    ...session,
    seats: [...(session.seats ?? []), { id: makeId(), customerId, joinedAt: now }]
  }));
}

// Seat someone new: they join the registry (name, optional phone) and the table.
export function seatNewCustomer(state: AppState, table: TableConfig, input: CustomerInput, now: number, makeId: MakeId): AppState {
  const added = addCustomer(state, input, now, makeId);
  if (!added.customer) return state;
  const seated = seatCustomer(added.state, table, added.customer.id, now, makeId);
  return seated === added.state ? state : seated;
}

// The lowest "Player N" no guest seat of this sitting has used — counting
// players who already left, so one sitting never has two "Player 1"s.
export function nextGuestName(state: AppState, tableId: string): string {
  const active = getActiveSession(state.sessions, tableId);
  const used = new Set<number>();
  for (const seat of active?.seats ?? []) {
    const customer = state.customers.find((entry) => entry.id === seat.customerId);
    const match = customer ? customer.name.match(/^Player (\d+)$/) : null;
    if (match) used.add(Number(match[1]));
  }
  let n = 1;
  while (used.has(n)) n += 1;
  return `Player ${n}`;
}

export function seatGuest(state: AppState, table: TableConfig, now: number, makeId: MakeId): AppState {
  if (table.id === "counter") return state;
  const active = getActiveSession(state.sessions, table.id);
  if (active && seatedNow(active).length >= MAX_SEATED) return state;
  if (active && !isFrameBilled(active) && active.endedAt) return state;
  const guest: Customer = { id: makeId(), name: nextGuestName(state, table.id), guest: true, createdAt: now };
  return seatCustomer({ ...state, customers: [...state.customers, guest] }, table, guest.id, now, makeId);
}

// A customer made by mistake together with this seat a moment ago (typed at
// the table, or a guest), never charged or seated anywhere else. A record made
// on the Customers page is never thrown away.
function isThrowawayCustomer(state: AppState, customerId: string, seatJoinedAt: number, now: number): boolean {
  const customer = state.customers.find((entry) => entry.id === customerId);
  if (!customer || customer.createdAt !== seatJoinedAt || now - customer.createdAt >= MISTAKE_WINDOW_MS) return false;
  if (state.charges.some((charge) => charge.customerId === customerId)) return false;
  const seats = state.sessions.flatMap((session) => session.seats ?? []).filter((seat) => seat.customerId === customerId);
  return seats.length <= 1;
}

// A loser-pays sitting with nobody left, nothing running and an empty tab
// closes itself. One that never played a frame and never had anyone kept on
// record (only mis-entries) disappears instead.
function autoClose(state: AppState, sessionId: string, now: number): AppState {
  const session = state.sessions.find((entry) => entry.id === sessionId);
  if (!session || session.settledAt || !isFrameBilled(session)) return state;
  if (seatedNow(session).length > 0 || runningFrame(session) || awaitingFrame(session) || session.orders.length > 0) return state;
  if ((session.frames ?? []).length === 0 && (session.seats ?? []).length === 0) {
    return { ...state, sessions: state.sessions.filter((entry) => entry.id !== sessionId) };
  }
  return withSession(state, sessionId, (entry) => ({ ...entry, endedAt: now, settledAt: now }));
}

// Take a player off the table. Their tab stays with them. Mid-frame they leave
// the frame: the rate drops from now and they can't be its lowest scorer. A
// mis-entry (seconds old, nothing billed) is deleted, with the customer record
// too if it was only just made.
// Why a player can't leave the table right now, or undefined when they can.
// The last player in a running frame stays: the frame would have nobody to
// bill. (During a frame that has ended, leaving is fine — they stay in the
// who-lost picker.)
export function leaveError(session: Session, seatId: string): string | undefined {
  const frame = runningFrame(session);
  if (!frame) return undefined;
  const others = seatedNow(session).filter((seat) => seat.id !== seatId);
  const no = (session.frames ?? []).indexOf(frame) + 1;
  return others.length === 0 ? `End or cancel frame ${no} first.` : undefined;
}

export function unseat(
  state: AppState,
  sessionId: string,
  seatId: string,
  now: number,
  options: { keepCustomer?: boolean } = {}
): AppState {
  const session = state.sessions.find((entry) => entry.id === sessionId);
  const seat = session?.seats?.find((entry) => entry.id === seatId);
  if (!session || !seat || seat.leftAt != null || session.settledAt) return state;
  if (leaveError(session, seatId)) return state;
  let next: AppState;
  if (isMistakenSeat(session, seatId, now)) {
    const throwaway = !options.keepCustomer && isThrowawayCustomer(state, seat.customerId, seat.joinedAt, now);
    next = withSession(state, sessionId, (entry) => ({ ...entry, seats: (entry.seats ?? []).filter((item) => item.id !== seatId) }));
    if (throwaway) next = { ...next, customers: next.customers.filter((customer) => customer.id !== seat.customerId) };
  } else {
    next = withSession(state, sessionId, (entry) => ({
      ...entry,
      seats: (entry.seats ?? []).map((item) => (item.id === seatId ? { ...item, leftAt: now } : item))
    }));
  }
  return autoClose(next, sessionId, now);
}

export function sendAway(state: AppState, customerId: string, now: number): AppState {
  const where = seatOf(state.sessions, customerId);
  return where ? unseat(state, where.session.id, where.seat.id, now) : state;
}

// Start the whole-table clock, opening the sitting if the table is free.
export function startClock(state: AppState, table: TableConfig, now: number, makeId: MakeId): AppState {
  if (table.id === "counter") return state;
  const opened = ensureSitting(state, table, now, makeId);
  return withSession(opened.state, opened.session.id, (session) => startWholeTable(session, now));
}

export function startCounterOrder(state: AppState, now: number, makeId: MakeId): AppState {
  if (getActiveSession(state.sessions, "counter")) return state;
  return { ...state, sessions: [createCounterOrder("counter", now, makeId()), ...state.sessions] };
}

// Apply a sitting-level helper to the table's active sitting (if any).
export function updateActive(state: AppState, tableId: string, fn: (session: Session) => Session): AppState {
  const active = getActiveSession(state.sessions, tableId);
  return active ? withSession(state, active.id, fn) : state;
}

// ====== Frames and the table tab ======

// Bill the frame that ended to its lowest scorer: its table time plus the table
// tab go on their tab as one charge, and the table tab clears.
export function billFrame(state: AppState, sessionId: string, seatId: string, now: number, makeId: MakeId): AppState {
  const session = state.sessions.find((entry) => entry.id === sessionId);
  if (!session || session.settledAt || !isFrameBilled(session)) return state;
  const frame = awaitingFrame(session);
  if (!frame) return state;
  const seat = frameCandidates(session, frame, now).find((entry) => entry.id === seatId);
  if (!seat) return state;
  const frameNo = (session.frames ?? []).findIndex((entry) => entry.id === frame.id) + 1;
  const end = frame.endedAt as number;
  const tableCharge = frameTableCharge(session, frame, now);
  const items = toItems(session.orders);
  const charge: Charge = {
    id: makeId(),
    customerId: seat.customerId,
    createdAt: now,
    kind: "frame",
    sessionId,
    tableId: session.tableId,
    tableName: tableNameOf(state, session.tableId),
    frameNo,
    minutes: Math.floor((end - frame.startedAt) / 60000),
    players: playersDuring(session, frame.startedAt, end),
    tableCharge,
    items,
    total: tableCharge + itemsTotal(items)
  };
  const next = withSession(state, sessionId, (entry) => ({
    ...entry,
    orders: [],
    frames: (entry.frames ?? []).map((item) => (item.id === frame.id ? { ...item, chargeId: charge.id } : item))
  }));
  // Everyone left while the frame waited: the table frees itself.
  return autoClose({ ...next, charges: [...next.charges, charge] }, sessionId, now);
}

// Correct a billed frame's lowest scorer while the charge is still unpaid.
export function reassignFrame(state: AppState, sessionId: string, frameId: string, seatId: string, now: number): AppState {
  const session = state.sessions.find((entry) => entry.id === sessionId);
  const frame = session?.frames?.find((entry) => entry.id === frameId);
  const charge = frame?.chargeId ? state.charges.find((entry) => entry.id === frame.chargeId) : undefined;
  if (!session || !frame || !charge || !isOpenCharge(charge)) return state;
  const seat = frameCandidates(session, frame, now).find((entry) => entry.id === seatId);
  if (!seat || seat.customerId === charge.customerId) return state;
  return { ...state, charges: state.charges.map((entry) => (entry.id === charge.id ? { ...entry, customerId: seat.customerId } : entry)) };
}

// Charge one unit of a table-tab line straight to one player (their own
// order); it joins their open cafe charge from this sitting. Without `lineId`,
// the whole table tab goes to them (used before closing the table).
export function chargeTabTo(state: AppState, sessionId: string, seatId: string, now: number, makeId: MakeId, lineId?: string): AppState {
  const session = state.sessions.find((entry) => entry.id === sessionId);
  if (!session || session.settledAt || !isFrameBilled(session)) return state;
  const seat = session.seats?.find((entry) => entry.id === seatId);
  if (!seat) return state;
  let moving: OrderLine[];
  let orders: OrderLine[];
  if (lineId) {
    const line = session.orders.find((entry) => entry.lineId === lineId);
    if (!line) return state;
    moving = [{ ...line, quantity: 1 }];
    orders = session.orders
      .map((entry) => (entry.lineId === lineId ? { ...entry, quantity: entry.quantity - 1 } : entry))
      .filter((entry) => entry.quantity > 0);
  } else {
    if (session.orders.length === 0) return state;
    moving = session.orders;
    orders = [];
  }
  // Join their open cafe charge from this sitting — but only within the same
  // business day, so a unit charged after 6 AM counts in the new day's sales.
  const dayStart = businessDayStart(now);
  const existing = state.charges.find(
    (charge) =>
      charge.kind === "cafe" &&
      charge.sessionId === sessionId &&
      charge.customerId === seat.customerId &&
      isOpenCharge(charge) &&
      businessDayStart(charge.createdAt) === dayStart
  );
  let charges: Charge[];
  if (existing) {
    const items = [...existing.items];
    for (const add of toItems(moving)) {
      const index = items.findIndex((item) => item.name === add.name && item.variant === add.variant && item.unitPrice === add.unitPrice);
      if (index >= 0) items[index] = { ...items[index], quantity: items[index].quantity + add.quantity };
      else items.push(add);
    }
    charges = state.charges.map((charge) => (charge.id === existing.id ? { ...charge, items, total: itemsTotal(items) } : charge));
  } else {
    const items = toItems(moving);
    charges = [
      ...state.charges,
      {
        id: makeId(),
        customerId: seat.customerId,
        createdAt: now,
        kind: "cafe",
        sessionId,
        tableId: session.tableId,
        tableName: tableNameOf(state, session.tableId),
        tableCharge: 0,
        items,
        total: itemsTotal(items)
      }
    ];
  }
  const next = withSession({ ...state, charges }, sessionId, (entry) => ({ ...entry, orders }));
  return autoClose(next, sessionId, now);
}

// Why a loser-pays table can't close yet, or undefined when it can.
export function closeSittingError(session: Session): string | undefined {
  if (runningFrame(session)) return "End the frame first.";
  if (awaitingFrame(session)) return "Pick the loser of the last frame first.";
  if (session.orders.length > 0) return "Charge the table order to a player first.";
  return undefined;
}

// Close a loser-pays table: everyone leaves; the money is already on tabs.
export function closeSitting(state: AppState, sessionId: string, now: number): AppState {
  const session = state.sessions.find((entry) => entry.id === sessionId);
  if (!session || session.settledAt || !isFrameBilled(session) || closeSittingError(session)) return state;
  return withSession(state, sessionId, (entry) => ({
    ...entry,
    seats: (entry.seats ?? []).map((seat) => (seat.leftAt == null ? { ...seat, leftAt: now } : seat)),
    endedAt: now,
    settledAt: now
  }));
}

// ====== Whole bills on a tab ======

// Put an ended whole bill (or a counter order) on a customer's tab instead of
// taking payment now. The sitting closes; the money waits on the tab.
export function putBillOnTab(state: AppState, sessionId: string, customerId: string, now: number, makeId: MakeId): AppState {
  const session = state.sessions.find((entry) => entry.id === sessionId);
  if (!session || session.settledAt || isFrameBilled(session) || !session.endedAt) return state;
  if (!state.customers.some((customer) => customer.id === customerId)) return state;
  const totals = calculateSessionTotals(session, now);
  if (totals.total <= 0) return state;
  const charge: Charge = {
    id: makeId(),
    customerId,
    createdAt: now,
    kind: "bill",
    sessionId,
    tableId: session.tableId,
    tableName: tableNameOf(state, session.tableId),
    minutes: session.tableId === "counter" ? undefined : totals.minutes,
    tableCharge: totals.tableCharge,
    items: toItems(session.orders),
    adjust: totals.total - totals.subtotal,
    total: totals.total
  };
  const next = withSession(state, sessionId, (entry) => ({
    ...entry,
    tabChargeId: charge.id,
    paymentMode: undefined,
    settledAt: now,
    seats: (entry.seats ?? []).map((seat) => (seat.leftAt == null ? { ...seat, leftAt: now } : seat))
  }));
  return { ...next, charges: [...next.charges, charge] };
}

// A walk-in who wants the bill on a tab: add them to the registry and put the
// bill on their tab in the same update.
export function putBillOnNewTab(state: AppState, sessionId: string, input: CustomerInput, now: number, makeId: MakeId): AppState {
  const added = addCustomer(state, input, now, makeId);
  if (!added.customer) return state;
  const next = putBillOnTab(added.state, sessionId, added.customer.id, now, makeId);
  return next === added.state ? state : next;
}

// ====== Settling tabs ======

export type PayInput = { mode: PaymentMode; discount?: number; received?: number };

// Take payment for exactly these charges (the ones staff saw and ticked). A
// charge paid, voided or not on this customer's tab is skipped. `discount` is
// let off; `received` defaults to the rest. If less is received, the shortfall
// stays on the tab as one "carry" charge.
export function settleTab(
  state: AppState,
  customerId: string,
  chargeIds: string[],
  input: PayInput,
  now: number,
  makeId: MakeId
): { state: AppState; payment?: Payment } {
  if (payBlockedReason(state, customerId, now)) return { state };
  const wanted = new Set(chargeIds);
  const paying = state.charges.filter((charge) => wanted.has(charge.id) && charge.customerId === customerId && isOpenCharge(charge));
  if (paying.length === 0) return { state };
  const total = paying.reduce((sum, charge) => sum + charge.total, 0);
  const discount = Math.min(total, Math.max(0, Math.floor(Number.isFinite(input.discount) ? (input.discount as number) : 0)));
  const due = total - discount;
  const received = Math.min(due, Math.max(0, Math.floor(input.received != null && Number.isFinite(input.received) ? input.received : due)));
  if (received + discount <= 0) return { state };
  const paymentId = makeId();
  const carry: Charge | undefined =
    due - received > 0
      ? {
          id: makeId(),
          customerId,
          createdAt: now,
          kind: "carry",
          tableName: "Carried from a part payment",
          tableCharge: 0,
          items: [],
          total: due - received,
          fromPaymentId: paymentId
        }
      : undefined;
  const payment: Payment = {
    id: paymentId,
    customerId,
    at: now,
    mode: input.mode,
    amount: received,
    discount,
    chargeIds: paying.map((charge) => charge.id),
    carryChargeId: carry?.id
  };
  const paid = new Set(payment.chargeIds);
  const charges = state.charges.map((charge) => (paid.has(charge.id) ? { ...charge, paymentId } : charge));
  return {
    state: { ...state, payments: [...state.payments, payment], charges: carry ? [...charges, carry] : charges },
    payment
  };
}

// Undo a payment taken by mistake: its charges go back on the tab and its carry
// charge goes away. Not once that carry charge has itself been paid.
export function undoPayment(state: AppState, paymentId: string): AppState {
  const payment = state.payments.find((entry) => entry.id === paymentId);
  if (!payment) return state;
  const carry = payment.carryChargeId ? state.charges.find((charge) => charge.id === payment.carryChargeId) : undefined;
  if (carry?.paymentId) return state;
  return {
    ...state,
    payments: state.payments.filter((entry) => entry.id !== paymentId),
    charges: state.charges
      .filter((charge) => charge.id !== payment.carryChargeId)
      .map((charge) => (charge.paymentId === paymentId ? { ...charge, paymentId: undefined } : charge))
  };
}

// Move an unpaid charge to another customer (charged to the wrong person).
export function moveCharge(state: AppState, chargeId: string, customerId: string): AppState {
  const charge = state.charges.find((entry) => entry.id === chargeId);
  if (!charge || !isOpenCharge(charge) || charge.customerId === customerId) return state;
  if (!state.customers.some((customer) => customer.id === customerId)) return state;
  return { ...state, charges: state.charges.map((entry) => (entry.id === chargeId ? { ...entry, customerId } : entry)) };
}

// Merge a duplicate record into another: charges, payments and seats move over
// and the duplicate is removed. Not while the duplicate is seated somewhere.
export function mergeCustomers(state: AppState, fromId: string, intoId: string): AppState {
  if (fromId === intoId) return state;
  const from = state.customers.find((customer) => customer.id === fromId);
  const into = state.customers.find((customer) => customer.id === intoId);
  if (!from || !into || seatOf(state.sessions, fromId)) return state;
  const survivor = (customer: Customer): Customer => {
    if (customer.id !== intoId) return customer;
    if (customer.guest && !from.guest) return { ...customer, name: from.name, phone: customer.phone ?? from.phone, guest: undefined };
    return !customer.phone && from.phone ? { ...customer, phone: from.phone } : customer;
  };
  return {
    ...state,
    customers: state.customers.filter((customer) => customer.id !== fromId).map(survivor),
    charges: state.charges.map((charge) => (charge.customerId === fromId ? { ...charge, customerId: intoId } : charge)),
    payments: state.payments.map((payment) => (payment.customerId === fromId ? { ...payment, customerId: intoId } : payment)),
    sessions: state.sessions.map((session) =>
      session.seats?.some((seat) => seat.customerId === fromId)
        ? { ...session, seats: session.seats.map((seat) => (seat.customerId === fromId ? { ...seat, customerId: intoId } : seat)) }
        : session
    )
  };
}

// Pay is held back while a frame this customer could still lose waits for its
// lowest scorer — at any table, whether they are still seated or already left
// (a player who left after the frame ended stays in its who-lost picker).
export function payBlockedReason(state: AppState, customerId: string, now: number): string | undefined {
  for (const session of state.sessions) {
    if (session.settledAt || !isFrameBilled(session)) continue;
    const frame = awaitingFrame(session);
    if (!frame || !frameCandidates(session, frame, now).some((seat) => seat.customerId === customerId)) continue;
    const no = (session.frames ?? []).indexOf(frame) + 1;
    return `Pick the loser of frame ${no} on ${tableNameOf(state, session.tableId)} first.`;
  }
  return undefined;
}

// Void an unpaid charge (a mistake). Voiding a whole bill that was put on a tab
// voids that bill too, so it leaves the day's sales as well.
export function voidCharge(state: AppState, chargeId: string, now: number): AppState {
  const charge = state.charges.find((entry) => entry.id === chargeId);
  // A carried-over balance is money already sold: to let it off, pay it with a
  // discount, so the write-off is recorded (voiding would hide it).
  if (!charge || !isOpenCharge(charge) || charge.kind === "carry") return state;
  let next: AppState = { ...state, charges: state.charges.map((entry) => (entry.id === chargeId ? { ...entry, voidedAt: now } : entry)) };
  if (charge.kind === "bill" && charge.sessionId) {
    next = withSession(next, charge.sessionId, (session) => (session.tabChargeId === chargeId ? { ...session, voidedAt: now } : session));
  }
  return next;
}
