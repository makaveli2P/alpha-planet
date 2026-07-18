import type { MenuItem, PaymentMode, PlayerBill, Session, SplitMode, TableConfig } from "../types";
import { calculatePlayerBills, calculateSessionTotals } from "./billing";

type PriceOption = MenuItem["prices"][number];

// Guardrails for the per-player roster. A snooker table seats a handful of
// players; frames rarely run past a couple of dozen. Bounds keep the steppers
// and the split math sane.
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 1;
export const MAX_FRAMES = 99;
// Hard cap on roster entries including rejoin stints (a returning player adds a
// fresh entry). Well above any real table; a backstop against runaway rejoins.
export const MAX_STINTS = 12;

// A player whose bill is committed — they've checked out early (frozen) or paid.
// Their amount must not shift under later edits.
function isCommitted(player: PlayerBill): boolean {
  return Boolean(player.leftAt || player.settledAt);
}

// Rupees of shared cafe already locked into departed players' frozen slices.
function frozenSharedTotal(players: PlayerBill[]): number {
  return players.reduce((sum, p) => sum + (p.leftAt ? Math.max(0, Math.floor(p.frozenSharedCafe ?? 0)) : 0), 0);
}

// Live total of shared (unassigned, or assigned-to-a-removed-player) cafe lines.
function sharedCafeTotal(session: Session): number {
  const players = session.players ?? [];
  return session.orders.reduce((sum, line) => {
    const owner = line.playerId ? players.find((p) => p.id === line.playerId) : undefined;
    return sum + (owner ? 0 : line.unitPrice * line.quantity);
  }, 0);
}

function makePlayer(id: string): PlayerBill {
  return { id, satOutFrames: 0 };
}

// A player added AFTER play has begun only owes for frames from now on, so they
// start having "sat out" every frame already played. At the start of a session
// (no frames yet) this is just a normal player.
function makeJoiningPlayer(id: string, frameCount: number, now: number): PlayerBill {
  return frameCount > 0 ? { id, satOutFrames: frameCount, joinedAt: now } : { id, satOutFrames: 0 };
}

export function createSession(table: TableConfig, now: number, id: string, makeId?: () => string): Session {
  const base: Session = {
    id,
    tableId: table.id,
    startedAt: now,
    ratePerHour: table.ratePerHour,
    orders: [],
    discount: 0
  };
  // Snooker is billed per-individual by default (owner's rule): seed two players
  // and split the table time by frames played. Staff bump the count, record
  // frames/sit-outs, or flip to "One payer" for a single-party table.
  if (table.game === "snooker" && makeId) {
    return {
      ...base,
      splitMode: "per-player",
      frameCount: 0,
      players: [makePlayer(makeId()), makePlayer(makeId())]
    };
  }
  return base;
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
  const line = session.orders.find((entry) => entry.lineId === lineId);
  if (!line) return session;
  const players = session.players ?? [];
  const owner = line.playerId ? players.find((player) => player.id === line.playerId) : undefined;
  // A line that feeds a checked-out / settled player's bill is locked — that bill
  // is committed (and likely already paid), so its total can't move.
  if (owner && isCommitted(owner)) return session;
  // Don't let a shared line shrink the shared pool below what departed players
  // were already charged for it (that would strand their frozen slice as money
  // billed with nothing behind it).
  if (delta < 0 && !owner) {
    const frozen = frozenSharedTotal(players);
    if (frozen > 0) {
      const removed = line.unitPrice * Math.min(-delta, line.quantity);
      if (sharedCafeTotal(session) - removed < frozen) return session;
    }
  }
  return {
    ...session,
    orders: session.orders
      .map((entry) => (entry.lineId === lineId ? { ...entry, quantity: entry.quantity + delta } : entry))
      .filter((entry) => entry.quantity > 0)
  };
}

export function markSessionEnded(session: Session, now: number): Session {
  if (session.endedAt) return session;
  return { ...session, endedAt: now };
}

