import { EXTRA_PLAYER_RATE_PER_HOUR } from "../data/tables";
import type { MenuItem, OrderLine, PaymentMode, PlayerBill, Session, SplitMode, TableConfig } from "../types";
import { calculatePlayerBills, frameCandidates, getAwaitingFrame, getFrames, getOpenFrame, hasPendingFrame, isFrameBilled, isTabFinal, linePayer, linePayerId } from "./billing";

type PriceOption = MenuItem["prices"][number];

// Guardrails for the loser-pays roster. A snooker table seats a handful of
// players; the roster cap also counts players who left or came back.
export const MAX_PLAYERS = 8;
export const MAX_ROSTER = 16;
export const MAX_NAME = 24;
// A player removed this soon after being added, with nothing on their tab and
// no finished frame behind them, is a mis-entry: delete them outright instead
// of marking them as left.
export const MISTAKE_WINDOW_MS = 60000;

function anySettled(session: Session): boolean {
  return (session.players ?? []).some((player) => player.settledAt);
}

// The player who pays a line has settled — that tab is paid, so the line is locked.
function lineLocked(session: Session, line: OrderLine): boolean {
  if (!isFrameBilled(session)) return false;
  const payerId = linePayerId(session, line);
  const payer = payerId ? (session.players ?? []).find((player) => player.id === payerId) : undefined;
  return Boolean(payer?.settledAt);
}

// Close a loser-pays table once it has ended, every frame is billed, and every
// player who owes has paid. A table where nobody has paid yet stays open for
// staff (a ₹0 table is voided, not settled). The session's payment mode is the
// shared mode if everyone paid alike, else undefined ("Split").
function closeIfDone(session: Session, now: number): Session {
  if (!isFrameBilled(session) || session.settledAt || !session.endedAt) return session;
  if (hasPendingFrame(session, now)) return session;
  const bills = calculatePlayerBills(session, now);
  if (!bills.some((bill) => bill.settled)) return session;
  const due = bills.filter((bill) => bill.total > 0);
  if (due.some((bill) => !bill.settled)) return session;
  const modes = new Set(due.map((bill) => bill.player.paymentMode));
  return { ...session, settledAt: now, paymentMode: modes.size === 1 ? due[0].player.paymentMode : undefined };
}

