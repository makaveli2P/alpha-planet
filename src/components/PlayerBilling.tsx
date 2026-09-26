import React from "react";
import { Check, Flag, Plus, ReceiptText, X } from "lucide-react";
import { BASE_PLAYERS } from "../data/tables";
import type { FrameSummary, PlayerBill, PlayerTotals, Session } from "../types";
import { frameCandidates, getFrames, hasPendingFrame, headcountAt, isTabFinal, ratePerHourFor } from "../lib/billing";
import { formatClock, formatDuration, formatMoney, formatRatePerMinute } from "../lib/format";
import { MAX_NAME, MAX_PLAYERS, MAX_ROSTER, isMistakenEntry } from "../lib/sessionActions";

// A player's display name, falling back to their slot number.
export function playerLabel(player: PlayerBill, index: number): string {
  return player.name?.trim() ? (player.name as string) : `Player ${index + 1}`;
}

// One line of tab context, e.g. "2 frames lost · Table ₹96 · Cafe ₹40".
function tabNote(bill: PlayerTotals): string {
  const parts: string[] = [];
  if (bill.framesLost > 0) {
    parts.push(`${bill.framesLost} ${bill.framesLost === 1 ? "frame" : "frames"} lost · Table ${formatMoney(bill.tableShare)}`);
  }
  const cafe = bill.frameCafe + bill.ownCafe;
  if (cafe > 0) parts.push(`Cafe ${formatMoney(cafe)}`);
  return parts.length > 0 ? parts.join(" · ") : "Nothing due";
}

