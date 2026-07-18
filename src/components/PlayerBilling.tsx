import { Check, LogOut, Minus, Plus, ReceiptText, RotateCcw } from "lucide-react";
import type { PlayerBill, PlayerTotals, Session, SplitMode } from "../types";
import { formatMoney } from "../lib/format";
import { MAX_FRAMES, MAX_PLAYERS, MIN_PLAYERS } from "../lib/sessionActions";

// A player's display name, falling back to their slot number.
export function playerLabel(player: PlayerBill, index: number): string {
  return player.name?.trim() ? (player.name as string) : `Player ${index + 1}`;
}

// Small +/- stepper for player count, frames, and sit-outs.
function Stepper({
  value,
  min,
  max,
  onChange,
  ariaLabel
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  ariaLabel: string;
}) {
  return (
    <div className="miniStepper" role="group" aria-label={ariaLabel}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`${ariaLabel}: decrease`}>
        <Minus size={13} />
      </button>
      <span>{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={`${ariaLabel}: increase`}>
        <Plus size={13} />
      </button>
    </div>
  );
}

// One line of per-player billing context, e.g. "3/4 frames · Table ₹96 · Cafe ₹40".
function billNote(bill: PlayerTotals, frameCount: number): string {
  const parts: string[] = [];
  parts.push(frameCount > 0 ? `${bill.framesPlayed}/${frameCount} frames · Table ${formatMoney(bill.tableShare)}` : `Table ${formatMoney(bill.tableShare)}`);
  const cafe = bill.ownCafe + bill.sharedCafeShare;
  if (cafe > 0) parts.push(`Cafe ${formatMoney(cafe)}`);
  return parts.join(" · ");
}