export function createSession(table: TableConfig, now: number, id: string): Session {
  const base: Session = {
    id,
    tableId: table.id,
    startedAt: now,
    ratePerHour: table.ratePerHour,
    orders: [],
    discount: 0
  };
  // Snooker is loser-pays by default: frame 1 starts with the clock, staff add
  // players by name, and each frame is billed to its lowest scorer. "Whole
  // table" flips it back to one bill for a party paying together.
  if (table.game === "snooker") {
    return { ...base, splitMode: "frames", players: [], frames: [], extraPlayerRatePerHour: EXTRA_PLAYER_RATE_PER_HOUR };
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
  // On a loser-pays table a new unit joins the open frame's cafe, so it only
  // merges into a line that is still open — never into one already billed.
  const frames = isFrameBilled(session);
  const existing = session.orders.find(
    (line) =>
      line.itemId === menuItem.id &&
      line.variant === price.label &&
      (!frames || linePayer(session, line).kind === "open")
  );
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

export function changeOrderQuantity(session: Session, lineId: string, delta: number, now: number): Session {
  const line = session.orders.find((entry) => entry.lineId === lineId);
  if (!line) return session;
  // A line on a paid tab is locked — that money is collected.
  if (lineLocked(session, line)) return session;
  // Removing the last item someone owed for can leave nothing to collect —
  // close the table then, or it would sit in Billing with no action left.
  return closeIfDone(
    {
      ...session,
      orders: session.orders
        .map((entry) => (entry.lineId === lineId ? { ...entry, quantity: entry.quantity + delta } : entry))
        .filter((entry) => entry.quantity > 0)
    },
    now
  );
}

export function markSessionEnded(session: Session, now: number): Session {
  if (session.endedAt) return session;
  return closeIfDone({ ...session, endedAt: now }, now);
}

export function reopenEndedSession(session: Session, now: number): Session {
  if (!session.endedAt) return session;
  // Can't reopen once a player has paid — that money is committed.
  if (anySettled(session)) return session;
  const endedAt = session.endedAt;
  const pausedMs = now - endedAt;
  // Back to Running with the paused stretch left out: every timestamp up to the
  // end moves forward by the pause, so no frame is charged for it. Clear any
  // discount/round-off set while ended so it can't silently ride a live bill.
  const reopened: Session = {
    ...session,
    startedAt: session.startedAt + pausedMs,
    endedAt: undefined,
    discount: 0,
    roundOffEnabled: false
  };
  // Shift the loser-pays record too, whatever the current mode — a table on
  // "Whole table" keeps its frames and roster for a switch back.
  if (!session.frames?.length && !session.players?.length) return reopened;
  return {
    ...reopened,
    // The last frame "ended with the session" — pin it to that moment first.
    frames: session.frames?.map((frame) => ({ ...frame, endedAt: (frame.endedAt ?? endedAt) + pausedMs })),
    players: session.players?.map((player) => ({
      ...player,
      // A time after the (possibly corrected) end didn't happen on the shifted
      // clock: a name added while stopped joins, and a later leave takes effect,
      // at the reopen.
      joinedAt: player.joinedAt == null ? undefined : player.joinedAt <= endedAt ? player.joinedAt + pausedMs : now,
      leftAt: player.leftAt == null ? undefined : player.leftAt <= endedAt ? player.leftAt + pausedMs : now
    }))
  };
}

export function settleEndedSession(session: Session, paymentMode: PaymentMode, now: number): Session {
  // A loser-pays table is settled player by player, never as one bill.
  if (!session.endedAt || isFrameBilled(session)) return session;
  return {
    ...session,
    paymentMode,
    settledAt: now
  };
}

export function voidCurrentSession(session: Session, now: number): Session {
  // Voiding would drop payments already taken from the day's takings — undo
  // those payments first.
  if (isFrameBilled(session) && anySettled(session)) return session;
  return {
    ...session,
    endedAt: session.endedAt ?? now,
    voidedAt: now,
    settledAt: now
  };
}

export function setSessionDiscount(session: Session, value: number): Session {
  // Loser-pays tabs carry no discount (they must reconcile to the total).
  if (isFrameBilled(session)) return session;
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  return { ...session, discount: safe };
}

export function setSessionName(session: Session, name: string): Session {
  return { ...session, customerName: name.trim() ? name : undefined };
}

// Correct the recorded start time at billing (e.g. no one was at the counter to
// start it on time). Kept at or before the end — and before the end of frame 1,
// when frames exist — so no duration goes negative. Players named in the first
// minute carry no join time, so they follow the corrected start; nobody else is
// rewritten, so an overshoot then a correction loses nothing. Locked once
// anyone has paid: their tab was priced against these times.
export function setSessionStart(session: Session, startedAt: number, now: number): Session {
  if (!Number.isFinite(startedAt) || anySettled(session)) return session;
  const end = session.endedAt ?? now;
  const firstFrameEnd = session.frames?.[0]?.endedAt ?? end;
  return { ...session, startedAt: Math.min(startedAt, end, firstFrameEnd) };
}

// Correct the end time (e.g. they stopped playing but stayed for food). Clamped
// between the start (or the last frame that has its own end) and now. Locked
// once anyone has paid.
export function setSessionEnd(session: Session, endedAt: number, now: number): Session {
  if (!session.endedAt || !Number.isFinite(endedAt) || anySettled(session)) return session;
  let floor = session.startedAt;
  for (const frame of session.frames ?? []) {
    if (frame.endedAt != null) floor = Math.max(floor, frame.endedAt);
  }
  return { ...session, endedAt: Math.max(floor, Math.min(endedAt, now)) };
}

export function toggleSessionRoundOff(session: Session): Session {
  if (isFrameBilled(session)) return session;
  return { ...session, roundOffEnabled: !session.roundOffEnabled };
}

// ====== Loser-pays snooker billing ======

// Flip between one bill for the table ("Whole table") and loser-pays. The
// roster and frames are kept either way, so a mis-tap loses nothing. Locked
// once anyone has paid their tab.
export function setSessionSplitMode(session: Session, mode: SplitMode): Session {
  if (session.splitMode === mode || anySettled(session)) return session;
  if (mode === "frames") {
    // Loser-pays tabs carry no discount/round-off, or they would no longer
    // reconcile to the session total.
    return {
      ...session,
      splitMode: "frames",
      players: session.players ?? [],
      frames: session.frames ?? [],
      extraPlayerRatePerHour: session.extraPlayerRatePerHour ?? EXTRA_PLAYER_RATE_PER_HOUR,
      discount: 0,
      roundOffEnabled: false
    };
  }
  return { ...session, splitMode: "table" };
}

// Seat a player. They count toward the rate from now; a name added after the
// session ended (forgotten earlier) can still be billed the last frame.
export function addPlayer(session: Session, name: string, makeId: () => string, now: number): Session {
  if (!isFrameBilled(session) || session.settledAt) return session;
  const clean = name.trim().slice(0, MAX_NAME);
  if (!clean) return session;
  const players = session.players ?? [];
  if (players.length >= MAX_ROSTER) return session;
  if (players.filter((player) => !player.leftAt).length >= MAX_PLAYERS) return session;
  // Names typed in the table's first minute are the group that started it:
  // they count from the start (and follow a corrected start time).
  const atStart = !session.endedAt && !session.frames?.length && now - session.startedAt < MISTAKE_WINDOW_MS;
  const player: PlayerBill = atStart ? { id: makeId(), name: clean } : { id: makeId(), name: clean, joinedAt: now };
  return { ...session, players: [...players, player] };
}

export function setPlayerName(session: Session, playerId: string, name: string): Session {
  const players = (session.players ?? []).map((player) =>
    player.id === playerId ? { ...player, name: name.trim() ? name.slice(0, MAX_NAME) : undefined } : player
  );
  return { ...session, players };
}

// A player can be deleted outright only as a mis-entry: added moments ago, no
// finished frame behind them, nothing on their tab, not paid.
export function isMistakenEntry(session: Session, player: PlayerBill, now: number): boolean {
  if (player.settledAt || player.leftAt) return false;
  if ((session.frames ?? []).some((frame) => frame.loserId === player.id)) return false;
  if (session.orders.some((line) => line.playerId === player.id)) return false;
  const joined = player.joinedAt ?? session.startedAt;
  const open = getOpenFrame(session, now);
  // Joined before the open frame began = present during a finished frame, whose
  // price counted them.
  if (!open || joined < open.startedAt) return false;
  return (session.endedAt ?? now) - joined < MISTAKE_WINDOW_MS;
}

// A player leaves the table ("set away"). The rate drops from this moment, they
// can no longer lose the open frame, and their tab (frames lost + own cafe) is
// final, so they can pay and go while the table plays on. The last player at
// a running table can't leave — the open frame would have nobody to bill; end
// the session instead. A mis-entry is simply deleted.
export function removePlayer(session: Session, playerId: string, now: number): Session {
  if (!isFrameBilled(session) || session.settledAt) return session;
  const players = session.players ?? [];
  const player = players.find((entry) => entry.id === playerId);
  if (!player || player.settledAt || player.leftAt) return session;
  // A running table always keeps someone who can be billed the frame in play.
  const lastAtTable = !session.endedAt && players.filter((entry) => !entry.leftAt).length <= 1;
  if (isMistakenEntry(session, player, now)) {
    if (lastAtTable && players.some((entry) => entry.leftAt)) return session;
    return closeIfDone({ ...session, players: players.filter((entry) => entry.id !== playerId) }, now);
  }
  if (session.endedAt || lastAtTable) return session;
  return { ...session, players: players.map((entry) => (entry.id === playerId ? { ...entry, leftAt: now } : entry)) };
}

// Fold every line not yet tied to a frame into frame `frameNo` (it was ordered
// during it). A line assigned to a player keeps that player, but the stamp
// means clearing the assignment later sends it to this frame's lowest scorer.
function stampUnframedLines(session: Session, frameNo: number): Session["orders"] {
  const frameCount = session.frames?.length ?? 0;
  return session.orders.map((line) =>
    line.frameNo != null && line.frameNo >= 1 && line.frameNo <= frameCount ? line : { ...line, frameNo }
  );
}

// End the frame being played at `at` — the moment staff tapped End frame. The
// boundary is recorded straight away, so the clock doesn't run on while they
// choose, and the next frame (with any cafe ordered in it) starts from there.
// The frame then awaits its lowest scorer (setFrameLoser). One frame at a time:
// the next can't end until this one is billed.
export function endFrame(session: Session, at: number, now: number): Session {
  if (!isFrameBilled(session) || session.settledAt || session.endedAt) return session;
  if (getAwaitingFrame(session, now)) return session;
  const open = getOpenFrame(session, now);
  if (!open) return session;
  const frames = session.frames ?? [];
  const endedAt = Math.max(open.startedAt, Math.min(Number.isFinite(at) ? at : now, now));
  return { ...session, frames: [...frames, { endedAt }], orders: stampUnframedLines(session, frames.length + 1) };
}

// Undo an End frame tapped by mistake ("Keep playing"): the awaiting frame is
// removed, the frame in play runs on from where it began, and its cafe lines
// are open again (merged back where the same item was ordered either side).
export function cancelEndFrame(session: Session, now: number): Session {
  if (!isFrameBilled(session) || session.settledAt || session.endedAt) return session;
  const frames = session.frames ?? [];
  const last = frames[frames.length - 1];
  if (!last || last.loserId || !getAwaitingFrame(session, now)) return session;
  const frameNo = frames.length;
  const trimmed: Session = {
    ...session,
    frames: frames.slice(0, -1),
    orders: session.orders.map((line) => (line.frameNo === frameNo ? { ...line, frameNo: undefined } : line))
  };
  const orders: Session["orders"] = [];
  for (const line of trimmed.orders) {
    const open = linePayer(trimmed, line).kind === "open";
    const twin = open
      ? orders.find((kept) => kept.itemId === line.itemId && kept.variant === line.variant && linePayer(trimmed, kept).kind === "open")
      : undefined;
    if (twin) twin.quantity += line.quantity;
    else orders.push({ ...line });
  }
  return { ...trimmed, orders };
}

// After End session: bill the frame left open to its lowest scorer (it ends
// with the session, and its cafe folds into it). An open frame with only cafe
// (ordered after the last frame) assigns that cafe to the chosen player instead.
export function billOpenFrame(session: Session, loserId: string, now: number): Session {
  if (!isFrameBilled(session) || session.settledAt || !session.endedAt) return session;
  const open = getOpenFrame(session, now);
  if (!open) return session;
  if (!frameCandidates(session, open.endedAt).some((player) => player.id === loserId)) return session;
  if (open.cafeOnly) {
    const orders = session.orders.map((line) =>
      linePayer(session, line).kind === "open" ? { ...line, playerId: loserId } : line
    );
    return closeIfDone({ ...session, orders }, now);
  }
  const frames = session.frames ?? [];
  return closeIfDone(
    { ...session, frames: [...frames, { loserId }], orders: stampUnframedLines(session, frames.length + 1) },
    now
  );
}

// Pick the lowest scorer of a frame awaiting one, or correct it later. Locked
// when the current or the new one has paid; the new one must have been at the
// table when the frame ended.
export function setFrameLoser(session: Session, frameNo: number, loserId: string, now: number): Session {
  if (!isFrameBilled(session) || session.settledAt) return session;
  const frames = session.frames ?? [];
  const frame = frames[frameNo - 1];
  if (!frame || frame.loserId === loserId) return session;
  const players = session.players ?? [];
  if (frame.loserId && players.find((player) => player.id === frame.loserId)?.settledAt) return session;
  const summary = getFrames(session, now)[frameNo - 1];
  if (!summary || !frameCandidates(session, summary.endedAt).some((player) => player.id === loserId)) return session;
  return closeIfDone(
    { ...session, frames: frames.map((entry, index) => (index === frameNo - 1 ? { ...entry, loserId } : entry)) },
    now
  );
}

// Assign a cafe line to one player, or clear it (undefined) so it goes back to
// the lowest scorer of the frame it was ordered in. Locked on a paid tab, and
// can't be moved onto one.
export function assignOrderToPlayer(session: Session, lineId: string, playerId: string | undefined, now: number): Session {
  if (!isFrameBilled(session)) return session;
  const line = session.orders.find((entry) => entry.lineId === lineId);
  if (!line || lineLocked(session, line)) return session;
  if (playerId && !(session.players ?? []).some((player) => player.id === playerId)) return session;
  const next = { ...session, orders: session.orders.map((entry) => (entry.lineId === lineId ? { ...entry, playerId } : entry)) };
  // Judge where the line LANDS: clearing an assignment can hand it back to a
  // frame whose lowest scorer has already paid.
  const moved = next.orders.find((entry) => entry.lineId === lineId);
  if (moved && lineLocked(next, moved)) return session;
  return closeIfDone(next, now);
}

// Settle one player's tab. Allowed once it is final: they left the table, or the
// session ended with every frame billed. When the last player who owes pays,
// the session itself closes.
export function settlePlayer(session: Session, playerId: string, mode: PaymentMode, now: number): Session {
  if (!isFrameBilled(session) || session.settledAt) return session;
  const player = (session.players ?? []).find((entry) => entry.id === playerId);
  if (!player || player.settledAt || !isTabFinal(session, player, now)) return session;
  const bill = calculatePlayerBills(session, now).find((entry) => entry.player.id === playerId);
  if (!bill || bill.total <= 0) return session;
  const players = (session.players ?? []).map((entry) =>
    entry.id === playerId ? { ...entry, paymentMode: mode, settledAt: now } : entry
  );
  return closeIfDone({ ...session, players }, now);
}

// Undo a single player's payment (only while the session is still open).
export function unsettlePlayer(session: Session, playerId: string): Session {
  if (!session.players || session.settledAt) return session;
  const players = session.players.map((player) =>
    player.id === playerId ? { ...player, paymentMode: undefined, settledAt: undefined } : player
  );
  return { ...session, players };
}