// A player's tab + pay controls: Settle (once the tab is final), or the paid tag
// + receipt. Shared by the running roster (players who left) and settlement.
function PlayerBillRow({
  bill,
  canSettle,
  onOpen,
  onRemove
}: {
  bill: PlayerTotals;
  canSettle: boolean;
  onOpen: (playerId: string) => void;
  onRemove?: (playerId: string) => void;
}) {
  const label = playerLabel(bill.player, bill.index);
  const id = bill.player.id;
  return (
    <div className={`playerSettleRow${bill.settled ? " paid" : ""}${bill.left ? " leftRow" : ""}`}>
      <div className="playerSettleWho">
        <strong>{label}{bill.left && !bill.settled ? " · left" : ""}</strong>
        <span>{tabNote(bill)}</span>
      </div>
      <div className="playerSettleAmt">{formatMoney(bill.total)}</div>
      {onRemove && (
        <div className="playerRowActions">
          <button type="button" className="rowGhostBtn" onClick={() => onRemove(id)} aria-label={`Remove ${label}`}>
            <X size={13} /> Remove — added by mistake
          </button>
        </div>
      )}
      {(bill.settled || bill.total > 0) && (
        <div className="playerRowActions">
          {bill.settled ? (
            <>
              <span className="playerPaidTag"><Check size={13} aria-hidden="true" /> Paid · {bill.player.paymentMode}</span>
              <button type="button" className="rowGhostBtn" onClick={() => onOpen(id)}>
                <ReceiptText size={13} /> Receipt
              </button>
            </>
          ) : (
            <button
              type="button"
              className="settleAction settleOne"
              onClick={() => onOpen(id)}
              disabled={!canSettle}
              aria-label={`Settle ${label}`}
            >
              Settle
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Name + Enter to seat a player. The input never unmounts and re-takes focus
// after every add, so staff can type the next name straight away.
export function AddPlayerForm({
  session,
  onAddPlayer
}: {
  session: Session;
  onAddPlayer: (name: string) => void;
}) {
  const [name, setName] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const players = session.players ?? [];
  const full = players.filter((player) => !player.leftAt).length >= MAX_PLAYERS || players.length >= MAX_ROSTER;

  function submit() {
    if (name.trim()) onAddPlayer(name);
    setName("");
    inputRef.current?.focus();
  }

  return (
    <form
      className="addPlayer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={full ? "Table is full" : "Add player — name, then Enter"}
        maxLength={MAX_NAME}
        disabled={full}
        aria-label="Add player"
      />
      <button type="submit" className="settleAction mini" disabled={full || !name.trim()}>
        <Plus size={14} /> Add
      </button>
    </form>
  );
}

// Who-lost picker for one frame: a button per player who can take it, plus a
// name field when nobody can (or after End session, for a forgotten name).
function LoserPicker({
  session,
  frame,
  prompt,
  showAdd,
  onPick,
  onAddPlayer,
  children
}: {
  session: Session;
  frame: FrameSummary;
  prompt: string;
  showAdd: boolean;
  onPick: (loserId: string) => void;
  onAddPlayer: (name: string) => void;
  children?: React.ReactNode;
}) {
  const players = session.players ?? [];
  const candidates = frameCandidates(session, frame.endedAt);
  return (
    <div className="loserPick">
      <span className="loserPickTitle">
        {prompt} <strong>{formatMoney(frame.total)}</strong>
      </span>
      {candidates.length === 0 ? (
        <p className="muted">Add a player to bill this {frame.cafeOnly ? "cafe" : "frame"}.</p>
      ) : (
        <div className="loserOptions">
          {candidates.map((player) => (
            <button key={player.id} type="button" className="loserBtn" onClick={() => onPick(player.id)}>
              <Flag size={13} aria-hidden="true" /> {playerLabel(player, players.indexOf(player))}
            </button>
          ))}
        </div>
      )}
      {(showAdd || candidates.length === 0) && <AddPlayerForm session={session} onAddPlayer={onAddPlayer} />}
      {children}
    </div>
  );
}

function FrameHead({
  eyebrow,
  title,
  frame,
  live,
  action
}: {
  eyebrow?: string;
  title: string;
  frame: FrameSummary;
  live?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="frameHead">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h3>{title}</h3>
        <p className="frameMoney">
          {!frame.cafeOnly && <>Table <strong>{formatMoney(frame.tableCharge)}</strong> · </>}
          Cafe <strong>{formatMoney(frame.cafeTotal)}</strong>
          {!frame.cafeOnly && !live && <> · {frame.players} {frame.players === 1 ? "player" : "players"}</>}
        </p>
      </div>
      <div className="frameSide">
        {!frame.cafeOnly && <strong className={`frameClock${live ? "" : " stopped"}`}>{formatClock(frame.endedAt - frame.startedAt)}</strong>}
        {action}
      </div>
    </div>
  );
}

// The frames that need staff: a frame whose End frame was tapped and awaits its
// lowest scorer (its end is already recorded, so its price is fixed while they
// choose), the frame in play (running clock + End frame), and — after End
// session — the frame left open. The chosen player pays the frame's table time
// plus the cafe ordered during it.
export function FrameBlock({
  session,
  now,
  onEndFrame,
  onCancelEnd,
  onPickLoser,
  onBillOpen,
  onAddPlayer
}: {
  session: Session;
  now: number;
  onEndFrame: () => void;
  onCancelEnd: () => void;
  onPickLoser: (frameNo: number, loserId: string) => void;
  onBillOpen: (loserId: string) => void;
  onAddPlayer: (name: string) => void;
}) {
  const running = !session.endedAt;
  const frames = getFrames(session, now);
  const awaiting = frames.find((frame) => frame.awaiting);
  const open = frames.find((frame) => frame.open);
  const lastIsAwaiting = Boolean(awaiting) && awaiting?.no === (session.frames?.length ?? 0);

  return (
    <>
      {awaiting && (
        <div className="frameBlock picking">
          <FrameHead eyebrow="Frame ended" title={`Frame ${awaiting.no}`} frame={awaiting} />
          <LoserPicker
            session={session}
            frame={awaiting}
            prompt={`Who lost frame ${awaiting.no}?`}
            showAdd={!running}
            onPick={(loserId) => onPickLoser(awaiting.no, loserId)}
            onAddPlayer={onAddPlayer}
          >
            {running && lastIsAwaiting && (
              <button type="button" className="rowGhostBtn" onClick={onCancelEnd}>
                Keep playing — undo End frame
              </button>
            )}
          </LoserPicker>
        </div>
      )}
      {open && running && (
        <div className="frameBlock">
          <FrameHead
            title={`Frame ${open.no}`}
            frame={open}
            live
            action={
              !awaiting && (
                <button type="button" className="frameEndBtn" onClick={onEndFrame}>
                  <Flag size={14} aria-hidden="true" /> End frame {open.no}
                </button>
              )
            }
          />
        </div>
      )}
      {open && !running && (
        <div className="frameBlock picking">
          <FrameHead
            eyebrow="Needs a lowest scorer"
            title={open.cafeOnly ? "Cafe after the last frame" : `Last frame · Frame ${open.no}`}
            frame={open}
          />
          <LoserPicker
            session={session}
            frame={open}
            prompt={open.cafeOnly ? "Who pays?" : `Who lost frame ${open.no}?`}
            showAdd
            onPick={onBillOpen}
            onAddPlayer={onAddPlayer}
          />
        </div>
      )}
    </>
  );
}

// The roster while a loser-pays table is RUNNING: players at the table (name,
// running tab, set-away), players who left with a tab to settle, the add-player
// field, and the live rate for the current headcount.
export function FrameRoster({
  session,
  now,
  bills,
  onAddPlayer,
  onRemovePlayer,
  onRenamePlayer,
  onOpen
}: {
  session: Session;
  now: number;
  bills: PlayerTotals[];
  onAddPlayer: (name: string) => void;
  onRemovePlayer: (playerId: string) => void;
  onRenamePlayer: (playerId: string, name: string) => void;
  onOpen: (playerId: string) => void;
}) {
  const players = session.players ?? [];
  const billById = new Map(bills.map((bill) => [bill.player.id, bill]));
  const present = players.filter((player) => !player.leftAt);
  const leftWithTab = bills.filter((bill) => bill.left && (bill.total > 0 || bill.settled));
  const headcount = headcountAt(session, now);
  const extra = Math.max(0, headcount - BASE_PLAYERS);
  // ✕ is tap-twice (within 3s), like End session: setting a player away can't
  // be undone — they would come back as a new entry.
  const [confirmingRemove, setConfirmingRemove] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!confirmingRemove) return;
    const timer = window.setTimeout(() => setConfirmingRemove(null), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmingRemove]);

  return (
    <div className="rosterSection">
      <div className="rosterTitle">
        <h3>Players</h3>
        <span>{present.length} at the table</span>
      </div>
      <div className="rosterPlayers">
        {present.length === 0 && <p className="muted">No players yet. Add them below.</p>}
        {present.map((player) => {
          const index = players.indexOf(player);
          const label = playerLabel(player, index);
          const bill = billById.get(player.id);
          const mistake = isMistakenEntry(session, player, now);
          // Mirrors removePlayer: a running table keeps someone to bill.
          const canRemove = present.length > 1 || (mistake && !players.some((entry) => entry.leftAt));
          return (
            <div className="rosterPlayer" key={player.id}>
              <span className="rosterIndex">{index + 1}</span>
              <input
                type="text"
                value={player.name ?? ""}
                placeholder={`Player ${index + 1}`}
                onChange={(event) => onRenamePlayer(player.id, event.target.value)}
                maxLength={MAX_NAME}
                aria-label={`Player ${index + 1} name`}
              />
              <span className="rosterTab">
                {bill && bill.framesLost > 0 && <em>{bill.framesLost} lost</em>}
                {bill && bill.total > 0 ? formatMoney(bill.total) : "—"}
              </span>
              <button
                type="button"
                className={`leaveBtn${confirmingRemove === player.id ? " confirming" : ""}`}
                onClick={() => {
                  if (confirmingRemove === player.id) {
                    onRemovePlayer(player.id);
                    setConfirmingRemove(null);
                  } else {
                    setConfirmingRemove(player.id);
                  }
                }}
                disabled={!canRemove}
                aria-label={mistake ? `Remove ${label}` : `Set ${label} away`}
                title={
                  mistake
                    ? "Remove — added by mistake"
                    : canRemove
                      ? "Set away — leaves the table; the tab stays to settle"
                      : "Last player at the table — end the session instead"
                }
              >
                {confirmingRemove === player.id ? (mistake ? "Tap to remove" : "Tap to set away") : <X size={15} />}
              </button>
            </div>
          );
        })}
        {leftWithTab.map((bill) => (
          <PlayerBillRow key={bill.player.id} bill={bill} canSettle={isTabFinal(session, bill.player, now)} onOpen={onOpen} />
        ))}
      </div>
      {/* Kept in view at the bottom of the scroll area: the add field and the
          live rate never scroll away while players are listed above. */}
      <div className="rosterFoot">
        <AddPlayerForm session={session} onAddPlayer={onAddPlayer} />
        <div className="rateLine">
          <span>
            Rate
            <em>
              {formatMoney(session.ratePerHour)}/hr for {BASE_PLAYERS}
              {extra > 0 ? ` + ${formatMoney(session.extraPlayerRatePerHour ?? 0)} × ${extra}` : ""}
            </em>
          </span>
          <strong>
            {formatRatePerMinute(ratePerHourFor(session, headcount))}
            <small>/min</small>
          </strong>
        </div>
      </div>
    </div>
  );
}

// Finished frames, newest first: frame, players, billing, lowest scorer. The
// lowest scorer can be corrected until either player involved has paid.
export function FrameHistory({
  session,
  frames,
  onChangeLoser
}: {
  session: Session;
  frames: FrameSummary[];
  onChangeLoser: (frameNo: number, loserId: string) => void;
}) {
  if (frames.length === 0) return null;
  const players = session.players ?? [];
  const total = frames.reduce((sum, frame) => sum + frame.total, 0);
  return (
    <div className="frameHistory">
      <div className="rosterTitle">
        <h3>Frames</h3>
        <span>{frames.length} billed · {formatMoney(total)}</span>
      </div>
      <div className="frameRow frameRowHead" aria-hidden="true">
        <span>#</span>
        <span>Players</span>
        <span>Billing</span>
        <span>Lowest scorer</span>
      </div>
      {frames
        .slice()
        .reverse()
        .map((frame) => {
          const loser = players.find((player) => player.id === frame.loserId);
          const options = frameCandidates(session, frame.endedAt);
          if (loser && !options.includes(loser)) options.unshift(loser);
          return (
            <div className="frameRow" key={frame.no}>
              <span className="frameNo">{frame.no}</span>
              <span>
                {frame.players}
                <em>{formatDuration(frame.minutes)}</em>
              </span>
              <span className="frameAmt">
                {formatMoney(frame.total)}
                {frame.cafeTotal > 0 && <em>incl. cafe {formatMoney(frame.cafeTotal)}</em>}
              </span>
              <select
                className="orderAssign"
                value={frame.loserId}
                disabled={Boolean(loser?.settledAt)}
                onChange={(event) => onChangeLoser(frame.no, event.target.value)}
                aria-label={`Lowest scorer of frame ${frame.no}`}
              >
                {options.map((player) => (
                  <option key={player.id} value={player.id}>
                    {playerLabel(player, players.indexOf(player))}
                    {player.settledAt ? " (paid)" : ""}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
    </div>
  );
}

// Settlement while a loser-pays table is BILLING (session ended): every tab with
// Settle / Paid, blocked while the last frame still has no lowest scorer.
export function PlayerSettlement({
  session,
  now,
  bills,
  onOpen,
  onRemovePlayer
}: {
  session: Session;
  now: number;
  bills: PlayerTotals[];
  onOpen: (playerId: string) => void;
  onRemovePlayer: (playerId: string) => void;
}) {
  const pending = hasPendingFrame(session, now);
  const due = bills.filter((bill) => bill.total > 0);
  const shown = bills.filter((bill) => bill.total > 0 || bill.settled || !bill.left);
  const paidCount = due.filter((bill) => bill.settled).length;
  const grandTotal = due.reduce((sum, bill) => sum + bill.total, 0);
  const collected = due.reduce((sum, bill) => sum + (bill.settled ? bill.total : 0), 0);

  return (
    <div className="playerSettle">
      <div className="playerSettleTitle">
        <h3>Tabs</h3>
        <span>{paidCount}/{due.length} paid</span>
      </div>
      {pending && <p className="settleBlocked">Bill the last frame first. It changes who owes what.</p>}
      {shown.map((bill) => (
        <PlayerBillRow
          key={bill.player.id}
          bill={bill}
          canSettle={isTabFinal(session, bill.player, now)}
          onOpen={onOpen}
          onRemove={isMistakenEntry(session, bill.player, now) ? onRemovePlayer : undefined}
        />
      ))}
      {shown.length === 0 && <p className="muted">No players on this table.</p>}
      <div className="playerSettleFoot">
        <span>Collected</span>
        <strong>{formatMoney(collected)} / {formatMoney(grandTotal)}</strong>
      </div>
      {!pending && due.length === 0 && <p className="muted">Nothing to collect. Void the bill to free the table.</p>}
    </div>
  );
}
