import React from "react";
import { ArrowLeft, Banknote, Check, CheckCircle2, Clock3, CreditCard, Minus, Plus, Printer, ReceiptText, RotateCcw, ShoppingBag, Timer, WalletCards } from "lucide-react";
import type { PaymentMode, Session, SplitMode, TableConfig, TableHistory } from "../types";
import { calculatePlayerBills, calculateSessionTotals, isPerPlayer } from "../lib/billing";
import { formatDuration, formatMoney } from "../lib/format";
import { PlayerRoster, PlayerSettlement, playerLabel } from "./PlayerBilling";
import { ReceiptBody, PlayerReceiptBody } from "./Receipt";

// A timestamp as a 24h "HH:MM" value, and re-stamping a timestamp's date with a
// new HH:MM (minute precision) — used to correct a session's start/end at billing.
function timeValue(ms: number) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function withTime(ms: number, hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(ms);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

export function BillPanel({
  selectedTable,
  activeSession,
  now,
  tables,
  sessions,
  tableHistory,
  isCounter,
  startCounterOrder,
  setName,
  setStartTime,
  setEndTime,
  settledInfo,
  confirmingEnd,
  setConfirmingEnd,
  confirmingVoid,
  setConfirmingVoid,
  startSession,
  endSession,
  reopenSession,
  settleSession,
  voidSession,
  setDiscount,
  toggleRoundOff,
  changeQuantity,
  changeSplitMode,
  changePlayerCount,
  changePlayerName,
  changePlayerFramesPlayed,
  changeFrameCount,
  assignOrder,
  settlePlayerBill,
  undoPlayerSettle,
  leaveAndSettle,
  rejoinPlayerBill,
  rejoinPlayerStint
}: {
  selectedTable: TableConfig;
  activeSession?: Session;
  now: number;
  tables: TableConfig[];
  sessions: Session[];
  tableHistory?: TableHistory;
  isCounter: boolean;
  startCounterOrder: () => void;
  setName: (value: string) => void;
  setStartTime: (ms: number) => void;
  setEndTime: (ms: number) => void;
  settledInfo?: { label: string; total: number; mode: PaymentMode };
  confirmingEnd: boolean;
  setConfirmingEnd: (value: boolean) => void;
  confirmingVoid: boolean;
  setConfirmingVoid: (value: boolean) => void;
  startSession: (table: TableConfig) => void;
  endSession: () => void;
  reopenSession: () => void;
  settleSession: (paymentMode: PaymentMode) => void;
  voidSession: () => void;
  setDiscount: (value: number) => void;
  toggleRoundOff: () => void;
  changeQuantity: (lineId: string, delta: number) => void;
  changeSplitMode: (mode: SplitMode) => void;
  changePlayerCount: (count: number) => void;
  changePlayerName: (playerId: string, name: string) => void;
  changePlayerFramesPlayed: (playerId: string, framesPlayed: number) => void;
  changeFrameCount: (count: number) => void;
  assignOrder: (lineId: string, playerId?: string) => void;
  settlePlayerBill: (playerId: string, mode: PaymentMode) => void;
  undoPlayerSettle: (playerId: string) => void;
  leaveAndSettle: (playerId: string, mode: PaymentMode) => void;
  rejoinPlayerBill: (playerId: string) => void;
  rejoinPlayerStint: (playerId: string) => void;
}) {
  const activeTotals = activeSession ? calculateSessionTotals(activeSession, now) : undefined;
  const items = activeSession ? activeSession.orders.reduce((sum, line) => sum + line.quantity, 0) : 0;

  // Snooker tables bill per individual by default; the counter and pool don't.
  const isSnooker = !isCounter && selectedTable.game === "snooker";
  const perPlayer = Boolean(activeSession) && isPerPlayer(activeSession as Session);
  const players = activeSession?.players ?? [];
  const playerBills = perPlayer ? calculatePlayerBills(activeSession as Session, now) : [];
  // Once any player has checked out / paid, their share is frozen against the
  // times and cafe lines — so those are locked to keep the committed money intact.
  const hasCommitted = perPlayer && players.some((player) => player.leftAt || player.settledAt);

  // Which payment mode is being reviewed before it's recorded (receipt preview).
  const [pendingMode, setPendingMode] = React.useState<PaymentMode | null>(null);
  // Which player's bill is being reviewed before recording their payment. The
  // tender (Cash/UPI/Card) is chosen in the preview itself.
  const [pendingPlayer, setPendingPlayer] = React.useState<{ playerId: string } | null>(null);
  React.useEffect(() => {
    setPendingMode(null);
    setPendingPlayer(null);
  }, [activeSession?.id, activeSession?.endedAt]);

  const pendingBill = pendingPlayer ? playerBills.find((bill) => bill.player.id === pendingPlayer.playerId) : undefined;

  return (
    <section className="billPanel">
      <header className="billHeader">
        <div>
          <p className="eyebrow">{selectedTable.type}</p>
          <h2>{selectedTable.name}</h2>
        </div>
        {activeSession?.customerName && <span className="billCustomer">{activeSession.customerName}</span>}
      </header>

      {settledInfo ? (
        <div className="settleConfirm" role="status">
          <CheckCircle2 size={40} aria-hidden="true" />
          <h3>Payment recorded</h3>
          <p className="settleConfirmWho">{settledInfo.label} · {settledInfo.mode}</p>
          <strong className="settleConfirmTotal">{formatMoney(settledInfo.total)}</strong>
        </div>
      ) : !activeSession ? (
        isCounter ? (
          <div className="emptyState counterEmpty">
            <ShoppingBag size={26} />
            <h3>New cafe order</h3>
            <p>Ring up cafe items to go — no table needed.</p>
            <button
              className="primaryAction"
              onClick={startCounterOrder}
              onTouchEnd={(event) => {
                event.preventDefault();
                startCounterOrder();
              }}
            >
              <Plus size={18} color="#1d5731" /> Start order
            </button>
          </div>
        ) : (
        <div className="emptyState">
          <Clock3 size={28} />
          <h3>Ready for the next session</h3>
          <p>{formatMoney(selectedTable.ratePerHour)} per hour</p>
          <button
            className="primaryAction"
            onClick={() => startSession(selectedTable)}
            onTouchEnd={(event) => {
              event.preventDefault();
              startSession(selectedTable);
            }}
          >
            <Timer size={18} color="#1d5731" /> Start table
          </button>
          {tableHistory && (
            <div className="tableHistoryStrip">
              {tableHistory.last && tableHistory.lastTotals ? (
                <div>
                  <span>Last session</span>
                  <strong>
                    {formatDuration(tableHistory.lastTotals.minutes)} · {formatMoney(tableHistory.lastTotals.total)}
                  </strong>
                  <em>
                    {new Date(tableHistory.last.settledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {tableHistory.last.paymentMode ? ` · ${tableHistory.last.paymentMode}` : ""}
                  </em>
                </div>
              ) : (
                <div>
                  <span>Last session</span>
                  <strong className="empty">—</strong>
                  <em>No prior bills</em>
                </div>
              )}
              <div>
                <span>Today on this table</span>
                <strong>
                  {tableHistory.today.count} {tableHistory.today.count === 1 ? "session" : "sessions"}
                  {tableHistory.today.count > 0 ? ` · ${formatDuration(tableHistory.today.minutes)}` : ""}
                </strong>
                <em>{formatMoney(tableHistory.today.revenue)}</em>
              </div>
            </div>
          )}
        </div>
        )
      ) : pendingPlayer && pendingBill ? (
        <>
          <div className="receiptScroll">
            <div className="receiptInline">
              <PlayerReceiptBody
                session={activeSession}
                tables={tables}
                sessions={sessions}
                now={now}
                bill={pendingBill}
                paidLabel={pendingBill.settled ? "Paid" : "Pay"}
              />
            </div>
          </div>
          {pendingBill.settled ? (
            <div className="playerViewActions">
              <button className="ghostAction" onClick={() => setPendingPlayer(null)}>
                <ArrowLeft size={16} /> Back
              </button>
              <button
                className="ghostAction danger"
                onClick={() => {
                  undoPlayerSettle(pendingPlayer.playerId);
                  setPendingPlayer(null);
                }}
              >
                <RotateCcw size={15} /> Undo payment
              </button>
              <button className="settleAction" onClick={() => window.print()}>
                <Printer size={16} /> Print
              </button>
            </div>
          ) : (
            <div className="playerPayActions">
              {(["Cash", "UPI", "Card"] as PaymentMode[]).map((mode) => (
                <button
                  key={mode}
                  className="settleAction"
                  onClick={() => {
                    // A still-active player is checking out early (leave + pay in
                    // one step); once the table has ended it's a plain settle.
                    if (!activeSession.endedAt && !pendingBill.player.leftAt) {
                      leaveAndSettle(pendingPlayer.playerId, mode);
                    } else {
                      settlePlayerBill(pendingPlayer.playerId, mode);
                    }
                    setPendingPlayer(null);
                  }}
                >
                  {mode === "Cash" ? <Banknote size={16} /> : mode === "Card" ? <CreditCard size={16} /> : <WalletCards size={16} />}
                  {mode}
                </button>
              ))}
              <button className="ghostAction" onClick={() => setPendingPlayer(null)}>
                <ArrowLeft size={16} /> Back
              </button>
            </div>
          )}
        </>
      ) : pendingMode ? (
        <>
          <div className="receiptScroll">
            <div className="receiptInline">
              <ReceiptBody session={activeSession} tables={tables} sessions={sessions} now={now} mode={pendingMode} paidLabel="Pay" />
            </div>
          </div>
          <div className="previewActions">
            <button className="ghostAction" onClick={() => setPendingMode(null)}>
              <ArrowLeft size={16} /> Change
            </button>
            <button className="primaryAction confirmPay" onClick={() => settleSession(pendingMode)}>
              <Check size={17} /> Confirm payment · {pendingMode}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="totalHero">
            <div>
              <p className="eyebrow">Total</p>
              <strong className="heroFigure">{formatMoney(activeTotals?.total ?? 0)}</strong>
            </div>
            <div className="totalHeroSub">
              {isCounter ? (
                <span>{items} {items === 1 ? "item" : "items"}</span>
              ) : (
                <>
                  <span>{formatDuration(activeTotals?.minutes ?? 0)} elapsed</span>
                  <span>Table <strong>{formatMoney(activeTotals?.tableCharge ?? 0)}</strong></span>
                  <span>Cafe <strong>{formatMoney(activeTotals?.kitchenTotal ?? 0)}</strong></span>
                </>
              )}
            </div>
          </div>

          <label className="nameField">
            <span>Name</span>
            <input
              type="text"
              value={activeSession.customerName ?? ""}
              onChange={(event) => setName(event.target.value)}
              placeholder="Add a name (optional)"
              maxLength={40}
            />
          </label>

          {activeSession.endedAt && !isCounter && !hasCommitted && (
            <div className="timesRow">
              <label className="timeField">
                <span>Started</span>
                <input
                  type="time"
                  value={timeValue(activeSession.startedAt)}
                  onChange={(event) => event.target.value && setStartTime(withTime(activeSession.startedAt, event.target.value))}
                  aria-label="Start time"
                />
              </label>
              <label className="timeField">
                <span>Ended</span>
                <input
                  type="time"
                  value={timeValue(activeSession.endedAt)}
                  onChange={(event) => event.target.value && setEndTime(withTime(activeSession.endedAt as number, event.target.value))}
                  aria-label="End time"
                />
              </label>
              <div className="timeField dur">
                <span>Duration</span>
                <strong>{formatDuration(activeTotals?.minutes ?? 0)}</strong>
              </div>
            </div>
          )}

          {isSnooker && !activeSession.endedAt && (
            <PlayerRoster
              session={activeSession}
              splitMode={activeSession.splitMode ?? "table"}
              bills={playerBills}
              changeSplitMode={changeSplitMode}
              changePlayerCount={changePlayerCount}
              changePlayerName={changePlayerName}
              changePlayerFramesPlayed={changePlayerFramesPlayed}
              changeFrameCount={changeFrameCount}
              onCheckout={(playerId) => setPendingPlayer({ playerId })}
              onOpen={(playerId) => setPendingPlayer({ playerId })}
              onRejoinStint={rejoinPlayerStint}
              onUndoLeave={rejoinPlayerBill}
            />
          )}

          {perPlayer && activeSession.endedAt && (
            <PlayerSettlement
              bills={playerBills}
              frameCount={activeSession.frameCount ?? 0}
              onOpen={(playerId) => setPendingPlayer({ playerId })}
            />
          )}

          {activeSession.endedAt && !perPlayer && (
            <div className="adjustments">
              <label className="adjustmentField">
                <span>Discount</span>
                <input
                  type="number"
                  min="0"
                  value={activeSession.discount || ""}
                  placeholder="0"
                  onChange={(event) => setDiscount(Number(event.target.value))}
                />
              </label>
              <button
                type="button"
                className={`adjustmentField roundOff${activeSession.roundOffEnabled ? " active" : ""}`}
                onClick={toggleRoundOff}
              >
                <span>Round off</span>
                <strong>
                  {activeSession.roundOffEnabled
                    ? activeTotals && activeTotals.roundOff !== 0
                      ? `${activeTotals.roundOff > 0 ? "+" : "−"} ${formatMoney(Math.abs(activeTotals.roundOff))}`
                      : "On"
                    : "Apply"}
                </strong>
              </button>
            </div>
          )}

          <div className="billActions">
            {!isCounter && !activeSession.endedAt && (
              <button
                className={`warningAction${confirmingEnd ? " confirming" : ""}`}
                onClick={() => {
                  if (confirmingEnd) {
                    endSession();
                    setConfirmingEnd(false);
                  } else {
                    setConfirmingEnd(true);
                  }
                }}
              >
                <ReceiptText size={17} /> {confirmingEnd ? "Tap again to confirm" : "End session"}
              </button>
            )}
            {/* Reopen once billing — hidden after any player has paid or left. */}
            {!isCounter && activeSession.endedAt && !players.some((player) => player.settledAt || player.leftAt) && (
              <button className="ghostAction" onClick={reopenSession}>
                <RotateCcw size={17} /> Reopen
              </button>
            )}
            {/* Whole-bill settle buttons: only once the session is closed, and only
                for single-payer bills — per-player bills settle in the split rows.
                (This removes the greyed-out settle buttons during a live session.) */}
            {activeSession.endedAt && !perPlayer &&
              (["Cash", "UPI", "Card"] as PaymentMode[]).map((mode) => (
                <button key={mode} className="settleAction" onClick={() => setPendingMode(mode)}>
                  {mode === "Cash" ? <Banknote size={16} /> : mode === "Card" ? <CreditCard size={16} /> : <WalletCards size={16} />}
                  {mode}
                </button>
              ))}
            <button
              className={`ghostAction danger${confirmingVoid ? " confirming" : ""}`}
              onClick={() => {
                if (confirmingVoid) {
                  voidSession();
                  setConfirmingVoid(false);
                } else {
                  setConfirmingVoid(true);
                }
              }}
            >
              {confirmingVoid ? "Tap again to void" : "Void bill"}
            </button>
          </div>

          <div className="orderList">
            <div className="lineTitle">
              <h3>Bill items</h3>
            </div>
            {activeSession.orders.length === 0 ? (
              <p className="muted">No cafe items added yet.</p>
            ) : (
              activeSession.orders.map((line) => {
                // A line assigned to a checked-out / settled player is locked —
                // that player's bill is committed, so its items can't change.
                const owner = line.playerId ? players.find((player) => player.id === line.playerId) : undefined;
                const lineLocked = Boolean(owner && (owner.leftAt || owner.settledAt));
                return (
                <div className="orderLine" key={line.lineId}>
                  <div>
                    <strong>{line.name}</strong>
                    <span>{line.variant} · {formatMoney(line.unitPrice)}</span>
                    {perPlayer && (
                      <select
                        className="orderAssign"
                        value={line.playerId ?? ""}
                        disabled={lineLocked}
                        onChange={(event) => assignOrder(line.lineId, event.target.value || undefined)}
                        aria-label={`Assign ${line.name} to a player`}
                      >
                        <option value="">Shared (split)</option>
                        {players.map((player, index) => (
                          <option key={player.id} value={player.id} disabled={Boolean(player.leftAt || player.settledAt)}>
                            {playerLabel(player, index)}{player.leftAt || player.settledAt ? " (paid)" : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="qtyControls">
                    <button onClick={() => changeQuantity(line.lineId, -1)} disabled={lineLocked} aria-label={`Remove one ${line.name}`}>
                      <Minus size={14} />
                    </button>
                    <span>{line.quantity}</span>
                    <button onClick={() => changeQuantity(line.lineId, 1)} disabled={lineLocked} aria-label={`Add one ${line.name}`}>
                      <Plus size={14} />
                    </button>
                  </div>
                  <strong>{formatMoney(line.unitPrice * line.quantity)}</strong>
                </div>
                );
              })
            )}
          </div>
        </>
      )}
    </section>
  );
}
