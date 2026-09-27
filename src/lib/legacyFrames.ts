import { BASE_PLAYERS } from "../data/tables";
import type { Charge, ChargeItem, Customer, Frame, OrderLine, PaymentMode, Payment, Seat, Session } from "../types";

// The v1 loser-pays model (continuous frames, per-player settlement), kept ONLY
// so the storage migration can turn saved v1 sittings into v2 tab records with
// the exact amounts v1 billed. App code never calls this.

type V1Player = { id: string; name?: string; joinedAt?: number; leftAt?: number; paymentMode?: PaymentMode; settledAt?: number };
type V1Frame = { endedAt?: number; loserId?: string };
type V1Line = OrderLine & { playerId?: string; frameNo?: number };
export type V1FramesSession = Omit<Session, "orders" | "frames" | "seats"> & {
  players?: V1Player[];
  frames?: V1Frame[];
  orders: V1Line[];
};

type V1FrameSummary = {
  no: number;
  startedAt: number;
  endedAt: number;
  minutes: number;
  players: number;
  tableCharge: number;
  loserId?: string;
  open: boolean;
  awaiting: boolean;
  cafeOnly: boolean;
};

const HOUR_MS = 3600000;
const MIN_BILLED_FRAME_MS = 60000;

function joinedAtOf(session: V1FramesSession, player: V1Player): number {
  return player.joinedAt ?? session.startedAt;
}

function headcountAt(session: V1FramesSession, at: number): number {
  return (session.players ?? []).filter(
    (player) => joinedAtOf(session, player) <= at && (player.leftAt == null || at < player.leftAt)
  ).length;
}

function rateFor(session: V1FramesSession, headcount: number): number {
  const extra = Math.max(0, session.extraPlayerRatePerHour ?? 0);
  return session.ratePerHour + Math.max(0, headcount - BASE_PLAYERS) * extra;
}

function tableChargeBetween(session: V1FramesSession, from: number, to: number): number {
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
    rupeeMs += (points[i + 1] - points[i]) * rateFor(session, headcountAt(session, points[i]));
  }
  return Math.floor(rupeeMs / HOUR_MS);
}

function playersDuring(session: V1FramesSession, from: number, to: number): number {
  const until = Math.max(to, from + 1);
  return (session.players ?? []).filter(
    (player) => joinedAtOf(session, player) < until && (player.leftAt == null || player.leftAt > from)
  ).length;
}

type V1Payer = { kind: "player"; playerId: string } | { kind: "frame"; frameNo: number } | { kind: "open" };

function linePayer(session: V1FramesSession, line: V1Line): V1Payer {
  if (line.playerId && (session.players ?? []).some((player) => player.id === line.playerId)) {
    return { kind: "player", playerId: line.playerId };
  }
  const frameCount = session.frames?.length ?? 0;
  if (line.frameNo != null && line.frameNo >= 1 && line.frameNo <= frameCount) {
    return { kind: "frame", frameNo: line.frameNo };
  }
  return { kind: "open" };
}

function frameSummaries(session: V1FramesSession, now: number): V1FrameSummary[] {
  const frames = session.frames ?? [];
  const end = session.endedAt ?? now;
  const hasOpenCafe = session.orders.some((line) => linePayer(session, line).kind === "open");
  const summaries: V1FrameSummary[] = [];
  let start = session.startedAt;
  frames.forEach((frame, index) => {
    const frameEnd = Math.max(start, frame.endedAt ?? end);
    const sliver = frame.endedAt == null && Boolean(session.endedAt) && frameEnd - start < MIN_BILLED_FRAME_MS;
    summaries.push({
      no: index + 1,
      startedAt: start,
      endedAt: frameEnd,
      minutes: Math.floor((frameEnd - start) / 60000),
      players: playersDuring(session, start, frameEnd),
      tableCharge: sliver ? 0 : tableChargeBetween(session, start, frameEnd),
      loserId: frame.loserId,
      open: false,
      awaiting: !frame.loserId,
      cafeOnly: false
    });
    start = frameEnd;
  });
  const openEnd = Math.max(start, end);
  const openCharge = tableChargeBetween(session, start, openEnd);
  const billableTime = !session.endedAt || (openEnd - start >= MIN_BILLED_FRAME_MS && openCharge > 0);
  if (!session.endedAt || billableTime || hasOpenCafe) {
    summaries.push({
      no: frames.length + 1,
      startedAt: start,
      endedAt: openEnd,
      minutes: Math.floor((openEnd - start) / 60000),
      players: playersDuring(session, start, openEnd),
      tableCharge: billableTime ? openCharge : 0,
      open: true,
      awaiting: false,
      cafeOnly: !billableTime
    });
  }
  return summaries;
}