export function reopenEndedSession(session: Session, now: number): Session {
  if (!session.endedAt) return session;
  // Can't reopen once a player has paid or checked out early — that's committed.
  if (session.players?.some((player) => player.settledAt || player.leftAt)) return session;
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
// Locked once anyone has checked out / paid: their table-time share was frozen
// against these times, so editing them would desync the committed amounts.
export function setSessionStart(session: Session, startedAt: number, now: number): Session {
  if (!Number.isFinite(startedAt)) return session;
  if ((session.players ?? []).some(isCommitted)) return session;
  const end = session.endedAt ?? now;
  return { ...session, startedAt: Math.min(startedAt, end) };
}

// Correct the end time (e.g. they stopped playing but stayed for food). Clamped
// between the start and now — you can't end in the future. Locked once anyone
// has checked out / paid (same reason as setSessionStart).
export function setSessionEnd(session: Session, endedAt: number, now: number): Session {
  if (!session.endedAt || !Number.isFinite(endedAt)) return session;
  if ((session.players ?? []).some(isCommitted)) return session;
  return { ...session, endedAt: Math.max(session.startedAt, Math.min(endedAt, now)) };
}

export function toggleSessionRoundOff(session: Session): Session {
  return { ...session, roundOffEnabled: !session.roundOffEnabled };
}

// ====== Per-player snooker billing ======

// Flip between one bill for the table ("One payer") and per-player billing.
// Switching to per-player seeds two players if the roster is empty; switching to
// table keeps the roster around (ignored) so a mis-tap doesn't lose names.
export function setSessionSplitMode(session: Session, mode: SplitMode, makeId: () => string): Session {
  if (session.splitMode === mode) return session;
  if (mode === "per-player") {
    const players = session.players && session.players.length > 0 ? session.players : [makePlayer(makeId()), makePlayer(makeId())];
    // Per-player bills don't carry session-level discount/round-off (the UI is
    // hidden), so clear them — otherwise the split would no longer reconcile to
    // the session total.
    return { ...session, splitMode: "per-player", players, frameCount: session.frameCount ?? 0, discount: 0, roundOffEnabled: false };
  }
  return { ...session, splitMode: "table" };
}

// Grow or shrink the roster. Never drops a player who has already paid, and
// re-shares the cafe lines of any removed player (so their items aren't lost).
// Players added mid-session are treated as joining now (they don't pay for
// frames already played).
export function setSessionPlayerCount(session: Session, count: number, makeId: () => string, now: number): Session {
  const current = session.players ?? [];
  const target = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(count) || MIN_PLAYERS));
  if (target === current.length) return session;

  const frameCount = Math.max(0, Math.floor(session.frameCount ?? 0));
  let players: PlayerBill[];
  if (target > current.length) {
    players = current.slice();
    while (players.length < target) players.push(makeJoiningPlayer(makeId(), frameCount, now));
  } else {
    // Drop trailing players until we hit the target, but never one who has paid
    // or checked out early — their bill is already locked in.
    const lockedCount = current.filter((player) => player.settledAt || player.leftAt).length;
    let removable = current.length - Math.max(target, lockedCount);
    players = [];
    for (let i = current.length - 1; i >= 0; i -= 1) {
      const player = current[i];
      if (removable > 0 && !player.settledAt && !player.leftAt) {
        removable -= 1;
        continue;
      }
      players.unshift(player);
    }
  }

  const keptIds = new Set(players.map((player) => player.id));
  const orders = session.orders.map((line) =>
    line.playerId && !keptIds.has(line.playerId) ? { ...line, playerId: undefined } : line
  );
  return { ...session, players, orders };
}

export function setPlayerName(session: Session, playerId: string, name: string): Session {
  const players = (session.players ?? []).map((player) =>
    player.id === playerId ? { ...player, name: name.trim() ? name : undefined } : player
  );
  return { ...session, players };
}

// Record how many frames a player actually played (0..total). Stored internally
// as "frames sat out" = total − played, which is what the split math consumes,
// so the frame-share billing is unchanged.
export function setPlayerFramesPlayed(session: Session, playerId: string, framesPlayed: number): Session {
  const frames = Math.max(0, Math.floor(session.frameCount ?? 0));
  const played = Number.isFinite(framesPlayed) ? Math.max(0, Math.min(frames, Math.floor(framesPlayed))) : 0;
  const satOut = frames - played;
  const players = (session.players ?? []).map((player) =>
    player.id === playerId ? { ...player, satOutFrames: satOut } : player
  );
  return { ...session, players };
}

// Set the total frames played, re-clamping every player's sit-out count so no
// one can be marked as sitting out more frames than were played.
export function setSessionFrameCount(session: Session, frameCount: number): Session {
  const frames = Number.isFinite(frameCount) ? Math.max(0, Math.min(MAX_FRAMES, Math.floor(frameCount))) : 0;
  const players = (session.players ?? []).map((player) => ({
    ...player,
    satOutFrames: Math.min(player.satOutFrames, frames)
  }));
  return { ...session, frameCount: frames, players };
}

// Attribute a cafe line to a player, or clear it (undefined = shared/split).
export function assignOrderToPlayer(session: Session, lineId: string, playerId?: string): Session {
  const players = session.players ?? [];
  const line = session.orders.find((entry) => entry.lineId === lineId);
  if (!line) return session;
  const currentOwner = line.playerId ? players.find((player) => player.id === line.playerId) : undefined;
  // Can't move a line off a committed player, nor onto one — their bill is locked.
  if (currentOwner && isCommitted(currentOwner)) return session;
  const target = playerId ? players.find((player) => player.id === playerId) : undefined;
  if (target && isCommitted(target)) return session;
  // Moving a shared line onto a player shrinks the shared pool; block it if that
  // would drop below the frozen shared slices departed players already paid.
  if (!currentOwner && target) {
    const frozen = frozenSharedTotal(players);
    if (frozen > 0 && sharedCafeTotal(session) - line.unitPrice * line.quantity < frozen) return session;
  }
  const valid = target ? playerId : undefined;
  const orders = session.orders.map((entry) => (entry.lineId === lineId ? { ...entry, playerId: valid } : entry));
  return { ...session, orders };
}

