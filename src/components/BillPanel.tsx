import React from "react";
import { ArrowLeft, Banknote, Check, CheckCircle2, Clock3, CreditCard, Minus, Plus, Printer, ReceiptText, RotateCcw, ShoppingBag, Timer, WalletCards } from "lucide-react";
import type { PaymentMode, Session, SplitMode, TableConfig, TableHistory } from "../types";
import { calculatePlayerBills, calculateSessionTotals, getFrames, isFrameBilled, isTabFinal, linePayer, linePayerId } from "../lib/billing";
import { formatDuration, formatMoney } from "../lib/format";
import { FrameBlock, FrameHistory, FrameRoster, PlayerSettlement, playerLabel } from "./PlayerBilling";
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
  addPlayer,
  removePlayer,
  changePlayerName,
  endFrame,
  cancelEndFrame,
  billOpenFrame,
  changeFrameLoser,
  assignOrder,
  settlePlayerBill,
  undoPlayerSettle
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
  settledInfo?: { label: string; total: number; mode: PaymentMode | "Split" };
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
  addPlayer: (name: string) => void;
  removePlayer: (playerId: string) => void;
  changePlayerName: (playerId: string, name: string) => void;
  endFrame: () => void;
  cancelEndFrame: () => void;
  billOpenFrame: (loserId: string) => void;
  changeFrameLoser: (frameNo: number, loserId: string) => void;
  assignOrder: (lineId: string, playerId?: string) => void;
  settlePlayerBill: (playerId: string, mode: PaymentMode) => void;
  undoPlayerSettle: (playerId: string) => void;
}) {
  const activeTotals = activeSession ? calculateSessionTotals(activeSession, now) : undefined;
  const items = activeSession ? activeSession.orders.reduce((sum, line) => sum + line.quantity, 0) : 0;

  // Snooker tables are loser-pays by default; the counter and pool never are.
  const isSnooker = !isCounter && selectedTable.game === "snooker";
  const frameBilled = Boolean(activeSession) && isFrameBilled(activeSession as Session);
  const players = activeSession?.players ?? [];
  const playerBills = frameBilled ? calculatePlayerBills(activeSession as Session, now) : [];
  const finishedFrames = frameBilled ? getFrames(activeSession as Session, now).filter((frame) => !frame.open && !frame.awaiting) : [];
  // Once anyone has paid, their tab is priced against the times, frames and
  // cafe lines — so those are locked to keep the collected money intact.
  const anyPaid = players.some((player) => player.settledAt);

  // Which payment mode is being reviewed before it's recorded (receipt preview).
  const [pendingMode, setPendingMode] = React.useState<PaymentMode | null>(null);
  // Which player's tab is being reviewed before recording their payment. The
  // tender (Cash/UPI/Card) is chosen in the preview itself.
  const [pendingPlayer, setPendingPlayer] = React.useState<{ playerId: string } | null>(null);
  React.useEffect(() => {
    setPendingMode(null);
    setPendingPlayer(null);
  }, [activeSession?.id, activeSession?.endedAt]);

  const pendingBill = pendingPlayer ? playerBills.find((bill) => bill.player.id === pendingPlayer.playerId) : undefined;
  // The tab can stop being final while its preview is open (say, an item added
  // to the frame left open) — then the tenders wait.
  const canPayPending = Boolean(
    activeSession && pendingBill && pendingBill.total > 0 && isTabFinal(activeSession, pendingBill.player, now)
  );

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
              {!canPayPending && <p className="settleBlocked">Bill the open frame first. This tab can still change.</p>}
              {(["Cash", "UPI", "Card"] as PaymentMode[]).map((mode) => (
                <button
                  key={mode}
                  className="settleAction"
                  disabled={!canPayPending}
                  onClick={() => {
                    settlePlayerBill(pendingPlayer.playerId, mode);
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

          {/* A loser-pays table names each player instead; the party name is
              for a whole-table bill (and keeps its room for the roster). */}
          {!frameBilled && (
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
          )}

          {activeSession.endedAt && !isCounter && !anyPaid && (
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

          {isSnooker && !activeSession.endedAt && !anyPaid && (
            <div className="splitToggle" role="group" aria-label="Billing split">
              <button type="button" className={frameBilled ? "active" : ""} aria-pressed={frameBilled} onClick={() => changeSplitMode("frames")}>
                Loser pays
              </button>
              <button type="button" className={!frameBilled ? "active" : ""} aria-pressed={!frameBilled} onClick={() => changeSplitMode("table")}>
                Whole table
              </button>
            </div>
          )}

          {frameBilled && (
            <div className="framesArea">
              <FrameBlock
                session={activeSession}
                now={now}
                onEndFrame={endFrame}
                onCancelEnd={cancelEndFrame}
                onPickLoser={changeFrameLoser}
                onBillOpen={billOpenFrame}
                onAddPlayer={addPlayer}
              />
              {activeSession.endedAt ? (
                <PlayerSettlement
                  session={activeSession}
                  now={now}
                  bills={playerBills}
                  onOpen={(playerId) => setPendingPlayer({ playerId })}
                  onRemovePlayer={removePlayer}
                />
              ) : (
                <FrameRoster
                  session={activeSession}
                  now={now}
                  bills={playerBills}
                  onAddPlayer={addPlayer}
                  onRemovePlayer={removePlayer}
                  onRenamePlayer={changePlayerName}
                  onOpen={(playerId) => setPendingPlayer({ playerId })}
                />
              )}
              <FrameHistory session={activeSession} frames={finishedFrames} onChangeLoser={changeFrameLoser} />
            </div>
          )}

          {activeSession.endedAt && !frameBilled && (
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
            {/* Reopen once billing — hidden after any player has paid. */}
            {!isCounter && activeSession.endedAt && !anyPaid && (
              <button className="ghostAction" onClick={reopenSession}>
                <RotateCcw size={17} /> Reopen
              </button>
            )}
            {/* Whole-bill settle buttons: only once the session is closed, and only
                for single-payer bills — loser-pays tabs settle in their own rows.
                (This removes the greyed-out settle buttons during a live session.) */}
            {activeSession.endedAt && !frameBilled &&
              (["Cash", "UPI", "Card"] as PaymentMode[]).map((mode) => (
                <button key={mode} className="settleAction" onClick={() => setPendingMode(mode)}>
                  {mode === "Cash" ? <Banknote size={16} /> : mode === "Card" ? <CreditCard size={16} /> : <WalletCards size={16} />}
                  {mode}
                </button>
              ))}
            {/* A loser-pays table with payments taken can't be voided — undo them first. */}
            {!(frameBilled && anyPaid) && (
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
            )}
          </div>

          <div className="orderList">
            <div className="lineTitle">
              <h3>Bill items</h3>
            </div>
            {activeSession.orders.length === 0 ? (
              <p className="muted">No cafe items added yet.</p>
            ) : (
              activeSession.orders.map((line) => {
                // A line on a paid tab is locked — that money is collected.
                const payerId = frameBilled ? linePayerId(activeSession, line) : undefined;
                const lineLocked = Boolean(payerId && players.find((player) => player.id === payerId)?.settledAt);
                const payer = frameBilled ? linePayer(activeSession, line) : undefined;
                // What "no player" means for this line: the lowest scorer of the
                // frame it was folded into, else of the frame still open.
                const frames = activeSession.frames ?? [];
                const stampedFrame = line.frameNo != null && line.frameNo >= 1 && line.frameNo <= frames.length ? line.frameNo : undefined;
                const stampedLoser = stampedFrame ? players.find((player) => player.id === frames[stampedFrame - 1].loserId) : undefined;
                const frameOption = stampedFrame
                  ? `Frame ${stampedFrame} · ${stampedLoser ? playerLabel(stampedLoser, players.indexOf(stampedLoser)) : "lowest scorer"}${stampedLoser?.settledAt ? " (paid)" : ""}`
                  : activeSession.endedAt
                    ? "Unassigned — pick who pays"
                    : "This frame's lowest scorer";
                return (
                <div className="orderLine" key={line.lineId}>
                  <div>
                    <strong>{line.name}</strong>
                    <span>{line.variant} · {formatMoney(line.unitPrice)}</span>
                    {frameBilled && (
                      <select
                        className="orderAssign"
                        value={payer?.kind === "player" ? payer.playerId : ""}
                        disabled={lineLocked}
                        onChange={(event) => assignOrder(line.lineId, event.target.value || undefined)}
                        aria-label={`Who pays for ${line.name}`}
                      >
                        <option value="" disabled={Boolean(stampedLoser?.settledAt)}>{frameOption}</option>
                        {players.map((player, index) => (
                          <option key={player.id} value={player.id} disabled={Boolean(player.settledAt)}>
                            {playerLabel(player, index)}{player.settledAt ? " (paid)" : player.leftAt ? " (left)" : ""}
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