function toItem(line: V1Line): ChargeItem {
  return { name: line.name, variant: line.variant, unitPrice: line.unitPrice, quantity: line.quantity };
}

function plainLine(line: V1Line): OrderLine {
  return {
    lineId: line.lineId,
    itemId: line.itemId,
    name: line.name,
    category: line.category,
    variant: line.variant,
    unitPrice: line.unitPrice,
    quantity: line.quantity
  };
}

export type V1Conversion = {
  session: Session;
  customers: Customer[];
  charges: Charge[];
  payments: Payment[];
};

// Turn one saved v1 loser-pays sitting into v2 records with the amounts v1
// billed: billed frames and each player's own cafe become tab charges, a paid
// player's payment becomes a Payment, and an active sitting keeps playing
// (its open frame becomes a running frame, or waits for its lowest scorer if
// the sitting had ended). A voided sitting produces no money.
export type NameBook = Map<string, { customer: Customer; spans: [number, number][] }[]>;

// `byName` carries named customers across the sittings being migrated: the same
// name becomes one customer, unless those players were at the tables at the
// same time — then they are different people (namesakes) and stay apart.
export function convertV1FramesSession(
  v1: V1FramesSession,
  tableName: string,
  now: number,
  makeId: () => string,
  byName: NameBook = new Map()
): V1Conversion {
  const players = v1.players ?? [];
  const customers: Customer[] = [];
  const customerByPlayer = new Map<string, string>();
  players.forEach((player, index) => {
    const named = Boolean(player.name?.trim());
    const key = named ? (player.name as string).trim().toLowerCase() : "";
    const from = player.joinedAt ?? v1.startedAt;
    const to = player.leftAt ?? player.settledAt ?? v1.settledAt ?? v1.endedAt ?? now;
    if (named) {
      const known = (byName.get(key) ?? []).find((entry) => entry.spans.every(([a, b]) => to <= a || from >= b));
      if (known) {
        known.spans.push([from, to]);
        customerByPlayer.set(player.id, known.customer.id);
        return;
      }
    }
    const customer: Customer = {
      id: makeId(),
      name: named ? (player.name as string).trim() : `Player ${index + 1}`,
      guest: named ? undefined : true,
      createdAt: player.joinedAt ?? v1.startedAt
    };
    customers.push(customer);
    if (named) byName.set(key, [...(byName.get(key) ?? []), { customer, spans: [[from, to]] }]);
    customerByPlayer.set(player.id, customer.id);
  });

  const summaries = frameSummaries(v1, now);
  const charges: Charge[] = [];
  const payments: Payment[] = [];
  // Charges made from each v1 player entry. Two entries can map to one customer
  // (a returning player, or the same name), and each entry paid only its own.
  const chargesByPlayer = new Map<string, Charge[]>();
  const noteCharge = (playerId: string, charge: Charge) => {
    chargesByPlayer.set(playerId, [...(chargesByPlayer.get(playerId) ?? []), charge]);
  };
  const voided = Boolean(v1.voidedAt);
  const frames: Frame[] = [];

  for (const summary of summaries) {
    if (summary.open) continue;
    const frame: Frame = { id: makeId(), startedAt: summary.startedAt, endedAt: summary.endedAt };
    const customerId = summary.loserId ? customerByPlayer.get(summary.loserId) : undefined;
    if (customerId && !voided) {
      const items = v1.orders
        .filter((line) => {
          const payer = linePayer(v1, line);
          return payer.kind === "frame" && payer.frameNo === summary.no;
        })
        .map(toItem);
      const charge: Charge = {
        id: makeId(),
        customerId,
        createdAt: summary.endedAt,
        kind: "frame",
        sessionId: v1.id,
        tableId: v1.tableId,
        tableName,
        frameNo: summary.no,
        minutes: summary.minutes,
        players: summary.players,
        tableCharge: summary.tableCharge,
        items,
        total: summary.tableCharge + items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
      };
      charges.push(charge);
      noteCharge(summary.loserId as string, charge);
      frame.chargeId = charge.id;
    }
    frames.push(frame);
  }

  if (!voided) {
    for (const player of players) {
      const own = v1.orders.filter((line) => {
        const payer = linePayer(v1, line);
        return payer.kind === "player" && payer.playerId === player.id;
      });
      if (own.length === 0) continue;
      const items = own.map(toItem);
      const charge: Charge = {
        id: makeId(),
        customerId: customerByPlayer.get(player.id) as string,
        createdAt: player.settledAt ?? v1.endedAt ?? now,
        kind: "cafe",
        sessionId: v1.id,
        tableId: v1.tableId,
        tableName,
        tableCharge: 0,
        items,
        total: items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
      };
      charges.push(charge);
      noteCharge(player.id, charge);
    }
    for (const player of players) {
      if (!player.settledAt) continue;
      const customerId = customerByPlayer.get(player.id) as string;
      const theirs = (chargesByPlayer.get(player.id) ?? []).filter((charge) => !charge.paymentId);
      if (theirs.length === 0) continue;
      const payment: Payment = {
        id: makeId(),
        customerId,
        at: player.settledAt,
        mode: player.paymentMode ?? "Cash",
        amount: theirs.reduce((sum, charge) => sum + charge.total, 0),
        discount: 0,
        chargeIds: theirs.map((charge) => charge.id)
      };
      theirs.forEach((charge) => {
        charge.paymentId = payment.id;
      });
      payments.push(payment);
    }
  }

  const seats: Seat[] = players.map((player) => ({
    id: player.id,
    customerId: customerByPlayer.get(player.id) as string,
    joinedAt: player.joinedAt ?? v1.startedAt,
    leftAt: player.leftAt ?? (v1.settledAt ? v1.settledAt : undefined)
  }));

  const open = summaries.find((summary) => summary.open);
  const closed = Boolean(v1.settledAt);
  // An active sitting carries on: time since the last billed frame becomes a
  // running frame (or one waiting for its lowest scorer if the sitting ended),
  // and cafe not yet billed stays on the table tab.
  if (!closed && open && !open.cafeOnly) {
    frames.push({ id: makeId(), startedAt: open.startedAt, endedAt: v1.endedAt ? open.endedAt : undefined });
  }
  // Cafe still unbilled stays on the table tab: open lines, and lines folded
  // into a frame that was waiting for its lowest scorer (billing that frame in
  // v2 takes the table tab with it).
  const unbilledFrameNos = new Set(summaries.filter((summary) => !summary.open && !summary.loserId).map((summary) => summary.no));
  const openLines = closed
    ? []
    : v1.orders
        .filter((line) => {
          const payer = linePayer(v1, line);
          return payer.kind === "open" || (payer.kind === "frame" && unbilledFrameNos.has(payer.frameNo));
        })
        .map(plainLine);

  // The v1 session's own payment mode moves to `legacy`: the money now lives
  // in the Payments above, and must not be counted a second time.
  const { players: _players, frames: _frames, paymentMode, ...rest } = v1;
  const session: Session = {
    ...rest,
    endedAt: closed ? v1.endedAt : undefined,
    orders: openLines,
    splitMode: "frames",
    seats,
    frames,
    legacy: { v1: { players: v1.players, frames: v1.frames, orders: v1.orders, paymentMode } }
  };
  return { session, customers, charges, payments };
}