// Settle one player. Allowed once the table has ended, or as soon as a player
// has checked out early (they pay and go while the table keeps running). Once
// every player is paid, the session itself closes (settledAt set); its payment
// mode is the shared mode if all paid alike, else undefined ("Split").
export function settlePlayer(session: Session, playerId: string, mode: PaymentMode, now: number): Session {
  if (!session.players || session.settledAt) return session;
  const target = session.players.find((player) => player.id === playerId);
  if (!target || target.settledAt) return session;
  if (!session.endedAt && !target.leftAt) return session;
  const players = session.players.map((player) =>
    player.id === playerId && !player.settledAt ? { ...player, paymentMode: mode, settledAt: now } : player
  );
  const allSettled = players.length > 0 && players.every((player) => player.settledAt);
  const modes = new Set(players.map((player) => player.paymentMode));
  return {
    ...session,
    players,
    settledAt: allSettled ? now : session.settledAt,
    paymentMode: allSettled ? (modes.size === 1 ? players[0].paymentMode : undefined) : session.paymentMode
  };
}

// Undo a single player's payment (only while the session is still open).
export function unsettlePlayer(session: Session, playerId: string): Session {
  if (!session.players || session.settledAt) return session;
  const players = session.players.map((player) =>
    player.id === playerId ? { ...player, paymentMode: undefined, settledAt: undefined } : player
  );
  return { ...session, players };
}

// A player leaves mid-session while the table keeps running for everyone else.
// Their table-time share is frozen at this moment (their frames-played slice of
// the charge so far, after any earlier leavers), so the remaining players carry
// the time from here on and the split still sums to the final table charge. If
// this was the last player still at the table, the table stops now.
export function endPlayerSession(session: Session, playerId: string, now: number): Session {
  if (!session.players || session.settledAt || session.endedAt) return session;
  const target = session.players.find((player) => player.id === playerId);
  if (!target || target.leftAt || target.settledAt) return session;

  const bill = calculatePlayerBills(session, now).find((entry) => entry.player.id === playerId);
  if (!bill) return session;
  const minutes = calculateSessionTotals(session, now).minutes;

  const players = session.players.map((player) =>
    player.id === playerId
      ? {
          ...player,
          leftAt: now,
          frozenTableShare: bill.tableShare,
          frozenSharedCafe: bill.sharedCafeShare,
          frozenFrames: bill.framesPlayed,
          frozenMinutes: minutes
        }
      : player
  );
  const anyStillPlaying = players.some((player) => !player.leftAt);
  return { ...session, players, endedAt: anyStillPlaying ? session.endedAt : now };
}

// A player who already paid (or left) comes back to play more — a fresh stint.
// We add a new roster entry with their name that only owes for frames from now
// on; the earlier paid entry stays untouched as its own settled record. Only
// while the table is still running (otherwise start a new session).
export function rejoinAsNewStint(session: Session, playerId: string, makeId: () => string, now: number): Session {
  if (!session.players || session.endedAt || session.settledAt) return session;
  const source = session.players.find((player) => player.id === playerId);
  // Only a committed (paid/left) stint can rejoin, and only ONCE — otherwise a
  // double-tap would create two duplicate active entries billing one person twice.
  if (!source || source.rejoinedAt || !isCommitted(source)) return session;
  if (session.players.length >= MAX_STINTS) return session;
  const frameCount = Math.max(0, Math.floor(session.frameCount ?? 0));
  const fresh: PlayerBill = { id: makeId(), name: source.name, satOutFrames: frameCount, joinedAt: now };
  const players = session.players.map((player) =>
    player.id === playerId ? { ...player, rejoinedAt: now } : player
  );
  return { ...session, players: [...players, fresh] };
}

// Undo an early checkout (before the player has paid and while the table is
// still running). They rejoin the active split.
export function rejoinPlayer(session: Session, playerId: string): Session {
  if (!session.players || session.endedAt || session.settledAt) return session;
  const players = session.players.map((player) =>
    player.id === playerId && player.leftAt && !player.settledAt
      ? { ...player, leftAt: undefined, frozenTableShare: undefined, frozenSharedCafe: undefined, frozenFrames: undefined, frozenMinutes: undefined }
      : player
  );
  return { ...session, players };
}