// A player's amount + pay controls. Shared by the running roster (for players who
// left early) and the billing settlement view. `onRejoin`, when provided, offers
// an "undo leave" for a checked-out player who hasn't paid yet.
function PlayerBillRow({
  bill,
  frameCount,
  onOpen,
  onRejoinStint,
  onUndoLeave
}: {
  bill: PlayerTotals;
  frameCount: number;
  onOpen: (playerId: string) => void;
  onRejoinStint?: (playerId: string) => void;
  onUndoLeave?: (playerId: string) => void;
}) {
  const label = playerLabel(bill.player, bill.index);
  const id = bill.player.id;
  return (
    <div className={`playerSettleRow${bill.settled ? " paid" : ""}${bill.left ? " leftRow" : ""}`}>
      <div className="playerSettleWho">
        <strong>{label}{bill.left && !bill.settled ? " · left" : ""}</strong>
        <span>{billNote(bill, frameCount)}</span>
      </div>
      <div className="playerSettleAmt">{formatMoney(bill.total)}</div>
      <div className="playerRowActions">
        {bill.settled ? (
          <>
            <span className="playerPaidTag"><Check size={13} aria-hidden="true" /> Paid · {bill.player.paymentMode}</span>
            <button type="button" className="rowGhostBtn" onClick={() => onOpen(id)}>
              <ReceiptText size={13} /> Receipt
            </button>
            {onRejoinStint && (
              <button type="button" className="rowGhostBtn" onClick={() => onRejoinStint(id)}>
                <RotateCcw size={13} /> Rejoin
              </button>
            )}
          </>
        ) : (
          <>
            <button type="button" className="settleAction settleOne" onClick={() => onOpen(id)} aria-label={`Settle ${label}`}>
              Settle
            </button>
            {onUndoLeave && (
              <button type="button" className="rowGhostBtn" onClick={() => onUndoLeave(id)}>
                <RotateCcw size={13} /> Undo leave
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Roster shown while a snooker session is RUNNING: split toggle, player count,
// frames, per-player names and sit-outs, a per-player "leave" (early checkout),
// and inline settlement for any player who has already left.
export function PlayerRoster({
  session,
  splitMode,
  bills,
  changeSplitMode,
  changePlayerCount,
  changePlayerName,
  changePlayerFramesPlayed,
  changeFrameCount,
  onCheckout,
  onOpen,
  onRejoinStint,
  onUndoLeave
}: {
  session: Session;
  splitMode: SplitMode;
  bills: PlayerTotals[];
  changeSplitMode: (mode: SplitMode) => void;
  changePlayerCount: (count: number) => void;
  changePlayerName: (playerId: string, name: string) => void;
  changePlayerFramesPlayed: (playerId: string, framesPlayed: number) => void;
  changeFrameCount: (count: number) => void;
  onCheckout: (playerId: string) => void;
  onOpen: (playerId: string) => void;
  onRejoinStint: (playerId: string) => void;
  onUndoLeave: (playerId: string) => void;
}) {
  const players = session.players ?? [];
  const frames = session.frameCount ?? 0;
  const perPlayer = splitMode === "per-player";
  const billById = new Map(bills.map((bill) => [bill.player.id, bill]));

  return (
    <div className="rosterSection">
      <div className="splitToggle" role="group" aria-label="Billing split">
        <button type="button" className={perPlayer ? "active" : ""} aria-pressed={perPlayer} onClick={() => changeSplitMode("per-player")}>
          Per player
        </button>
        <button type="button" className={!perPlayer ? "active" : ""} aria-pressed={!perPlayer} onClick={() => changeSplitMode("table")}>
          Whole table
        </button>
      </div>

      {perPlayer && (
        <>
          <div className="rosterControls">
            <div className="rosterControl">
              <span>Players</span>
              <Stepper value={players.length} min={MIN_PLAYERS} max={MAX_PLAYERS} onChange={changePlayerCount} ariaLabel="Number of players" />
            </div>
            <div className="rosterControl">
              <span>Frames</span>
              <Stepper value={frames} min={0} max={MAX_FRAMES} onChange={changeFrameCount} ariaLabel="Frames played" />
            </div>
          </div>

          <div className="rosterPlayers">
            {players.map((player, index) => {
              const bill = billById.get(player.id);
              // A player who has left or paid shows their bill inline (with an
              // "undo leave" while unpaid) instead of the editable roster row.
              if ((player.leftAt || player.settledAt) && bill) {
                return (
                  <PlayerBillRow
                    key={player.id}
                    bill={bill}
                    frameCount={frames}
                    onOpen={onOpen}
                    onRejoinStint={player.settledAt && !player.rejoinedAt ? onRejoinStint : undefined}
                    onUndoLeave={player.leftAt && !player.settledAt ? onUndoLeave : undefined}
                  />
                );
              }
              return (
                <div className="rosterPlayer" key={player.id}>
                  <span className="rosterIndex">{index + 1}</span>
                  <input
                    type="text"
                    value={player.name ?? ""}
                    placeholder={`Player ${index + 1}`}
                    onChange={(event) => changePlayerName(player.id, event.target.value)}
                    maxLength={24}
                    aria-label={`Player ${index + 1} name`}
                  />
                  <div className="rosterSatOut">
                    <span>Played</span>
                    <Stepper
                      value={Math.max(0, frames - player.satOutFrames)}
                      min={0}
                      max={frames}
                      onChange={(value) => changePlayerFramesPlayed(player.id, value)}
                      ariaLabel={`${playerLabel(player, index)} frames played`}
                    />
                  </div>
                  <button
                    type="button"
                    className="leaveBtn"
                    onClick={() => onCheckout(player.id)}
                    aria-label={`Check out ${playerLabel(player, index)}`}
                    title="Check out — settle this player now; the table keeps running"
                  >
                    <LogOut size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// Per-player settlement shown while a snooker session is BILLING (table ended):
// every player's amount + Cash/UPI/Card, paid rows collapsing to a tag + undo.
export function PlayerSettlement({
  bills,
  frameCount,
  onOpen
}: {
  bills: PlayerTotals[];
  frameCount: number;
  onOpen: (playerId: string) => void;
}) {
  const paidCount = bills.filter((bill) => bill.settled).length;
  const grandTotal = bills.reduce((sum, bill) => sum + bill.total, 0);
  const collected = bills.reduce((sum, bill) => sum + (bill.settled ? bill.total : 0), 0);

  return (
    <div className="playerSettle">
      <div className="playerSettleTitle">
        <h3>Split by player</h3>
        <span>{paidCount}/{bills.length} paid</span>
      </div>
      {bills.map((bill) => (
        <PlayerBillRow key={bill.player.id} bill={bill} frameCount={frameCount} onOpen={onOpen} />
      ))}
      <div className="playerSettleFoot">
        <span>Collected</span>
        <strong>{formatMoney(collected)} / {formatMoney(grandTotal)}</strong>
      </div>
    </div>
  );
}
